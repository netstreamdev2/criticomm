'use client';

/**
 * Shared Leaflet map (client-only). Replaces V4's GIS views
 * (FireChief hydrant map, Disaster map, dispatcher live map).
 * Tiles: OpenStreetMap. Durban default centre.
 */
import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';

export type MapMarker = {
  id: string;
  lat: number;
  lng: number;
  /** 'critical' | 'high' | 'medium' | 'low' | 'hydrant' | 'unit' | 'default' */
  kind?: string;
  popupHtml?: string;
};

const COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#f59e0b',
  low: '#22c55e',
  hydrant: '#38bdf8',
  unit: '#a78bfa',
  default: '#38bdf8',
};

const DURBAN: [number, number] = [-29.8587, 31.0218];

export function LeafletMap({
  markers,
  height = 480,
  center,
  zoom = 11,
}: {
  markers: MapMarker[];
  height?: number;
  center?: [number, number];
  zoom?: number;
}) {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    // Leaflet touches `window` at import time — load it inside the effect.
    let cleanup = () => {};
    void import('leaflet').then((L) => {
      if (disposed || !el.current) return;

      const map = L.map(el.current, { zoomControl: true }).setView(center ?? DURBAN, zoom);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);

      const group = L.featureGroup();
      for (const m of markers) {
        const marker = L.circleMarker([m.lat, m.lng], {
          radius: 8,
          weight: 2,
          color: COLORS[m.kind ?? 'default'] ?? COLORS.default!,
          fillColor: COLORS[m.kind ?? 'default'] ?? COLORS.default!,
          fillOpacity: 0.55,
        });
        if (m.popupHtml) marker.bindPopup(m.popupHtml);
        group.addLayer(marker);
      }
      group.addTo(map);
      if (markers.length > 0 && !center) {
        map.fitBounds(group.getBounds().pad(0.2), { maxZoom: 14 });
      }

      cleanup = () => map.remove();
    });

    return () => {
      disposed = true;
      cleanup();
    };
    // Markers are computed server-side per render; identity via JSON is fine here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(markers), center?.[0], center?.[1], zoom]);

  return <div ref={el} style={{ height }} className="w-full" />;
}
