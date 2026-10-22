'use client';

import { useEffect, useRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Ambulance, CarFront, Crosshair, Flag, Truck } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import { escapeHtml } from '@/lib/utils';
import { useT } from '@/components/i18n';

/**
 * The big view of a crew on its way (0099), as a ride app shows the car: a
 * dark map, the road route glowing in the department's colour, the scene
 * flagged, and the crew's vehicles (light bar flashing) gliding along as
 * their phones report in. The map follows them until it is moved by hand;
 * "Follow" puts it back. The numbers sit on top: minutes, distance, arrival.
 */

export type MapCrew = {
  userId: string;
  name: string;
  lead: boolean;
  lat: number;
  lng: number;
  /** No fix for a while: drawn faded. */
  stale: boolean;
};

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const ICONS = { car: CarFront, ambulance: Ambulance, truck: Truck } as const;

function vehicleHtml(kind: keyof typeof ICONS, tone: string, lights: [string, string], lead: boolean, stale: boolean) {
  const Icon = ICONS[kind];
  const size = lead ? 40 : 32;
  const svg = renderToStaticMarkup(<Icon size={lead ? 20 : 16} color="#fff" strokeWidth={2.4} />);
  return `<div style="position:relative;width:${size}px;height:${size}px;opacity:${stale ? 0.45 : 1}">
    ${lead && !stale ? `<span class="animate-ping" style="position:absolute;inset:-4px;border-radius:14px;background:${tone};opacity:.35"></span>` : ''}
    <span style="position:absolute;inset:0;border-radius:12px;background:${tone};border:2.5px solid #fff;box-shadow:0 4px 14px rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center">${svg}</span>
    ${stale ? '' : `<span style="position:absolute;top:-6px;left:50%;transform:translateX(-50%);display:flex;gap:2px">
      <span class="lightbar-a" style="display:block;width:11px;height:5px;border-radius:3px;background:${lights[0]};box-shadow:0 0 8px ${lights[0]}"></span>
      <span class="lightbar-b" style="display:block;width:11px;height:5px;border-radius:3px;background:${lights[1]};box-shadow:0 0 8px ${lights[1]}"></span>
    </span>`}
  </div>`;
}

