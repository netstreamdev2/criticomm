'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Headset, Mic, MicOff, Radio, Volume2, WifiOff } from 'lucide-react';
import { TalkSession, channelTone, type TalkPass, type TalkState } from '@criticom/api/talk';
import type { TalkChannel } from '@criticom/api';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useT } from '@/components/i18n';

/**
 * Push-to-talk in the console: hold the button (or the space bar) to talk to
 * the radios in a talk group, let go to listen. Who may join and speak is the
 * database's decision (talk_pass, 0083); every transmission is logged.
 */

/** Short radio tones made in the browser: no sound files to load. */
function makeCue() {
  let ctx: AudioContext | null = null;
  const beep = (freqs: number[], ms = 70) => {
    try {
      ctx ??= new AudioContext();
      let t = ctx.currentTime;
      for (const f of freqs) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
        o.connect(g).connect(ctx.destination);
        o.start(t);
        o.stop(t + ms / 1000 + 0.02);
        t += ms / 1000 + 0.03;
      }
    } catch { /* no sound is better than a broken button */ }
  };
  return (kind: 'start' | 'end' | 'incoming' | 'busy') => {
    if (kind === 'start') beep([880, 1320]);
    else if (kind === 'end') beep([1320, 880]);
    else if (kind === 'incoming') beep([660], 50);
    else beep([440, 440, 440], 90);
  };
}

const STATUS_TEXT: Record<TalkState['status'], string> = {
  connecting: 'Joining…',
  ready: 'Connected',
  reconnecting: 'Reconnecting…',
  closed: 'Left',
  error: 'Not connected',
};

