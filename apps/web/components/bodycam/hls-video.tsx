'use client';

import { useEffect, useRef } from 'react';
import type Hls from 'hls.js';
import { cn } from '@/lib/utils';

/**
 * Plays an HLS stream in the page. Safari plays HLS itself; Chrome and Edge
 * (the control room's browsers) need hls.js, loaded only when a feed opens.
 * A media hiccup is recovered twice before giving up; a stream that stops
 * answering is reported, because on 4G that usually means lost signal.
 */
export function HlsVideo({ src, onError, className, label }: {
  src: string;
  onError?: (message: string) => void;
  className?: string;
  /** What the video is, for screen readers. */
  label: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const report = useRef(onError);
  report.current = onError;

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let player: Hls | null = null;
    let stopped = false;
    let recoveries = 0;
    const fail = (message: string) => {
      if (!stopped) report.current?.(message);
    };

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
        player = new HlsJs({ liveSyncDurationCount: 2, maxBufferLength: 20 });
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
      player?.destroy();
      video.removeAttribute('src');
      video.load();
    };
  }, [src]);

  return (
    <video
      ref={ref}
      aria-label={label}
      muted
      playsInline
      autoPlay
      controls
      className={cn('h-full w-full bg-black object-contain', className)}
    />
  );
}
