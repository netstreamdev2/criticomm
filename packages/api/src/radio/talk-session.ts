import {
  Room, RoomEvent, Track,
  type LocalTrackPublication, type Participant, type RemoteTrack,
} from 'livekit-client';
import { TALK_MAX_SECONDS, mayKeyUp, readTalkMetadata, sortTalkPeople, whoHasTheChannel, type TalkPerson } from './talk.ts';

export * from './talk.ts';

/**
 * One talk group, live: join it with a pass the database signed (talk_pass,
 * 0083), hold to talk, let go, and see who has the channel. The console and
 * the app run this same class; each supplies how to get a pass, how to play
 * audio (the browser attaches it, the phone plays it natively) and its tones.
 */

export type TalkPass = {
  url: string;
  token: string;
  room: string;
  channel: string;
  name: string;
  canSpeak: boolean;
  priority: boolean;
  identity: string;
  expiresAt: string;
};

export type TalkStatus = 'connecting' | 'ready' | 'reconnecting' | 'closed' | 'error';

export type TalkState = {
  status: TalkStatus;
  error: string | null;
  channel: string;
  name: string;
  canSpeak: boolean;
  priority: boolean;
  /** I am on the air. */
  transmitting: boolean;
  /** Seconds left before a transmission is cut. */
  secondsLeft: number | null;
  /** Who has the channel right now. */
  talking: TalkPerson | null;
  people: TalkPerson[];
  /** The browser needs a click before it may play sound. */
  audioBlocked: boolean;
  /** What it is doing now, in words: for the screen while joining, and the log. */
  step: string;
};

export type TalkHooks = {
  getPass: (channel: string) => Promise<TalkPass>;
  logTalk?: (channel: string, startedAt: Date, endedAt: Date) => Promise<void>;
  /** The browser attaches remote audio to the page; the phone plays it natively. */
  onRemoteAudio?: (track: RemoteTrack, present: boolean) => void;
  /** A short tone or buzz: on the air, off the air, someone else started, busy. */
  cue?: (kind: 'start' | 'end' | 'incoming' | 'busy') => void;
  /** Each step, for the log: where a join stops is where to look. */
  log?: (message: string) => void;
};

