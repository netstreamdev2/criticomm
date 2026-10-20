'use client';

import { useEffect, useRef, useState } from 'react';
import type { Circle, FeatureGroup, LayerGroup, Map as LeafletMapT, Marker, TileLayer } from 'leaflet';
import { Crosshair } from 'lucide-react';
import { batteryTone, type RadioView } from '@criticom/api/radio';
import type { DutyTrackPoint } from '@criticom/api';
import { routeSegments } from '@/lib/ops-map/layers';
import { formatSaTime } from '@/lib/utils';
import 'leaflet/dist/leaflet.css';

/**
 * The radios on a map: each one where it last was, as the person it belongs
 * to. The ring is the battery; the centre is green when on (pulsing while
 * talking) and grey when off. The selected radio shows how sure its position is and,
 * when its person was on duty, the route it took, with the stretches
 * recorded with no signal dashed.
 *
 * The map is made once and its markers moved in place, so a refresh never
 * flickers or throws the dispatcher off what they were looking at.
 */

type Basemap = 'street' | 'satellite';
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const BASE_TILES: Record<Basemap, Array<{ url: string; attribution?: string; maxNativeZoom?: number }>> = {
  street: [{ url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; OpenStreetMap contributors' }],
  satellite: [{ url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, attribution: 'Tiles &copy; Esri' }],
};
const BASEMAP_LABEL: Record<Basemap, string> = { street: 'Map', satellite: 'Satellite' };
const DURBAN: [number, number] = [-29.8587, 31.0218];
const ON = '#22c55e';
const OFF = '#64748b';
const ROUTE = '#2563eb';
const time = (iso: string) => formatSaTime(iso).split(' ').at(-1)?.slice(0, 5) ?? '';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Where a radio is, when it has a position. */
export function positionOf(v: RadioView): [number, number] | null {
  const l = v.live;
  return l && l.lat !== null && l.lng !== null ? [l.lat, l.lng] : null;
}

function stateTone(v: RadioView): string {
  return v.live?.online ? ON : OFF;
}

function pinHtml(v: RadioView, selected: boolean): string {
  const l = v.live;
  const battery = l?.battery ?? null;
  const ring = battery === null
    ? 'rgba(100,116,139,.45)'
    : `conic-gradient(${batteryTone(battery)} ${battery * 3.6}deg, rgba(100,116,139,.35) 0)`;
  const centre = stateTone(v);
  const faded = v.freshness === 'old' || !l?.online ? 'opacity:.7;' : '';
  const talking = l?.online && l.talking
    ? `<span class="absolute inset-0 animate-ping rounded-full" style="background:${centre};opacity:.45"></span>`
    : '';
  const size = selected ? 34 : 28;
  return `
    <div style="display:flex;flex-direction:column;align-items:center;${faded}">
      <span class="relative flex items-center justify-center rounded-full shadow-lg"
            style="width:${size}px;height:${size}px;background:${ring};${selected ? `box-shadow:0 0 0 3px #fff,0 0 18px ${centre};` : ''}">
        ${talking}
        <span class="relative rounded-full" style="width:${size - 10}px;height:${size - 10}px;background:${centre};border:2px solid rgba(255,255,255,.85)"></span>
      </span>
      <span class="mt-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold text-white shadow"
            style="background:rgba(15,23,42,.82);max-width:150px;overflow:hidden;text-overflow:ellipsis">
        ${esc(v.title)}${battery === null ? '' : ` · ${battery}%`}
      </span>
    </div>`;
}

function tooltipHtml(v: RadioView): string {
  const l = v.live;
  const lines = [
    `<strong>${esc(v.title)}</strong>`,
    l?.online ? (l.talking ? 'Talking' : 'On') : 'Off',
    l?.battery === null || l?.battery === undefined ? null : `${l.battery}%`,
    l?.fixAt ? esc(time(l.fixAt)) : null,
  ].filter(Boolean);
  return lines.join('<br/>');
}

export function RadioMap({ views, selectedKey, onSelect, route, height = 560 }: {
  views: RadioView[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  /** The selected radio's route, when its person was on duty. */
  route: DutyTrackPoint[] | null;
  height?: number;
}) {
  const el = useRef<HTMLDivElement>(null);
  const lib = useRef<typeof import('leaflet') | null>(null);
  const map = useRef<LeafletMapT | null>(null);
  const tiles = useRef<TileLayer[]>([]);
  const pins = useRef(new Map<string, { marker: Marker; html: string }>());
  const pinLayer = useRef<FeatureGroup | null>(null);
  const routeLayer = useRef<LayerGroup | null>(null);
  const accuracy = useRef<Circle | null>(null);
  const fitted = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const [ready, setReady] = useState(false);
  const [basemap, setBasemap] = useState<Basemap>('street');

  // The map, once.
  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    void import('leaflet').then((L) => {
      if (disposed || !el.current) return;
      lib.current = L;
      const m = L.map(el.current, { zoomControl: true, preferCanvas: true }).setView(DURBAN, 11);
      map.current = m;
      pinLayer.current = L.featureGroup().addTo(m);
      routeLayer.current = L.layerGroup().addTo(m);
      setTimeout(() => m.invalidateSize(), 60);
      setReady(true);
      cleanup = () => {
        m.remove();
        map.current = null;
        pins.current.clear();
      };
    });
    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  useEffect(() => {
    const L = lib.current;
    const m = map.current;
    if (!ready || !L || !m) return;
    for (const t of tiles.current) t.remove();
    tiles.current = BASE_TILES[basemap].map((t, i) =>
      L.tileLayer(t.url, { maxZoom: 19, maxNativeZoom: t.maxNativeZoom, attribution: t.attribution, zIndex: i + 1 }).addTo(m),
    );
  }, [ready, basemap]);

  // The radios: moved in place, added and taken away as they come and go.
  useEffect(() => {
    const L = lib.current;
    const layer = pinLayer.current;
    if (!ready || !L || !layer) return;
    const keep = new Set<string>();
    for (const v of views) {
      const at = positionOf(v);
      if (!at) continue;
      keep.add(v.key);
      const html = pinHtml(v, v.key === selectedKey);
      const existing = pins.current.get(v.key);
      if (existing) {
        existing.marker.setLatLng(at);
        if (existing.html !== html) {
          existing.marker.setIcon(L.divIcon({ className: '', html, iconSize: [150, 52], iconAnchor: [75, 17] }));
          existing.html = html;
        }
        existing.marker.setTooltipContent(tooltipHtml(v));
        existing.marker.setZIndexOffset(v.key === selectedKey ? 1000 : v.live?.online ? 100 : 0);
      } else {
        const marker = L.marker(at, {
          icon: L.divIcon({ className: '', html, iconSize: [150, 52], iconAnchor: [75, 17] }),
          keyboard: false,
          zIndexOffset: v.live?.online ? 100 : 0,
        })
          .bindTooltip(tooltipHtml(v), { direction: 'top', offset: [0, -16], opacity: 0.96 })
          .on('click', () => onSelectRef.current(v.key))
          .addTo(layer);
        pins.current.set(v.key, { marker, html });
      }
    }
    for (const [key, p] of pins.current) {
      if (!keep.has(key)) {
        p.marker.remove();
        pins.current.delete(key);
      }
    }
    // Fit the radios once; after that the dispatcher decides where to look.
    if (!fitted.current && keep.size && map.current) {
      map.current.fitBounds(layer.getBounds().pad(0.25), { maxZoom: 15 });
      fitted.current = true;
    }
  }, [ready, views, selectedKey]);

  // The selected radio: how sure its position is, following it as it moves.
  useEffect(() => {
    const L = lib.current;
    const m = map.current;
    if (!ready || !L || !m) return;
    accuracy.current?.remove();
    accuracy.current = null;
    const v = views.find((x) => x.key === selectedKey);
    const at = v ? positionOf(v) : null;
    const acc = v?.live?.accuracyM;
    if (!v || !at || !acc || acc <= 0) return;
    accuracy.current = L.circle(at, {
      radius: acc, color: stateTone(v), weight: 1, fillColor: stateTone(v), fillOpacity: 0.12, interactive: false,
    }).addTo(m);
  }, [ready, views, selectedKey]);

  // Centred when chosen; not on every refresh, so the dispatcher can look elsewhere.
  useEffect(() => {
    const m = map.current;
    const v = views.find((x) => x.key === selectedKey);
    const at = v ? positionOf(v) : null;
    if (ready && m && at) m.panTo(at, { animate: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, selectedKey]);

  // The route: solid where it was sent live, dashed where it waited for signal.
  useEffect(() => {
    const L = lib.current;
    const g = routeLayer.current;
    if (!ready || !L || !g) return;
    g.clearLayers();
    if (!route?.length) return;
    for (const seg of routeSegments(route)) {
      L.polyline(seg.points, {
        color: ROUTE, weight: seg.offline ? 3 : 5, opacity: seg.offline ? 0.95 : 0.75,
        dashArray: seg.offline ? '6 8' : undefined, lineCap: 'round', lineJoin: 'round',
      })
        .bindTooltip(`${esc(time(seg.from))} – ${esc(time(seg.to))}`, { sticky: true })
        .addTo(g);
    }
    const first = route[0]!;
    L.circleMarker([first.lat, first.lng], { radius: 5, color: '#fff', weight: 2, fillColor: ROUTE, fillOpacity: 1 })
      .bindTooltip(esc(time(first.at)))
      .addTo(g);
  }, [ready, route]);

  const fitAll = () => {
    const m = map.current;
    const layer = pinLayer.current;
    if (m && layer && pins.current.size) m.fitBounds(layer.getBounds().pad(0.25), { maxZoom: 15 });
  };

  return (
    <div className="frost relative overflow-hidden rounded-xl border border-border">
      <div ref={el} style={{ height }} className="w-full" />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[500] flex flex-wrap items-start justify-end gap-2 p-3">
        <div className="pointer-events-auto flex gap-1 rounded-full border border-white/15 bg-slate-900/75 p-1 shadow-lg backdrop-blur">
          {(Object.keys(BASEMAP_LABEL) as Basemap[]).map((b) => (
            <button
              key={b} type="button" onClick={() => setBasemap(b)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${basemap === b ? 'bg-white text-slate-900' : 'text-white/80 hover:text-white'}`}
            >
              {BASEMAP_LABEL[b]}
            </button>
          ))}
        </div>
        <button
          type="button" onClick={fitAll}
          className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-slate-900/75 px-3 py-1.5 text-xs font-semibold text-white shadow-lg backdrop-blur"
        >
          <Crosshair className="h-3.5 w-3.5" /> All
        </button>
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 z-[500] max-w-[calc(100%-1.5rem)] rounded-lg border border-white/15 bg-slate-900/80 px-3 py-2 text-[11px] text-white/90 shadow-lg backdrop-blur">
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-[#22c55e]" /> On</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-[#64748b]" /> Off</span>
          {route?.length ? <span className="inline-flex items-center gap-1.5"><span className="h-1 w-5 rounded bg-[#2563eb]" /> Route</span> : null}
        </p>
      </div>
    </div>
  );
}
