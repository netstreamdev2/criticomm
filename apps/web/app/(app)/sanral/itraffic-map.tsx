'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Maximize2, Video } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/components/i18n';

/**
 * The SANRAL CCTV matrix from V4: i-traffic's own embedded map, framed. It
 * needs no API key. Clicking a camera inside it shows that camera's latest
 * snapshot (SANRAL publishes stills, not video). Areas and layers set the
 * embed's URL; the embed's own legend can still switch layers.
 */
const EMBED = 'https://www.i-traffic.co.za/Map/EmbeddedMap';

type Area = { id: string; label: string; region: string; lat?: number; lng?: number; zoom?: number };

const AREAS: Area[] = [
  { id: 'durban', label: 'eThekwini', region: 'KZN', lat: -29.8587, lng: 31.0218, zoom: 11 },
  { id: 'KZN', label: 'KwaZulu-Natal', region: 'KZN' },
  { id: 'GP', label: 'Gauteng', region: 'GP' },
  { id: 'WC', label: 'Western Cape', region: 'WC' },
  { id: 'EC', label: 'Eastern Cape', region: 'EC' },
  { id: 'ALL', label: 'All of South Africa', region: 'ALL' },
];

const LAYERS = [
  { id: 'Cameras', label: 'Cameras' },
  { id: 'MessageSigns', label: 'Overhead signs' },
  { id: 'Incidents', label: 'Incidents' },
  { id: 'Closures', label: 'Closures' },
  { id: 'Construction', label: 'Roadworks' },
  { id: 'Congestion', label: 'Congestion' },
  { id: 'TrafficSpeeds', label: 'Speeds' },
] as const;

/** V4 showed cameras and overhead signs; incidents are added so the room sees why a sign is lit. */
const DEFAULT_LAYERS = ['Cameras', 'MessageSigns', 'Incidents'];

export function ITrafficMap({ focus }: { focus?: { lat: number; lng: number } }) {
  const { t } = useT();
  const [area, setArea] = useState(focus ? 'focus' : 'durban');
  const [layers, setLayers] = useState<string[]>(DEFAULT_LAYERS);
  const frameBox = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);

  // The embed sizes its map once, on load, and ignores later resizes (it then
  // shows blank "no imagery" tiles). So it is given the box's exact size and
  // reloaded when that changes: full screen, or a resized window.
  useEffect(() => {
    const el = frameBox.current;
    if (!el) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      clearTimeout(t);
      t = setTimeout(() => {
        const next = { w: Math.round(width), h: Math.round(height) };
        setBox((cur) => (cur && Math.abs(cur.w - next.w) < 8 && Math.abs(cur.h - next.h) < 8 ? cur : next));
      }, 250);
    });
    ro.observe(el);
    return () => { clearTimeout(t); ro.disconnect(); };
  }, []);

  const view = useMemo(() => {
    const a: Area = area === 'focus' && focus
      ? { id: 'focus', label: 'Incident', region: 'KZN', lat: focus.lat, lng: focus.lng, zoom: 14 }
      : AREAS.find((x) => x.id === area) ?? AREAS[0]!;
    // No `size`: V4 sent size=0, which pins the map at 810×640.
    const q = new URLSearchParams({ region: a.region, layers: layers.join(',') });
    if (a.lat != null && a.lng != null) {
      q.set('Latitude', String(a.lat));
      q.set('Longitude', String(a.lng));
    }
    if (a.zoom != null) q.set('Zoom', String(a.zoom));
    return q;
  }, [area, layers, focus]);

  const openUrl = `${EMBED}?${view.toString()}`;
  const src = box ? `${openUrl}&width=${box.w}&height=${box.h}` : null;

  const toggle = (id: string) =>
    setLayers((cur) => (cur.includes(id) ? cur.filter((l) => l !== id) : [...cur, id]));

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-bg-soft px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-bold">
          <Video className="h-4 w-4 text-accent" /> {' '}{t('SANRAL CCTV matrix')}</h2>
        <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent">
          {t('i-traffic live')}</span>
        <div className="ml-auto flex items-center gap-2">
          <label htmlFor="itraffic-area" className="sr-only">{t('Area')}</label>
          <select
            id="itraffic-area"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            className="h-8 rounded-md border border-border bg-bg px-2 text-xs font-semibold focus:border-accent focus:outline-none"
          >
            {focus ? <option value="focus">{t('Around the incident')}</option> : null}
            {AREAS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
          <button
            type="button"
            onClick={() => void frameBox.current?.requestFullscreen?.()}
            aria-label={t('Full screen')}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-fg"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <a
            href={openUrl}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={t('Open on i-traffic')}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-fg"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2">
        {LAYERS.map((l) => {
          const on = layers.includes(l.id);
          return (
            <button
              key={l.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(l.id)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                on ? 'border-accent bg-accent/15 text-accent' : 'border-border text-muted-foreground hover:bg-muted',
              )}
            >
              {l.label}
            </button>
          );
        })}
        <span className="ml-auto self-center text-[11px] text-muted-foreground">
          {t('Click a camera for its latest snapshot.')}</span>
      </div>

      {/* The browser stretches this box to the whole screen in full screen; the map follows. */}
      <div ref={frameBox} className="relative h-[70vh] min-h-[420px] bg-black">
        {src ? (
          <iframe
            key={src}
            src={src}
            title={t('SANRAL freeway cameras on i-traffic')}
            className="absolute inset-0 block h-full w-full border-0"
            referrerPolicy="no-referrer"
            // i-traffic's scripts run in their own origin; it may not navigate our page.
            sandbox="allow-scripts allow-same-origin allow-popups"
            allowFullScreen
          />
        ) : null}
      </div>
    </div>
  );
}
