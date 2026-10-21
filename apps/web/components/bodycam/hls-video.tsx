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
 * The player buffers generously and keeps a back-buffer, trading a few seconds
 * of latency for smooth playback that doesn't stutter on bursty 4G. For live
 * that back-buffer also powers a YouTube-style DVR bar: scrub back over what
 * you've watched, with a red "Live" badge that greys to "Back to Live" once you
 * do. It all lives in the browser's buffer, so nothing is recorded server-side.
 */

// Treat the view as "live" when within this many seconds of the live edge.
const EDGE_SECONDS = 12;

export function HlsVideo({ src, onError, className, label, live = false }: {
  src: string;
  onError?: (message: string) => void;
  className?: string;
  /** What the video is, for screen readers. */
  label: string;
  /** Show the live DVR bar (rewind + Back to Live). Footage uses native controls. */
  live?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const report = useRef(onError);
  report.current = onError;
  // Following the live edge (thumb pinned right) until the viewer scrubs back.
  const following = useRef(true);
  const [dvr, setDvr] = useState({ start: 0, end: 1, current: 1, atEdge: true });
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
        // Smoothness over latency: play a few segments back and buffer ahead so
        // a bursty 4G upload doesn't stall; keep a couple of minutes behind for
        // the live rewind.
        player = new HlsJs({
          liveSyncDurationCount: 3,
          liveMaxLatencyDurationCount: 15,
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          backBufferLength: 120,
        });
        hlsRef.current = player;
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
      hlsRef.current = null;
      video.removeAttribute('src');
      video.load();
    };
  }, [src]);

  // Drive the DVR bar. Following live, the thumb stays pinned to the right edge;
  // once scrubbed back, it shows the real position until it catches up to live.
  useEffect(() => {
    if (!live) return;
    const video = ref.current;
    if (!video) return;
    const id = setInterval(() => {
      const seek = video.seekable;
      if (!seek.length) return;
      const start = seek.start(0);
      const edge = hlsRef.current?.liveSyncPosition ?? seek.end(seek.length - 1);
      const current = video.currentTime;
      const atEdge = current >= edge - EDGE_SECONDS;
      if (atEdge) following.current = true; // caught up
      setDvr(following.current
        ? { start, end: edge, current: edge, atEdge: true }
        : { start, end: edge, current, atEdge });
    }, 250);
    return () => clearInterval(id);
  }, [live]);

  const goLive = () => {
    const video = ref.current;
    if (!video) return;
    const seek = video.seekable;
    const edge = hlsRef.current?.liveSyncPosition ?? (seek.length ? seek.end(seek.length - 1) : video.currentTime);
    following.current = true;
    video.currentTime = edge;
    void video.play().catch(() => {});
    setDvr((d) => ({ ...d, current: edge, atEdge: true }));
  };

  const seekTo = (value: number) => {
    const video = ref.current;
    if (!video) return;
    following.current = value >= dvr.end - EDGE_SECONDS;
    video.currentTime = value;
    setDvr((d) => ({ ...d, current: value, atEdge: following.current }));
  };

  return (
    <div className={cn('relative h-full w-full bg-black', className)}>
      <video
        ref={ref}
        aria-label={label}
        muted
        playsInline
        autoPlay
        controls={!live}
        className="h-full w-full bg-black object-contain"
      />

      {buffering ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/90">
          <Loader2 className="h-7 w-7 animate-spin" />
          <span className="text-xs font-medium">Connecting to the camera…</span>
        </div>
      ) : null}

      {live ? (
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 bg-gradient-to-t from-black/85 to-transparent px-3 pb-2.5 pt-8">
          <button
            type="button"
            onClick={goLive}
            disabled={dvr.atEdge}
            aria-label={dvr.atEdge ? 'Watching live' : 'Jump back to live'}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide transition-colors',
              dvr.atEdge ? 'bg-red-600 text-white' : 'cursor-pointer bg-white/15 text-white hover:bg-white/25',
            )}
          >
            <span className={cn('h-2 w-2 rounded-full', dvr.atEdge ? 'bg-white' : 'bg-white/50')} />
            {dvr.atEdge ? 'Live' : 'Back to Live'}
          </button>
          <input
            type="range"
            aria-label="Rewind the live feed"
            min={dvr.start}
            max={dvr.end}
            step={0.1}
            value={dvr.current}
            onPointerDown={() => { following.current = false; }}
            onChange={(e) => seekTo(Number(e.target.value))}
            className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/25 accent-red-600"
          />
        </div>
      ) : null}
    </div>
  );
}
