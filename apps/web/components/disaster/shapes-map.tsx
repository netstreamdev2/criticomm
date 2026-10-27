'use client';

import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import type * as Leaflet from 'leaflet';

export type MapShape = { points: Array<[number, number]>; colour: string; label?: string };

const DURBAN: [number, number] = [-29.8587, 31.0218];
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';

/**
 * A small map that draws areas: a warning's areas, a ward. Fits itself to
 * the shapes; the label shows on hover. The same dark basemap as the live map.
 */
export function ShapesMap({ shapes, height = 320, className }: { shapes: MapShape[]; height?: number; className?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const key = JSON.stringify(shapes.map((s) => [s.colour, s.label, s.points.length, s.points[0]]));

  useEffect(() => {
    let map: Leaflet.Map | null = null;
    let disposed = false;
    void import('leaflet').then((L) => {
      if (disposed || !el.current) return;
      map = L.map(el.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false }).setView(DURBAN, 9);
      L.tileLayer(`${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 16, attribution: 'Tiles &copy; Esri' }).addTo(map);
      L.tileLayer(`${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 16 }).addTo(map);
      const group = L.featureGroup();
      for (const s of shapes) {
        if (s.points.length < 3) continue;
        const poly = L.polygon(s.points, { color: s.colour, weight: 2, fillColor: s.colour, fillOpacity: 0.25 });
        if (s.label) poly.bindTooltip(s.label, { sticky: true });
        poly.addTo(group);
      }
      group.addTo(map);
      if (group.getLayers().length) map.fitBounds(group.getBounds(), { padding: [16, 16], maxZoom: 13 });
    });
    return () => {
      disposed = true;
      map?.remove();
    };
  }, [key]);

  return <div ref={el} className={className} style={{ height }} role="img" aria-label="Map of the areas" />;
}
