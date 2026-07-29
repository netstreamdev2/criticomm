'use client';

/**
 * Shared Leaflet map (client-only). Replaces V4's GIS views
 * (FireChief hydrant map, Disaster map, dispatcher live map).
 * Durban default centre. Street (OSM) or satellite (Esri) tiles;
 * circle markers by default, teardrop pins when `pin` is set.
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

const TILES = {
  street: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri',
  },
} as const;

const DURBAN: [number, number] = [-29.8587, 31.0218];

export function LeafletMap({
  markers,
  height = 480,
  center,
  zoom = 11,
  satellite = false,
  pin = false,
}: {
  markers: MapMarker[];
  height?: number;
  center?: [number, number];
  zoom?: number;
  /** Esri World Imagery instead of OSM streets. */
  satellite?: boolean;
  /** Teardrop pins (dispatch-board style) instead of circle markers. */
  pin?: boolean;
}) {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    // Leaflet touches `window` at import time — load it inside the effect.
    let cleanup = () => {};
    void import('leaflet').then((L) => {
      if (disposed || !el.current) return;

      const map = L.map(el.current, { zoomControl: true }).setView(center ?? DURBAN, zoom);
      const tiles = satellite ? TILES.satellite : TILES.street;
      L.tileLayer(tiles.url, { maxZoom: 19, attribution: tiles.attribution }).addTo(map);

      const group = L.featureGroup();
      for (const m of markers) {
        const colour = COLORS[m.kind ?? 'default'] ?? COLORS.default!;
        const marker = pin
          ? L.marker([m.lat, m.lng], {
              icon: L.divIcon({
                className: 'map-teardrop-wrap',
                html: `<span class="map-teardrop" style="--pin:${colour}"></span>`,
                iconSize: [26, 26],
                iconAnchor: [13, 24],
                popupAnchor: [0, -22],
              }),
            })
          : L.circleMarker([m.lat, m.lng], {
              radius: 8,
              weight: 2,
              color: colour,
              fillColor: colour,
              fillOpacity: 0.55,
            });
        if (m.popupHtml) marker.bindPopup(m.popupHtml);
        group.addLayer(marker);
      }
      group.addTo(map);
      if (markers.length > 0 && !center) {
        map.fitBounds(group.getBounds().pad(0.2), { maxZoom: 14 });
      }

      // Guard against a container that was sized after init (grid settling).
      setTimeout(() => map.invalidateSize(), 60);

      cleanup = () => map.remove();
    });

    return () => {
      disposed = true;
      cleanup();
    };
    // Markers are computed server-side per render; identity via JSON is fine here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(markers), center?.[0], center?.[1], zoom, satellite, pin]);

  return <div ref={el} style={{ height }} className="w-full" />;
}
