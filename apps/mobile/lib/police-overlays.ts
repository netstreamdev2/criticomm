import { useEffect, useMemo, useRef, useState } from 'react';
import { tx } from '@criticom/db/i18n';
import { tNow } from './translator';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { listCrimeZones, listLiveMapZones, subscribeMapZones, type LiveMapZone } from '@criticom/api';
import {
  compass, crimeZones, hasPosition, isCrimeKind, zoneKind, type CrimeKind, type CrimeStation,
} from '@criticom/db/map-layers';
import { getApi, webUrl } from '@/lib/api-host';
import { getSupabase } from '@/lib/supabase';

/**
 * The police Live Map's overlays: SAPS crime zones, the perimeters and zones
 * command has shared with police, rain radar, and the weather now. The same
 * data and maths as the console's operations map (@criticom/db/map-layers),
 * read with the officer's own session, so RLS decides what they see.
 */

export type OverlayId = 'crime' | 'zones' | 'rain';
export type OverlayChoice = { on: OverlayId[]; crimeKind: CrimeKind };

const STORE_KEY = 'criticom:police-map-overlays';
/** Opens with crime zones and shared perimeters; rain is one tap away. */
const DEFAULT: OverlayChoice = { on: ['crime', 'zones'], crimeKind: 'all' };
const IDS: OverlayId[] = ['crime', 'zones', 'rain'];

/** The officer's overlay choice, remembered on this phone. */
export function useOverlayChoice() {
  const [choice, setChoice] = useState<OverlayChoice>(DEFAULT);
  useEffect(() => {
    AsyncStorage.getItem(STORE_KEY)
      .then((raw) => {
        if (!raw) return;
        const saved = JSON.parse(raw) as Partial<OverlayChoice>;
        setChoice({
          on: Array.isArray(saved.on) ? saved.on.filter((x): x is OverlayId => IDS.includes(x as OverlayId)) : DEFAULT.on,
          crimeKind: isCrimeKind(saved.crimeKind) ? saved.crimeKind : 'all',
        });
      })
      .catch(() => {});
  }, []);
  const update = (next: OverlayChoice) => {
    setChoice(next);
    AsyncStorage.setItem(STORE_KEY, JSON.stringify(next)).catch(() => {});
  };
  return {
    choice,
    toggle: (id: OverlayId) => update({
      ...choice, on: choice.on.includes(id) ? choice.on.filter((x) => x !== id) : [...choice.on, id],
    }),
    setCrimeKind: (crimeKind: CrimeKind) => update({ ...choice, crimeKind }),
  };
}

/* ── Crime zones ────────────────────────────────────────────────────── */

/** A crime circle as the map draws it: position, size, colour and its card's words. */
export type CrimeCircle = {
  id: string; lat: number; lng: number; radius: number; colour: string;
  station: string; count: number; countText: string; rank: number; of: number; year: string | null; category: string;
};

const CATEGORY_WORDS: Record<CrimeKind, string> = {
  all: tx('all six categories'), murder: tx('murder'), carjacking: tx('carjacking'),
  burglary_residential: tx('burglary at homes'), robbery_residential: tx('robbery at homes'),
  drug_crime: tx('drug-related crime'), dui: tx('driving under the influence'),
};

/** SAPS spells stations in lower case: "durban central" → "Durban Central". */
export function titleCase(s: string) {
  return s.toLowerCase().replace(/(^|[\s(-])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase());
}

/** 12345 → "12 345", the South African way. */
export function groupThousands(n: number) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** SAPS station statistics, loaded once when the layer is first switched on. */
export function useCrimeCircles(enabled: boolean, kind: CrimeKind) {
  const [data, setData] = useState<{ year: string | null; stations: CrimeStation[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || data) return;
    let alive = true;
    listCrimeZones(getSupabase())
      .then((r) => { if (alive) { setData(r as { year: string | null; stations: CrimeStation[] }); setError(null); } })
      .catch(() => { if (alive) setError(tNow('Crime zones could not be loaded.')); });
    return () => { alive = false; };
  }, [enabled, data]);

  const circles = useMemo<CrimeCircle[]>(() => {
    if (!enabled || !data) return [];
    const zones = crimeZones(data.stations, kind);
    return zones.map((z) => ({
      id: String(z.station.id), lat: z.lat, lng: z.lng, radius: z.radius, colour: z.colour,
      station: titleCase(z.station.station_name), count: z.count, countText: groupThousands(z.count), rank: z.rank, of: zones.length,
      year: data.year, category: tNow(CATEGORY_WORDS[kind]),
    }));
  }, [enabled, data, kind]);

  const empty = enabled && data !== null && data.stations.length === 0;
  return { circles, year: data?.year ?? null, error: error ?? (empty ? tNow('No crime statistics are loaded yet.') : null) };
}

/* ── Perimeters and zones ───────────────────────────────────────────── */

