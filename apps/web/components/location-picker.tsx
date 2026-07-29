'use client';

import { useEffect, useRef, useState } from 'react';
import { Crosshair, Layers, Loader2 } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import { cn } from '@/lib/utils';

export type PickedPoint = { lat: number; lng: number };

const DURBAN: [number, number] = [-29.8587, 31.0218];

const BASEMAPS = {
  satellite: {
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri',
  },
  street: {
    label: 'Street',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
  },
} as const;

type Basemap = keyof typeof BASEMAPS;

/**
 * Scene-location map for the dispatch console.
 *
 * A call-taker needs to place a pin fast and be sure it is right: click
 * anywhere to move it, drag it to fine-tune, or hit the crosshair to snap to
 * the browser's own position. Every move reports coordinates upward so the
 * latitude/longitude fields and the reverse geocoder stay in step.
 */
export function LocationPicker({
  lat, lng, onPick, height = 340, interactive = true,
}: {
  lat: number | null;
  lng: number | null;
  onPick: (p: PickedPoint) => void;
  height?: number;
  interactive?: boolean;
}) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const markerRef = useRef<import('leaflet').Marker | null>(null);
  const layerRef = useRef<import('leaflet').TileLayer | null>(null);
  const leafletRef = useRef<typeof import('leaflet') | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  const [basemap, setBasemap] = useState<Basemap>('satellite');
  const [locating, setLocating] = useState(false);

  // Build the map once; later prop changes are applied imperatively so a
  // coordinate edit never tears down and rebuilds the tiles.
  useEffect(() => {
    let disposed = false;
    void import('leaflet').then((L) => {
      if (disposed || !el.current || mapRef.current) return;
      leafletRef.current = L;

      const start: [number, number] = lat && lng ? [lat, lng] : DURBAN;
      const map = L.map(el.current, { zoomControl: true, attributionControl: true })
        .setView(start, lat && lng ? 16 : 11);
      mapRef.current = map;

      layerRef.current = L.tileLayer(BASEMAPS.satellite.url, {
        maxZoom: 19,
        attribution: BASEMAPS.satellite.attribution,
      }).addTo(map);

      const icon = L.divIcon({
        className: 'criticom-pin',
        html:
          '<span class="criticom-pin-dot"></span>' +
          '<span class="criticom-pin-pulse"></span>',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });

      const marker = L.marker(start, { icon, draggable: interactive }).addTo(map);
      markerRef.current = marker;

      if (interactive) {
        marker.on('dragend', () => {
          const p = marker.getLatLng();
          onPickRef.current({ lat: p.lat, lng: p.lng });
        });
        map.on('click', (e: import('leaflet').LeafletMouseEvent) => {
          marker.setLatLng(e.latlng);
          onPickRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
        });
      }

      // Tiles render blank if the container was sized after init (common inside
      // a grid that settles on the next frame).
      setTimeout(() => map.invalidateSize(), 60);
    });

    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Deliberately once — see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow externally-changed coordinates (typed in, or set by geocoding).
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker || lat === null || lng === null) return;
    const cur = marker.getLatLng();
    if (Math.abs(cur.lat - lat) < 1e-7 && Math.abs(cur.lng - lng) < 1e-7) return;
    marker.setLatLng([lat, lng]);
    map.setView([lat, lng], Math.max(map.getZoom(), 16), { animate: true });
  }, [lat, lng]);

  const switchBasemap = (next: Basemap) => {
    setBasemap(next);
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    layerRef.current?.remove();
    layerRef.current = L.tileLayer(BASEMAPS[next].url, {
      maxZoom: 19,
      attribution: BASEMAPS[next].attribution,
    }).addTo(map);
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        onPickRef.current({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  return (
    <div className="relative overflow-hidden rounded-lg border border-border">
      <div ref={el} style={{ height }} className="w-full" />

      {interactive ? (
        <div className="absolute right-2 top-2 z-[400] flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => switchBasemap(basemap === 'satellite' ? 'street' : 'satellite')}
            title={`Switch to ${basemap === 'satellite' ? 'street' : 'satellite'} view`}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-card/95 px-2.5 py-1.5 text-[11px] font-semibold shadow-lg backdrop-blur hover:bg-muted"
          >
            <Layers className="h-3.5 w-3.5" />
            {BASEMAPS[basemap === 'satellite' ? 'street' : 'satellite'].label}
          </button>
          <button
            type="button"
            onClick={useMyLocation}
            title="Centre on my position"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-card/95 px-2.5 py-1.5 text-[11px] font-semibold shadow-lg backdrop-blur hover:bg-muted"
          >
            {locating
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Crosshair className="h-3.5 w-3.5" />}
            My position
          </button>
        </div>
      ) : null}

      {interactive ? (
        <p className={cn(
          'pointer-events-none absolute bottom-2 left-2 z-[400] rounded-md bg-black/65 px-2 py-1',
          'text-[10px] font-medium text-white backdrop-blur',
        )}>
          Click or drag the pin to set the scene
        </p>
      ) : null}
    </div>
  );
}
