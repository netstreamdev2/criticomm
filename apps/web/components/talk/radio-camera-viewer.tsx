'use client';

import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track, type RemoteTrack } from 'livekit-client';
import { Loader2, VideoOff, X } from 'lucide-react';
import { endRadioCamera, radioCameraPass, startRadioCamera } from '@criticom/api';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useT } from '@/components/i18n';

/**
 * A radio's camera, live (0091). Opening it tells the officer (buzz, sound,
 * notification); closing this, or ten minutes, closes it on the radio too.
 * Nothing is recorded.
 */

type Phase = 'opening' | 'waiting' | 'live' | 'ended' | 'error';

export function RadioCameraViewer({ deviceId, onClose }: { deviceId: string; onClose: () => void }) {
  const { t } = useT();
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('opening');
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const supabase = getBrowserSupabase();
    let room: Room | null = null;
    let viewId: string | null = null;
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
        const view = await startRadioCamera(supabase, deviceId);
        viewId = view.id;
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
            : t('The camera did not open. Try again.'));
        setPhase('error');
      }
    })();

    return () => {
      closed = true;
      clearInterval(tick);
      void room?.disconnect();
      // Closing here closes it on the radio: the officer's camera never stays open for a tab left behind.
      if (viewId) void endRadioCamera(supabase, viewId).catch(() => {});
    };
  }, [deviceId, t]);

  return (
    <div className="space-y-2">
      <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
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
      </div>
      <div ref={audio} className="hidden" aria-hidden />
      <button
        type="button" onClick={onClose}
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-border text-base font-bold hover:bg-bg-soft/70"
      >
        <X className="h-5 w-5" /> {t('Close camera')}
      </button>
    </div>
  );
}
