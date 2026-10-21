import { Vibration } from 'react-native';
import { openTalkWakes, subscribeTalkWakes, type TalkWake } from '@criticom/api';
import type { TalkPass, TalkSession } from '@criticom/api/talk';
import { getSupabase } from './supabase';
import { setTalkPresence } from './presence';
import { isCameraRadio } from './radio-camera';
import { liveKitNative, startTalkAudio, stopTalkAudio } from './talk-native';

/**
 * The console calls the radios (0095): no one has to open Talk to hear it.
 *
 * While on duty the radio waits for a call on any talk group it may hear: told
 * at once over the live link, and asked again on the duty wake-up (screen
 * off) in case that link dropped. When called, it buzzes once, joins the group
 * by itself and plays the console through the loudspeaker. It only listens:
 * the microphone stays closed. It leaves a minute after the last word (the
 * voice server is paid by the minute), and the next call brings it back.
 *
 * Only on the push-to-talk radios and the smart hard hats, as the camera
 * (lib/radio-camera.ts). With Talk open on screen, the screen has the channel
 * and this waits.
 */

/** Stays on this long after the last word heard. */
const HANG_MS = 60_000;
/** Asks again at most this often (the live link is the fast way). */
const ASK_MS = 8_000;

type Live = { channel: string; s: TalkSession; until: number; lastHeard: number };

let watching: (() => void) | null = null;
let screenHasIt = false;
let live: Live | null = null;
let joining = false;
let lastAsked = 0;

/** On duty: wait for the console's calls. */
export function startTalkWatch(): void {
  if (watching || !isCameraRadio() || !liveKitNative()) return;
  const off = subscribeTalkWakes(getSupabase(), (w) => { void onWake(w); });
  const timer = setInterval(hang, 5_000);
  watching = () => { off(); clearInterval(timer); };
  void checkTalk(true);
}

/** Off duty or signed out: stop waiting, and leave. */
export async function stopTalkWatch(): Promise<void> {
  watching?.();
  watching = null;
  await leave();
}

/** The Talk screen is open (it has the channel) or closed again. */
export function screenTalk(open: boolean): void {
  screenHasIt = open;
  if (open) void leave();
  else void checkTalk(true);
}

/**
 * Is a call open for this radio? Safe to call often (the duty wake-up does):
 * it asks the server every few seconds at most, and leaves when it is time.
 */
export async function checkTalk(force = false): Promise<void> {
  if (!watching || screenHasIt) return;
  hang();
  if (!force && Date.now() - lastAsked < ASK_MS) return;
  lastAsked = Date.now();
  try {
    const [newest] = await openTalkWakes(getSupabase());
    if (newest) await onWake(newest);
  } catch {
    // No signal, or 0095 not run: ask again next time.
  }
}

async function onWake(w: TalkWake) {
  if (!watching || screenHasIt) return;
  const until = Date.parse(w.until);
  if (!(until > Date.now())) return;
  if (live?.channel === w.channel) {
    live.until = Math.max(live.until, until);
    return;
  }
  // Someone is speaking where it is now: it stays to hear them out.
  if (live?.s.state.talking) return;
  await join(w.channel, until);
}

async function join(channel: string, until: number) {
  if (joining) return;
  joining = true;
  try {
    await leave();
    Vibration.vibrate(300);
    // The loudspeaker; it must not hold up joining.
    await Promise.race([startTalkAudio(), new Promise((r) => setTimeout(r, 3000))]).catch(() => {});
    // After liveKitNative(): its stand-ins must be in place before LiveKit loads.
    const { TalkSession: Session } = require('@criticom/api/talk') as typeof import('@criticom/api/talk');
    const supabase = getSupabase();
    const s: TalkSession = new Session(channel, {
      getPass: async (c) => {
        const { data, error } = await supabase.rpc('talk_pass', { p_channel: c });
        if (error) throw new Error(error.message);
        return data as TalkPass;
      },
      log: (m) => console.log(m),
    }, (st) => {
      if (live?.s !== s) return;
      if (st.talking) live.lastHeard = Date.now();
      // The Radio Desk sees which group it is in.
      setTalkPresence({ channel: st.status === 'ready' ? st.channel : null, talking: false });
    }, { listenOnly: true });
    live = { channel, s, until, lastHeard: Date.now() };
    console.log('[criticom] called by the console on', channel);
    await s.connect();
  } catch (e) {
    console.warn('[criticom] talk call did not join', (e as Error).message);
    await leave();
  } finally {
    joining = false;
  }
}

/** A minute after the last word, and the call is over: leave. */
function hang() {
  if (!live) return;
  const now = Date.now();
  if (live.s.state.talking) { live.lastHeard = now; return; }
  if (now > live.until && now - live.lastHeard > HANG_MS) void leave();
}

async function leave() {
  const was = live;
  live = null;
  if (!was) return;
  await was.s.close().catch(() => {});
  // Handing over to the Talk screen: its sound stays on.
  if (screenHasIt) return;
  await stopTalkAudio();
  setTalkPresence({ channel: null, talking: false });
}