/** A join that has not answered in this long is a failure, retried. */
const CONNECT_TIMEOUT_MS = 20_000;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} did not answer in ${Math.round(ms / 1000)} seconds`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export class TalkSession {
  private room: Room | null = null;
  private closed = false;
  private keyedAt: Date | null = null;
  private cutTimer: ReturnType<typeof setInterval> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private retries = 0;
  private lastTalker: string | null = null;
  state: TalkState;

  constructor(
    channel: string,
    private readonly hooks: TalkHooks,
    private readonly onState: (s: TalkState) => void,
    /** Hear only: a radio woken by the console (0095) plays it and never opens its microphone. */
    private readonly opts: { listenOnly?: boolean } = {},
  ) {
    this.state = {
      status: 'connecting', error: null, channel, name: channel, canSpeak: false, priority: false,
      transmitting: false, secondsLeft: null, talking: null, people: [], audioBlocked: false, step: 'Starting',
    };
  }

  private step(step: string) {
    this.hooks.log?.(`[talk] ${this.state.channel}: ${step}`);
    this.set({ step });
  }

  private set(patch: Partial<TalkState>) {
    this.state = { ...this.state, ...patch };
    this.onState(this.state);
  }

  async connect(): Promise<void> {
    if (this.closed) return;
    this.set({ status: this.room ? 'reconnecting' : 'connecting', error: null });
    // The screen shows plain words; the detail goes to the log.
    this.step('Getting ready');
    let pass: TalkPass;
    try {
      pass = await withTimeout(this.hooks.getPass(this.state.channel), CONNECT_TIMEOUT_MS, 'The server');
    } catch (e) {
      this.hooks.log?.(`[talk] ${this.state.channel}: no pass: ${(e as Error).message}`);
      this.set({ status: 'error', error: 'No connection. Trying again.', step: 'Trying again' });
      this.scheduleRetry();
      return;
    }
    this.hooks.log?.(`[talk] ${this.state.channel}: server ${pass.url}`);
    this.step('Connecting');
    let room: Room;
    try {
      room = new Room({
        adaptiveStream: false,
        dynacast: false,
        audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this.bind(room);
    } catch (e) {
      // A platform the voice library cannot run on: say so, do not spin.
      this.hooks.log?.(`[talk] voice library: ${(e as Error).stack ?? (e as Error).message}`);
      this.set({ status: 'error', error: 'Talk does not work on this device.', step: 'Not working' });
      return;
    }
    try {
      await withTimeout(room.connect(pass.url, pass.token, { autoSubscribe: true }), CONNECT_TIMEOUT_MS, 'The voice server');
    } catch (e) {
      this.hooks.log?.(`[talk] ${this.state.channel}: server did not answer: ${(e as Error).message}`);
      void room.disconnect().catch(() => {});
      this.set({ status: 'error', error: 'No connection. Trying again.', step: 'Trying again' });
      this.scheduleRetry();
      return;
    }
    if (this.closed) { await room.disconnect(); return; }
    this.room = room;
    this.retries = 0;
    const canSpeak = pass.canSpeak && !this.opts.listenOnly;
    this.set({ status: 'ready', name: pass.name, canSpeak, priority: canSpeak && pass.priority, audioBlocked: !room.canPlaybackAudio });
    if (canSpeak) {
      this.step('Opening the microphone');
      try {
        // Ready but silent: the microphone is open and muted, so keying up is instant.
        await withTimeout(room.localParticipant.setMicrophoneEnabled(true), CONNECT_TIMEOUT_MS, 'The microphone');
        // Off the air the microphone is released, not only silenced: a hard
        // hat records one thing at a time (Android 8), and its live camera
        // needs it back. Keying up opens it again.
        const track = this.mic()?.track as { stopOnMute?: boolean } | undefined;
        if (track) track.stopOnMute = true;
        await this.mic()?.mute();
      } catch (e) {
        this.hooks.log?.(`[talk] microphone: ${(e as Error).message}`);
        this.set({ canSpeak: false, error: 'The microphone is not allowed.' });
      }
    }
    this.step('Ready');
    this.refresh();
  }

  private mic(): LocalTrackPublication | undefined {
    return this.room?.localParticipant.getTrackPublication(Track.Source.Microphone);
  }

  private bind(room: Room) {
    const refresh = () => this.refresh();
    room
      .on(RoomEvent.ParticipantConnected, refresh)
      .on(RoomEvent.ParticipantDisconnected, refresh)
      .on(RoomEvent.TrackPublished, refresh)
      .on(RoomEvent.TrackUnpublished, refresh)
      .on(RoomEvent.TrackMuted, refresh)
      .on(RoomEvent.TrackUnmuted, refresh)
      .on(RoomEvent.TrackSubscribed, (track) => { if (track.kind === Track.Kind.Audio) this.hooks.onRemoteAudio?.(track, true); refresh(); })
      .on(RoomEvent.TrackUnsubscribed, (track) => { if (track.kind === Track.Kind.Audio) this.hooks.onRemoteAudio?.(track, false); refresh(); })
      .on(RoomEvent.AudioPlaybackStatusChanged, () => this.set({ audioBlocked: !room.canPlaybackAudio }))
      .on(RoomEvent.Reconnecting, () => this.set({ status: 'reconnecting' }))
      .on(RoomEvent.Reconnected, () => { this.set({ status: 'ready' }); refresh(); })
      .on(RoomEvent.Disconnected, () => {
        if (this.room !== room) return;
        this.stopTransmitting(false);
        this.room = null;
        if (!this.closed) this.scheduleRetry();
      });
  }

  /** After a drop (or an expired pass), join again with a fresh pass: 2s, 4s, 8s… up to 30s. */
  private scheduleRetry() {
    if (this.closed || this.retry) return;
    const wait = Math.min(30_000, 2000 * 2 ** this.retries++);
    this.set({ status: 'reconnecting' });
    this.retry = setTimeout(() => { this.retry = null; void this.connect(); }, wait);
  }

  private person(p: Participant, me: boolean): TalkPerson {
    const meta = readTalkMetadata(p.metadata);
    const mic = p.getTrackPublication(Track.Source.Microphone);
    return {
      identity: p.identity,
      name: p.name || p.identity,
      role: meta.role,
      silo: meta.silo,
      me,
      talking: me ? this.state.transmitting : Boolean(mic && !mic.isMuted),
    };
  }

  private refresh() {
    const room = this.room;
    if (!room) return;
    const people = sortTalkPeople([
      this.person(room.localParticipant, true),
      ...[...room.remoteParticipants.values()].map((p) => this.person(p, false)),
    ]);
    const talking = whoHasTheChannel(people);
    const other = talking && !talking.me ? talking.identity : null;
    if (other && other !== this.lastTalker) this.hooks.cue?.('incoming');
    this.lastTalker = other;
    this.set({ people, talking });
  }

  /** The browser's click that lets it play sound. */
  async allowAudio() {
    await this.room?.startAudio();
    this.set({ audioBlocked: !(this.room?.canPlaybackAudio ?? true) });
  }

  /** Key up. Busy when someone else has the channel, unless I have priority. */
  async press(): Promise<'on' | 'busy' | 'not-allowed'> {
    const pub = this.mic();
    if (!this.room || !this.state.canSpeak || !pub) return 'not-allowed';
    if (this.state.transmitting) return 'on';
    if (mayKeyUp(this.state.people, this.state.priority) === 'busy') {
      this.hooks.cue?.('busy');
      return 'busy';
    }
    await pub.unmute();
    this.keyedAt = new Date();
    this.hooks.cue?.('start');
    let left = TALK_MAX_SECONDS;
    this.set({ transmitting: true, secondsLeft: left });
    this.cutTimer = setInterval(() => {
      left -= 1;
      if (left <= 0) void this.release();
      else this.set({ secondsLeft: left });
    }, 1000);
    this.refresh();
    return 'on';
  }

  /** Let go: off the air, and the transmission goes on the record. */
  async release(): Promise<void> {
    if (!this.state.transmitting) return;
    await this.stopTransmitting(true);
  }

  private async stopTransmitting(log: boolean) {
    if (this.cutTimer) clearInterval(this.cutTimer);
    this.cutTimer = null;
    const started = this.keyedAt;
    this.keyedAt = null;
    if (this.state.transmitting) {
      await this.mic()?.mute().catch(() => {});
      this.hooks.cue?.('end');
    }
    this.set({ transmitting: false, secondsLeft: null });
    this.refresh();
    if (log && started) void this.hooks.logTalk?.(this.state.channel, started, new Date()).catch(() => {});
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.retry) clearTimeout(this.retry);
    await this.stopTransmitting(true);
    const room = this.room;
    this.room = null;
    await room?.disconnect();
    this.set({ status: 'closed', people: [], talking: null });
  }
}