/** A zone as the map draws it. Coordinates are [lat, lng]; a circle is its centre and radius. */
export type ZoneShape = {
  id: string; shape: 'polygon' | 'circle' | 'line' | 'point';
  points: Array<[number, number]>; radius: number | null;
  colour: string; mark: string; kind: string; name: string;
  reason: string | null; setBy: string; incident: string | null;
};

function toPoints(shape: string, geometry: unknown): Array<[number, number]> {
  const g = geometry as { type?: string; coordinates?: unknown } | null;
  const pair = (c: unknown): [number, number] | null => {
    const a = c as number[];
    return Array.isArray(a) && hasPosition(a[1], a[0]) ? [Number(a[1]), Number(a[0])] : null;
  };
  const list = (cs: unknown) => (Array.isArray(cs) ? cs.map(pair).filter((p): p is [number, number] => p !== null) : []);
  if (!g?.coordinates) return [];
  if (shape === 'polygon') return list((g.coordinates as unknown[])[0]);
  if (shape === 'line') return list(g.coordinates);
  const p = pair(g.coordinates);
  return p ? [p] : [];
}

export function toZoneShape(z: LiveMapZone): ZoneShape | null {
  const points = toPoints(z.shape, z.geometry);
  const need = z.shape === 'polygon' ? 3 : z.shape === 'line' ? 2 : 1;
  if (points.length < need) return null;
  const k = zoneKind(z.kind);
  return {
    id: z.id, shape: z.shape, points, radius: z.shape === 'circle' ? z.radius_m : null,
    colour: k.colour, mark: k.mark, kind: tNow(k.label), name: z.name, reason: z.reason,
    setBy: [z.created_by_name, z.created_by_role].filter(Boolean).join(' · ') || tNow('Command'),
    incident: z.incident ? `${z.incident.incident_number} · ${z.incident.incident_type}` : null,
  };
}

/** Perimeters and zones shared with this officer, kept live by Realtime. */
export function useLiveZoneShapes(enabled: boolean) {
  const [zones, setZones] = useState<LiveMapZone[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const sb = getSupabase();
    const load = () => {
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        listLiveMapZones(sb).then((rows) => { if (alive) setZones(rows); }).catch(() => {});
      }, 250);
    };
    load();
    const stop = subscribeMapZones(sb, load);
    // A zone's end time passing is not an event: look again every minute.
    const tick = setInterval(load, 60_000);
    return () => {
      alive = false;
      stop();
      clearInterval(tick);
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    };
  }, [enabled]);
  return useMemo(
    () => (enabled ? zones.map(toZoneShape).filter((z): z is ZoneShape => z !== null) : []),
    [enabled, zones],
  );
}

/* ── Weather ────────────────────────────────────────────────────────── */

export type WeatherNow = {
  configured: boolean; tempC?: number | null; windSpeedMs?: number | null; windDeg?: number | null;
  windGustMs?: number | null; humidity?: number | null; description?: string | null; error?: string;
};

/** Durban's weather now, from the server (the key never ships in the app). Every ten minutes. */
export function useWeatherNow() {
  const [weather, setWeather] = useState<WeatherNow | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => getApi<WeatherNow>('/api/wind')
      .then((w) => { if (alive) setWeather(w); })
      .catch(() => {});
    void load();
    const t = setInterval(load, 10 * 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return weather;
}

export function weatherLine(w: WeatherNow | null) {
  if (!w?.configured || w.error) return null;
  const temp = w.tempC != null ? `${Math.round(w.tempC)}°` : null;
  const wind = w.windSpeedMs != null ? `${compass(w.windDeg)} ${Math.round(w.windSpeedMs * 3.6)} km/h`.trim() : null;
  return [temp, wind].filter(Boolean).join(' · ') || null;
}

/** Rain radar tile address with a two-hour pass, renewed before it runs out. */
export function useRainTiles(enabled: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  const [off, setOff] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let renew: ReturnType<typeof setTimeout> | null = null;
    const load = () => getApi<{ configured: boolean; pass?: string; expiresAt?: string }>('/api/weather/pass')
      .then((r) => {
        if (!alive) return;
        const base = webUrl('/api/weather/tiles/rain/{z}/{x}/{y}');
        if (!r.configured || !r.pass || !base) { setOff(true); setUrl(null); return; }
        setOff(false);
        setUrl(`${base}?pass=${encodeURIComponent(r.pass)}`);
        const ms = r.expiresAt ? new Date(r.expiresAt).getTime() - Date.now() - 5 * 60_000 : 60 * 60_000;
        renew = setTimeout(load, Math.max(60_000, ms));
      })
      .catch(() => { if (alive) setOff(true); });
    void load();
    return () => { alive = false; if (renew) clearTimeout(renew); };
  }, [enabled]);
  return { url: enabled ? url : null, unavailable: enabled && off };
}
