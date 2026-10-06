import type { MapZoneKind, MapZoneShape } from './types.generated';

/**
 * Live map overlays shared by the console's operations map and the officer
 * app's Live Map: crime zones from the SAPS station statistics, the look of
 * each perimeter and zone type, and small helpers both draw with. Pure, so
 * map-layers.test.ts pins it and both screens show the same thing.
 */

/** A call placed at 0,0 (or with no coordinates) has no real position. */
export function hasPosition(lat: number | null | undefined, lng: number | null | undefined) {
  return lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
}

/* ── Crime zones ────────────────────────────────────────────────────── */

export const CRIME_KINDS = [
  { key: 'all', label: 'All six categories' },
  { key: 'murder', label: 'Murder' },
  { key: 'carjacking', label: 'Carjacking' },
  { key: 'burglary_residential', label: 'Burglary at homes' },
  { key: 'robbery_residential', label: 'Robbery at homes' },
  { key: 'drug_crime', label: 'Drug-related crime' },
  { key: 'dui', label: 'Driving under the influence' },
] as const;
export type CrimeKind = (typeof CRIME_KINDS)[number]['key'];

export function isCrimeKind(value: unknown): value is CrimeKind {
  return typeof value === 'string' && CRIME_KINDS.some((k) => k.key === value);
}

export type CrimeStation = {
  id: number;
  station_name: string;
  latitude: number | null;
  longitude: number | null;
  murder: number | null;
  carjacking: number | null;
  burglary_residential: number | null;
  robbery_residential: number | null;
  drug_crime: number | null;
  dui: number | null;
};

export function crimeCount(station: CrimeStation, kind: CrimeKind): number {
  if (kind !== 'all') return station[kind] ?? 0;
  return (station.murder ?? 0) + (station.carjacking ?? 0) + (station.burglary_residential ?? 0)
    + (station.robbery_residential ?? 0) + (station.drug_crime ?? 0) + (station.dui ?? 0);
}

/** Circle radius in metres: police station areas in eThekwini sit a few kilometres apart. */
const ZONE_MIN_M = 350;
const ZONE_MAX_M = 2600;

export type CrimeZone = {
  station: CrimeStation;
  lat: number;
  lng: number;
  count: number;
  /** 1 = the worst station for this category. */
  rank: number;
  /** count ÷ worst station's count, 0–1. */
  share: number;
  radius: number;
  colour: string;
};

/**
 * One circle per station with a position. The circle's area grows with the
 * count (radius ∝ √share), so a station with four times the crime covers four
 * times the ground rather than sixteen.
 */
export function crimeZones(stations: readonly CrimeStation[], kind: CrimeKind): CrimeZone[] {
  const placed = stations.filter((s) => hasPosition(s.latitude, s.longitude));
  const counts = placed.map((s) => crimeCount(s, kind));
  const max = Math.max(0, ...counts);
  const order = [...counts].sort((a, b) => b - a);
  return placed.map((station, i) => {
    const count = counts[i] ?? 0;
    const share = max > 0 ? count / max : 0;
    return {
      station,
      lat: station.latitude as number,
      lng: station.longitude as number,
      count,
      rank: order.indexOf(count) + 1,
      share,
      radius: Math.round(ZONE_MIN_M + (ZONE_MAX_M - ZONE_MIN_M) * Math.sqrt(share)),
      colour: heatColour(share),
    };
  });
}

/** Yellow → orange → red. */
export function heatColour(t: number): string {
  const stops: Array<[number, number, number]> = [[250, 204, 21], [249, 115, 22], [220, 38, 38]];
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const [a, b] = [stops[i]!, stops[i + 1]!];
  const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  return `#${hex(a[0] + (b[0] - a[0]) * f)}${hex(a[1] + (b[1] - a[1]) * f)}${hex(a[2] + (b[2] - a[2]) * f)}`;
}

/* ── Perimeters and zones ───────────────────────────────────────────── */

export type ZoneKindDef = {
  key: MapZoneKind;
  label: string;
  colour: string;
  /** Shapes this type can be drawn as, the usual one first. */
  shapes: readonly MapZoneShape[];
  /** Two letters on a point marker. */
  mark: string;
  hint: string;
};

export const ZONE_KINDS: readonly ZoneKindDef[] = [
  { key: 'cordon', label: 'Cordon', colour: '#ef4444', shapes: ['polygon', 'circle'], mark: 'C', hint: 'Hold the line and keep the public out.' },
  { key: 'exclusion', label: 'Exclusion zone', colour: '#be123c', shapes: ['polygon', 'circle'], mark: 'X', hint: 'No entry without clearance — crews included.' },
  { key: 'evacuation', label: 'Evacuation area', colour: '#f59e0b', shapes: ['polygon', 'circle'], mark: 'E', hint: 'Everyone inside must leave.' },
  { key: 'hazard', label: 'Hazard area', colour: '#a855f7', shapes: ['polygon', 'circle'], mark: 'H', hint: 'Fire, flood, gas, chemical or structural danger.' },
  { key: 'search', label: 'Search area', colour: '#3b82f6', shapes: ['polygon', 'circle'], mark: 'S', hint: 'Ground being searched.' },
  { key: 'road_closure', label: 'Road closure', colour: '#facc15', shapes: ['line', 'polygon'], mark: 'RC', hint: 'A road or stretch closed to traffic.' },
  { key: 'route', label: 'Route', colour: '#22c55e', shapes: ['line'], mark: 'R', hint: 'Access, escape or escort route.' },
  { key: 'staging', label: 'Staging area', colour: '#14b8a6', shapes: ['point', 'polygon', 'circle'], mark: 'SA', hint: 'Where arriving units wait.' },
  { key: 'command_post', label: 'Command post', colour: '#e2e8f0', shapes: ['point'], mark: 'CP', hint: 'Where incident command sits.' },
  { key: 'rendezvous', label: 'Rendezvous point', colour: '#38bdf8', shapes: ['point'], mark: 'RV', hint: 'Where crews meet before going in.' },
  { key: 'last_seen', label: 'Last seen', colour: '#ec4899', shapes: ['point', 'circle'], mark: 'LS', hint: 'Last known position of a person or vehicle.' },
  { key: 'note', label: 'Map note', colour: '#94a3b8', shapes: ['polygon', 'circle', 'line', 'point'], mark: 'i', hint: 'Anything else worth marking.' },
];

export function zoneKind(key: string): ZoneKindDef {
  return ZONE_KINDS.find((k) => k.key === key) ?? ZONE_KINDS[ZONE_KINDS.length - 1]!;
}

/* ── Weather ────────────────────────────────────────────────────────── */

export function compass(deg: number | null | undefined): string {
  if (deg == null || !Number.isFinite(deg)) return '';
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return points[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;
}