export function CrewRouteMap({ scene, crew, path, onTheWay = true, kind, tone, lights, overlay }: {
  /** Still heading there: draw the road. Arrived: no line. */
  onTheWay?: boolean;
  scene: { lat: number; lng: number };
  crew: MapCrew[];
  /** The road from the lead to the scene, latitude first. */
  path: Array<[number, number]> | null;
  kind: keyof typeof ICONS;
  tone: string;
  lights: [string, string];
  /** The numbers on top of the map. */
  overlay: React.ReactNode;
}) {
  const { t } = useT();
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const leafletRef = useRef<typeof import('leaflet') | null>(null);
  const routeRef = useRef<import('leaflet').LayerGroup | null>(null);
  const markers = useRef(new Map<string, import('leaflet').Marker>());
  const [ready, setReady] = useState(false);
  const [follow, setFollow] = useState(true);

  // The map, once.
  useEffect(() => {
    let disposed = false;
    void import('leaflet').then((L) => {
      if (disposed || !el.current) return;
      leafletRef.current = L;
      const map = L.map(el.current, { zoomControl: false, attributionControl: true }).setView([scene.lat, scene.lng], 14);
      L.tileLayer(`${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, { attribution: 'Tiles &copy; Esri', maxNativeZoom: 16, maxZoom: 19 }).addTo(map);
      L.tileLayer(`${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, { maxNativeZoom: 16, maxZoom: 19 }).addTo(map);
      L.control.zoom({ position: 'bottomright' }).addTo(map);
      routeRef.current = L.layerGroup().addTo(map);
      // The scene: a flag in a pulsing ring.
      const flag = renderToStaticMarkup(<Flag size={18} color="#fff" strokeWidth={2.6} />);
      L.marker([scene.lat, scene.lng], {
        icon: L.divIcon({
          className: '', iconSize: [44, 44], iconAnchor: [22, 22],
          html: `<div style="position:relative;width:44px;height:44px">
            <span class="animate-ping" style="position:absolute;inset:4px;border-radius:9999px;background:#ef4444;opacity:.4"></span>
            <span style="position:absolute;inset:8px;border-radius:9999px;background:#ef4444;border:3px solid #fff;box-shadow:0 0 0 3px rgba(239,68,68,.35);display:flex;align-items:center;justify-content:center">${flag}</span>
          </div>`,
        }),
        zIndexOffset: 500,
      }).addTo(map).bindTooltip(t('The scene'));
      // Moved by hand: stop following until asked.
      map.on('dragstart', () => setFollow(false));
      mapRef.current = map;
      setReady(true);
      setTimeout(() => map.invalidateSize(), 60);
    });
    return () => {
      disposed = true;
      markers.current.clear();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [scene.lat, scene.lng]);

  // The road, glowing: a dark casing under the department's colour.
  useEffect(() => {
    const L = leafletRef.current;
    const layer = routeRef.current;
    if (!ready || !L || !layer) return;
    layer.clearLayers();
    // Arrived: no line.
    if (!onTheWay) return;
    const lead = crew.find((c) => c.lead) ?? crew[0];
    // The road; only while it is being worked out, a faint dotted guide.
    const line = path ?? (lead ? [[lead.lat, lead.lng], [scene.lat, scene.lng]] as Array<[number, number]> : null);
    if (!line) return;
    if (path) L.polyline(line, { color: '#000', weight: 11, opacity: 0.55, lineCap: 'round' }).addTo(layer);
    L.polyline(line, path
      ? { color: tone, weight: 6, opacity: 0.95, lineCap: 'round' }
      : { color: tone, weight: 3, opacity: 0.45, lineCap: 'round', dashArray: '2 10' }).addTo(layer);
  }, [ready, path, crew, scene, tone, onTheWay]);

  // The vehicles: moved, not redrawn, so they glide.
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map) return;
    const seen = new Set<string>();
    for (const c of crew) {
      seen.add(c.userId);
      const html = vehicleHtml(kind, tone, lights, c.lead, c.stale);
      let m = markers.current.get(c.userId);
      if (!m) {
        const size = c.lead ? 40 : 32;
        m = L.marker([c.lat, c.lng], {
          icon: L.divIcon({ className: 'vehicle-marker', iconSize: [size, size], iconAnchor: [size / 2, size / 2], html }),
          zIndexOffset: c.lead ? 1000 : 800,
        }).addTo(map).bindTooltip(`<strong>${escapeHtml(c.name)}</strong>${c.lead ? ` · ${escapeHtml(t('Lead'))}` : ''}`);
        markers.current.set(c.userId, m);
      } else {
        m.setLatLng([c.lat, c.lng]);
      }
    }
    for (const [id, m] of markers.current) {
      if (!seen.has(id)) { m.remove(); markers.current.delete(id); }
    }
  }, [ready, crew, kind, tone, lights]);

  // Following: the crew and the scene in view as they close in.
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map || !follow) return;
    const pts: Array<[number, number]> = [[scene.lat, scene.lng], ...crew.map((c) => [c.lat, c.lng] as [number, number]), ...(path ?? [])];
    map.fitBounds(L.latLngBounds(pts), { padding: [70, 70], maxZoom: 17, animate: true });
  }, [ready, follow, crew, path, scene]);

  return (
    <div className="relative h-[380px] overflow-hidden rounded-xl border border-border sm:h-[460px]">
      <div ref={el} className="absolute inset-0 bg-[#1a1d24]" />
      <div className="pointer-events-none absolute inset-x-3 top-3 z-[500] flex justify-start">
        <div className="pointer-events-auto">{overlay}</div>
      </div>
      {!follow ? (
        <button
          type="button"
          onClick={() => setFollow(true)}
          className="absolute bottom-3 left-3 z-[500] inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-bold text-slate-900 shadow-lg"
        >
          <Crosshair className="h-3.5 w-3.5" /> {t('Follow the crew')}
        </button>
      ) : null}
    </div>
  );
}