export function TalkPanel({ channels, compact = false, title = 'Talk' }: {
  channels: TalkChannel[];
  compact?: boolean;
  title?: string;
}) {
  const { t } = useT();
  const [channel, setChannel] = useState(channels[0]?.channel ?? '');
  const [state, setState] = useState<TalkState | null>(null);
  const [joined, setJoined] = useState(false);
  const [busyFlash, setBusyFlash] = useState(false);
  const session = useRef<TalkSession | null>(null);
  const audioBox = useRef<HTMLDivElement>(null);
  const holding = useRef(false);

  const join = useCallback(async (ch: string) => {
    await session.current?.close();
    const supabase = getBrowserSupabase();
    const s = new TalkSession(ch, {
      getPass: async (c) => {
        const { data, error } = await supabase.rpc('talk_pass', { p_channel: c });
        if (error) throw new Error(error.message);
        return data as TalkPass;
      },
      logTalk: async (c, startedAt, endedAt) => {
        await supabase.rpc('log_talk', { p_channel: c, p_started_at: startedAt.toISOString(), p_ended_at: endedAt.toISOString() });
      },
      onRemoteAudio: (track, present) => {
        if (present) {
          const el = track.attach();
          el.setAttribute('data-talk', '');
          audioBox.current?.appendChild(el);
        } else {
          for (const el of track.detach()) el.remove();
        }
      },
      cue: makeCue(),
      log: (m) => console.debug(m),
    }, setState);
    session.current = s;
    setJoined(true);
    await s.connect();
    // The click that joined also lets the browser play sound.
    await s.allowAudio().catch(() => {});
  }, []);

  useEffect(() => () => { void session.current?.close(); }, []);

  const press = useCallback(async () => {
    if (holding.current || !session.current) return;
    holding.current = true;
    const r = await session.current.press();
    if (r === 'busy') {
      setBusyFlash(true);
      setTimeout(() => setBusyFlash(false), 900);
    }
    // Let go before the microphone opened: close it at once.
    if (!holding.current) await session.current.release();
  }, []);
  const release = useCallback(async () => {
    holding.current = false;
    await session.current?.release();
  }, []);

  // The space bar is the talk key, except while typing.
  useEffect(() => {
    if (!joined) return;
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return Boolean(t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)));
    };
    const down = (e: KeyboardEvent) => { if (e.code === 'Space' && !e.repeat && !typing(e)) { e.preventDefault(); void press(); } };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space' && !typing(e)) { e.preventDefault(); void release(); } };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', release);
    };
  }, [joined, press, release]);

  if (channels.length === 0) return null;
  const tone = channelTone(channel);
  const s = state;
  const ready = s?.status === 'ready';
  const someoneElse = s?.talking && !s.talking.me ? s.talking : null;
  const onAir = Boolean(s?.transmitting);
  const listeners = (s?.people.length ?? 1) - 1;

  return (
    <section
      className={`frost relative overflow-hidden rounded-xl border ${compact ? 'p-3' : 'p-4'}`}
      style={{ borderColor: `${tone}66`, backgroundImage: `linear-gradient(135deg, ${tone}22, transparent 65%)` }}
    >
      <div ref={audioBox} className="hidden" aria-hidden />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg text-white" style={{ backgroundColor: tone }}>
            <Radio className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-bold leading-tight">{title}</p>
            <p className="text-[11px] text-muted-foreground">
              {joined && s ? `${STATUS_TEXT[s.status]}${ready ? ` · ${listeners} listening` : ` · ${s.step}`}` : 'Hold to talk to the radios'}
            </p>
          </div>
        </div>
        {channels.length > 1 ? (
          <div className="flex flex-wrap gap-1.5">
            {channels.map((c) => {
              const on = c.channel === channel;
              const t = channelTone(c.channel);
              return (
                <button
                  key={c.channel} type="button"
                  onClick={() => { setChannel(c.channel); if (joined) void join(c.channel); }}
                  className="frost-pill rounded-full border px-2.5 py-1 text-[11px] font-semibold"
                  style={on ? { borderColor: t, backgroundColor: `${t}26`, color: t } : { borderColor: `${t}44` }}
                >
                  {c.name}{c.speak ? '' : ' (listen)'}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {!joined ? (
        <button
          type="button" onClick={() => void join(channel)}
          className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg text-sm font-bold text-white shadow-lg"
          style={{ backgroundColor: tone }}
        >
          <Headset className="h-4 w-4" /> {' '}{t('Join {value}', { value: channels.find((c) => c.channel === channel)?.name ?? 'the talk group' })}
        </button>
      ) : (
        <div className={`mt-3 grid gap-3 ${compact ? '' : 'md:grid-cols-[auto_1fr]'}`}>
          <button
            type="button"
            disabled={!ready || !s?.canSpeak}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); void press(); }}
            onPointerUp={() => void release()}
            onPointerCancel={() => void release()}
            onContextMenu={(e) => e.preventDefault()}
            aria-pressed={onAir}
            className={`relative mx-auto flex select-none touch-none flex-col items-center justify-center rounded-full border-4 font-black text-white shadow-2xl transition-transform disabled:cursor-not-allowed disabled:opacity-50 ${compact ? 'h-28 w-28 text-sm' : 'h-40 w-40 text-base'} ${onAir ? 'scale-105' : ''} ${busyFlash ? 'animate-pulse' : ''}`}
            style={{
              backgroundColor: onAir ? '#ef4444' : busyFlash ? '#64748b' : tone,
              borderColor: onAir ? '#fecaca' : '#ffffff33',
              boxShadow: onAir ? '0 0 0 10px #ef444433, 0 0 40px #ef4444aa' : `0 12px 30px -10px ${tone}`,
            }}
          >
            {onAir ? <Mic className="mb-1 h-8 w-8" /> : s?.canSpeak ? <Mic className="mb-1 h-8 w-8 opacity-90" /> : <MicOff className="mb-1 h-8 w-8" />}
            {onAir ? `ON AIR ${s?.secondsLeft ?? ''}` : busyFlash ? 'BUSY' : s?.canSpeak ? 'HOLD TO TALK' : 'LISTEN ONLY'}
          </button>

          <div className="min-w-0 space-y-2">
            <div
              className="frost-pill flex min-h-12 items-center gap-2 rounded-lg border px-3 py-2"
              style={{ borderColor: someoneElse ? '#22c55e88' : onAir ? '#ef444488' : 'transparent' }}
            >
              {someoneElse ? (
                <>
                  <Volume2 className="h-4 w-4 shrink-0 animate-pulse text-emerald-500" />
                  <span className="truncate text-sm font-semibold"><span className="text-emerald-500">{someoneElse.name}</span> {' '}{t('is talking')}</span>
                </>
              ) : onAir ? (
                <span className="text-sm font-semibold text-red-500">{t('You are on the air. Let go to listen.')}</span>
              ) : s?.status === 'error' || s?.status === 'reconnecting' ? (
                <span className="flex items-center gap-2 text-sm text-amber-500"><WifiOff className="h-4 w-4 shrink-0" />{s.error ?? STATUS_TEXT[s.status]}</span>
              ) : (
                <span className="text-sm text-muted-foreground">{t('Channel clear. {value}', { value: s?.canSpeak ? 'Hold the button or the space bar to talk.' : '' })}</span>
              )}
            </div>
            {s?.audioBlocked ? (
              <button type="button" onClick={() => void session.current?.allowAudio()} className="w-full rounded-md bg-amber-500 px-3 py-2 text-sm font-semibold text-black">
                {t('Click to hear the radios')}</button>
            ) : null}
            {!compact && s?.people.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {s.people.map((p) => (
                  <li
                    key={p.identity}
                    className="frost-pill inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
                    style={{ borderColor: p.talking ? '#22c55e' : '#64748b44' }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: p.talking ? '#22c55e' : '#64748b' }} />
                    {p.name}{p.me ? ' (you)' : ''}
                  </li>
                ))}
              </ul>
            ) : null}
            <button type="button" onClick={() => { void session.current?.close(); setJoined(false); setState(null); }} className="text-xs text-muted-foreground underline">
              {t('Leave')}</button>
          </div>
        </div>
      )}
    </section>
  );
}
