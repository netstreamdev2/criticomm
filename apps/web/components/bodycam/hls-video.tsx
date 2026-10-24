'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type Hls from 'hls.js';
import { cn } from '@/lib/utils';

/**
 * Plays an HLS stream. Safari plays HLS itself; Chrome and Edge (the control
 * room's browsers) need hls.js, loaded only when a feed opens. A media hiccup
 * is recovered twice before giving up; a stream that stops answering is
 * reported, because on 4G that usually means lost signal.
 *
 * Live is kept lean and close to the edge — just live, no rewind. Going back in
 * time is a separate thing (recorded footage), so the live view doesn't carry a
 * heavy buffer that adds latency. A spinner shows while it connects or rebuffers.
 */
export function HlsVideo({ src, onError, className, label, live = false }: {
  src: string;
  onError?: (message: string) => void;
  className?: string;
  /** What the video is, for screen readers. */
  label: string;
  /** Live tunes the player lean and close to the edge; footage buffers normally. */
  live?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const report = useRef(onError);
  report.current = onError;
  const [buffering, setBuffering] = useState(true);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let player: Hls | null = null;
    let stopped = false;
    let recoveries = 0;
    const fail = (message: string) => {
      if (!stopped) report.current?.(message);
    };

    // Spinner while there's no playable data yet, or when it stalls to rebuffer.
    const onWaiting = () => setBuffering(true);
    const onPlaying = () => setBuffering(false);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('stalled', onWaiting);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('canplay', onPlaying);

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      void video.play().catch(() => {});
    } else {
      void import('hls.js').then(({ default: HlsJs }) => {
        if (stopped) return;
        if (!HlsJs.isSupported()) {
          fail('This browser cannot play the stream. Use a current Chrome, Edge or Firefox.');
          return;
        }
        // Live: stay near the edge, keep the buffer modest so it's responsive.
        // Footage: hls.js defaults, which buffer more for smooth VOD playback.
        player = new HlsJs(live
          ? { liveSyncDurationCount: 2, maxBufferLength: 15, backBufferLength: 10 }
          : {});
        player.on(HlsJs.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          if (data.type === HlsJs.ErrorTypes.MEDIA_ERROR && recoveries < 2) {
            recoveries += 1;
            player?.recoverMediaError();
            return;
          }
          fail(data.type === HlsJs.ErrorTypes.NETWORK_ERROR
            ? 'The stream stopped answering. The bodycam may have lost signal.'
            : 'The stream could not be played.');
        });
        player.on(HlsJs.Events.MANIFEST_PARSED, () => {
          void video.play().catch(() => {});
        });
        player.loadSource(src);
        player.attachMedia(video);
      }).catch(() => fail('The video player could not be loaded.'));
    }

    return () => {
      stopped = true;
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('stalled', onWaiting);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('canplay', onPlaying);
      player?.destroy();
      video.removeAttribute('src');
      video.load();
    };
  }, [src, live]);

  return (
    <div className={cn('relative h-full w-full bg-black', className)}>
      <video
        ref={ref}
        aria-label={label}
        muted
        playsInline
        autoPlay
        controls
        className="h-full w-full bg-black object-contain"
      />
      {buffering ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/90">
          <Loader2 className="h-7 w-7 animate-spin" />
          <span className="text-xs font-medium">Connecting to the camera…</span>
        </div>
      ) : null}
    </div>
  );
}
