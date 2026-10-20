'use client';

import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track, type RemoteTrack } from 'livekit-client';
import { Loader2, Maximize2, Minimize2, VideoOff, X } from 'lucide-react';
import { endRadioCamera, radioCameraPass, startRadioCamera } from '@criticom/api';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useT } from '@/components/i18n';

/**
 * A radio's camera, live (0091). Opening it tells the officer (buzz, sound,
 * notification); closing this, or ten minutes, closes it on the radio too.
 * Nothing is recorded.
 */

type Phase = 'opening' | 'waiting' | 'live' | 'ended' | 'error';
type OpenView = Awaited<ReturnType<typeof startRadioCamera>>;

/**
 * One opening per radio, shared by every panel showing it. A panel that
 * mounts twice in a row (React does this in development) or a second panel
 * on the same radio reuses it; the view is closed only a moment after the
 * last panel showing it has really gone, so a quick remount never closes the
 * view another panel is waiting on, and a closed panel never leaves the
 * radio's camera on.
 */
const CLOSE_AFTER_MS = 800;
const openings = new Map<string, { view: Promise<OpenView>; users: number; closing: ReturnType<typeof setTimeout> | null }>();

function holdView(deviceId: string): Promise<OpenView> {
  const open = openings.get(deviceId);
  if (open) {
    open.users++;
    if (open.closing) { clearTimeout(open.closing); open.closing = null; }
    return open.view;
  }
  const view = startRadioCamera(getBrowserSupabase(), deviceId);
  openings.set(deviceId, { view, users: 1, closing: null });
  // A failed opening is forgotten at once, so trying again opens afresh.
  view.catch(() => { if (openings.get(deviceId)?.view === view) openings.delete(deviceId); });
  return view;
}

function letGoOfView(deviceId: string) {
  const open = openings.get(deviceId);
  if (!open) return;
  open.users--;
  if (open.users > 0) return;
  open.closing = setTimeout(() => {
    if (openings.get(deviceId) !== open || open.users > 0) return;
    openings.delete(deviceId);
    void open.view.then((v) => endRadioCamera(getBrowserSupabase(), v.id)).catch(() => {});
  }, CLOSE_AFTER_MS);
}

export function RadioCameraViewer({ deviceId, title, onClose }: { deviceId: string; title?: string; onClose: () => void }) {
  const { t } = useT();
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('opening');
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [big, setBig] = useState(false);
  const frame = useRef<HTMLDivElement>(null);

  // The big view fills the screen (the browser's full screen when it allows it);
  // the same video element grows, so the stream is never interrupted.
  const enlarge = () => {
    setBig(true);
    void frame.current?.requestFullscreen?.().catch(() => {});
  };
  const shrink = () => {
    setBig(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  };
  useEffect(() => {
    if (!big) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') shrink(); };
    const onFull = () => { if (!document.fullscreenElement) setBig(false); };
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFull);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFull);
    };
  }, [big]);

  // The words may reload (translations); the camera must not reopen for that.
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    const supabase = getBrowserSupabase();
    const t = (s: string) => tRef.current(s);
    let room: Room | null = null;
    let endsAt = 0;
    let closed = false;
    const tick = setInterval(() => {
      if (!endsAt) return;
      const s = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) setPhase('ended');
    }, 1000);

    void (async () => {
      try {
        const view = await holdView(deviceId);
        if (closed) return;
        endsAt = Date.parse(view.ends_by);
        const pass = await radioCameraPass(supabase, view.id);
        if (closed) return;
        room = new Room({ adaptiveStream: true });
        room
          .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
            if (track.kind === Track.Kind.Video && video.current) {
              track.attach(video.current);
              setPhase('live');
            } else if (track.kind === Track.Kind.Audio) {
              audio.current?.appendChild(track.attach());
            }
          })
          .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => { for (const el of track.detach()) if (el !== video.current) el.remove(); })
          .on(RoomEvent.ParticipantDisconnected, () => setPhase((p) => (p === 'live' ? 'waiting' : p)))
          .on(RoomEvent.Disconnected, () => setPhase((p) => (p === 'error' ? p : 'ended')));
        await room.connect(pass.url, pass.token, { autoSubscribe: true });
        if (closed) { await room.disconnect(); return; }
        // The click that opened this lets the browser play the radio's sound.
        await room.startAudio().catch(() => {});
        setPhase((p) => (p === 'live' ? p : 'waiting'));
      } catch (e) {
        const message = (e as { message?: string }).message ?? '';
        setError(/radio is off/i.test(message) ? t('This radio is off.')
          : /Not permitted/i.test(message) ? t('You may not open this camera.')
            : /schema cache|Could not find the function/i.test(message) ? t('The camera is not set up yet. Ask the system administrator.')
              : t('The camera did not open. Try again.'));
        console.warn('[radio camera]', message);
        setPhase('error');
      }
    })();

    return () => {
      closed = true;
      clearInterval(tick);
      void room?.disconnect();
      // Closing here closes it on the radio (once no panel shows it): the
      // officer's camera never stays open for a tab left behind.
      letGoOfView(deviceId);
    };
  }, [deviceId]);

  return (
    <div ref={frame} className={big ? 'fixed inset-0 z-[70] flex flex-col gap-3 bg-black p-3 sm:p-5' : 'space-y-2'}>
      {big ? (
        <div className="flex items-center justify-between gap-3 text-white">
          <p className="truncate text-lg font-bold">{title}</p>
          <button type="button" onClick={shrink} aria-label={t('Smaller')} className="rounded-full p-2 hover:bg-white/10"><Minimize2 className="h-6 w-6" /></button>
        </div>
      ) : null}
      <div className={big ? 'relative min-h-0 flex-1 overflow-hidden rounded-lg bg-black' : 'relative aspect-video overflow-hidden rounded-lg bg-black'}>
        <video ref={video} autoPlay playsInline muted className={`h-full w-full object-contain ${phase === 'live' ? '' : 'hidden'}`} />
        {phase !== 'live' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-white/80">
            {phase === 'error' || phase === 'ended' ? <VideoOff className="h-7 w-7" /> : <Loader2 className="h-7 w-7 animate-spin" />}
            <span>
              {phase === 'opening' ? t('Opening the camera…')
                : phase === 'waiting' ? t('Waiting for the radio…')
                  : phase === 'ended' ? t('The camera is closed.')
                    : error}
            </span>
          </div>
        ) : (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-red-600/90 px-2 py-0.5 text-[11px] font-bold text-white">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> {t('LIVE')}
            {left !== null ? ` · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : ''}
          </span>
        )}
        {phase === 'live' && !big ? (
          <button
            type="button" onClick={enlarge} aria-label={t('Bigger')} title={t('Bigger')}
            className="absolute right-2 top-2 rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
          >
            <Maximize2 className="h-5 w-5" />
          </button>
        ) : null}
      </div>
      <div ref={audio} className="hidden" aria-hidden />
      <button
        type="button" onClick={() => { shrink(); onClose(); }}
        className={big
          ? 'mx-auto inline-flex h-12 w-full max-w-sm items-center justify-center gap-2 rounded-lg bg-white/10 text-base font-bold text-white hover:bg-white/20'
          : 'inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-border text-base font-bold hover:bg-bg-soft/70'}
      >
        <X className="h-5 w-5" /> {t('Close camera')}
      </button>
    </div>
  );
}
