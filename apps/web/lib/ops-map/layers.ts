import type { UserRole } from '@criticom/db';

/**
 * The live operations map's overlays, and the rules for which a viewer may
 * switch on and which they open with. Pure: no React, no Leaflet, so it is
 * tested on its own (layers.test.ts) and shared by the dashboard board and
 * the full map page.
 */

export type LayerId =
  | 'incidents' | 'units' | 'zones' | 'cameras'
  | 'crime' | 'hydrants'
  | 'rain' | 'clouds' | 'temp' | 'wind'
  | 'traffic' | 'facilities';

export type LayerGroup = 'Operations' | 'Risk' | 'Weather' | 'City';

export type LayerDef = {
  id: LayerId;
  label: string;
  group: LayerGroup;
  /** One line under the switch: what it shows and where it comes from. */
  hint: string;
};

export const LAYERS: readonly LayerDef[] = [
  { id: 'incidents', label: 'Live incidents', group: 'Operations', hint: 'Open calls by severity. An SOS always shows.' },
  { id: 'units', label: 'On-duty officers', group: 'Operations', hint: 'Last GPS position from the officer app.' },
  { id: 'zones', label: 'Perimeters & zones', group: 'Operations', hint: 'Cordons, closures and points set by command.' },
  { id: 'cameras', label: 'CCTV cameras', group: 'Operations', hint: 'Registered cameras that have a position.' },
  { id: 'crime', label: 'Crime zones', group: 'Risk', hint: 'SAPS station statistics, latest year loaded.' },
  { id: 'hydrants', label: 'Fire hydrants', group: 'Risk', hint: 'Hydrant register, coloured by status.' },
  { id: 'rain', label: 'Rain', group: 'Weather', hint: 'Precipitation now (OpenWeather).' },
  { id: 'clouds', label: 'Cloud cover', group: 'Weather', hint: 'Cloud now (OpenWeather).' },
  { id: 'temp', label: 'Temperature', group: 'Weather', hint: 'Air temperature now (OpenWeather).' },
  { id: 'wind', label: 'Wind speed', group: 'Weather', hint: 'Wind now (OpenWeather).' },
  { id: 'traffic', label: 'Traffic incidents', group: 'City', hint: 'Crashes, closures and jams (TomTom).' },
  { id: 'facilities', label: 'Hospitals & police stations', group: 'City', hint: 'Emergency facilities nearby (TomTom).' },
];

export const LAYER_GROUPS: readonly LayerGroup[] = ['Operations', 'Risk', 'Weather', 'City'];

export const WEATHER_LAYERS = ['rain', 'clouds', 'temp', 'wind'] as const;
export type WeatherLayer = (typeof WEATHER_LAYERS)[number];

export function isWeatherLayer(id: string): id is WeatherLayer {
  return (WEATHER_LAYERS as readonly string[]).includes(id);
}

/** OpenWeather "Weather maps 1.0" tile layer names, proxied by /api/weather/tiles. */
export const OWM_TILE_LAYER: Record<WeatherLayer, string> = {
  rain: 'precipitation_new',
  clouds: 'clouds_new',
  temp: 'temp_new',
  wind: 'wind_new',
};

export const BASEMAPS = ['dark', 'street', 'satellite'] as const;
export type Basemap = (typeof BASEMAPS)[number];

export function isBasemap(value: unknown): value is Basemap {
  return typeof value === 'string' && (BASEMAPS as readonly string[]).includes(value);
}

/** Layers a viewer may switch on. CCTV follows the access rule of the /cameras screen. */
export function availableLayers(opts: { cameras: boolean }): LayerId[] {
  return LAYERS.map((l) => l.id).filter((id) => id !== 'cameras' || opts.cameras);
}

/** What the map opens with, by desk, until the viewer makes their own choice. */
export function defaultLayers(role: UserRole): LayerId[] {
  const base: LayerId[] = ['incidents', 'units', 'zones'];
  switch (role) {
    case 'Police':
    case 'Captain':
      return [...base, 'crime'];
    case 'Firefighter':
    case 'FireChief':
      return [...base, 'hydrants'];
    case 'Paramedic':
    case 'Doctor':
      return [...base, 'facilities'];
    case 'Disaster':
      return [...base, 'rain'];
    default:
      return base;
  }
}

/**
 * A choice saved in browser storage, trusted only as far as it is still
 * valid: unknown or no-longer-permitted layers are dropped. An empty saved
 * list is honoured — the viewer switched everything off on purpose.
 */
export function restoreLayers(
  saved: unknown,
  available: readonly LayerId[],
  fallback: readonly LayerId[],
): LayerId[] {
  const allowed = (id: unknown): id is LayerId =>
    typeof id === 'string' && (available as readonly string[]).includes(id);
  const source = Array.isArray(saved) ? saved : fallback;
  return [...new Set(source.filter(allowed))];
}

/* ── Incidents ──────────────────────────────────────────────────────── */

export const SEVERITY_COLOUR: Record<string, string> = {
  Critical: '#ef4444',
  High: '#f97316',
  Medium: '#f59e0b',
  Low: '#22c55e',
};

/** An officer's panic button raises an incident with this source (0043). */
export const SOS_SOURCE = 'Responder-Panic';

type IncidentLike = { source: string; incident_severity: string; location_lat: number; location_lng: number };

export function isSos(incident: Pick<IncidentLike, 'source'>) {
  return incident.source === SOS_SOURCE;
}

/** A call placed at 0,0 (or with no coordinates) has no real position. */
export function hasPosition(lat: number | null | undefined, lng: number | null | undefined) {
  return lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
}

export function summariseIncidents(incidents: readonly IncidentLike[]) {
  let urgent = 0;
  let sos = 0;
  let unplaced = 0;
  for (const i of incidents) {
    if (isSos(i)) sos++;
    else if (i.incident_severity === 'Critical' || i.incident_severity === 'High') urgent++;
    if (!hasPosition(i.location_lat, i.location_lng)) unplaced++;
  }
  return { live: incidents.length, urgent, sos, unplaced };
}

/* ── Officers ───────────────────────────────────────────────────────── */

/** Phones send a GPS heartbeat about once a minute; a quarter hour of silence is worth showing. */
export const STALE_POSITION_MS = 15 * 60_000;

export function isStale(seenAt: string, now: number) {
  const t = new Date(seenAt).getTime();
  return Number.isFinite(t) && now - t > STALE_POSITION_MS;
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

/* ── Hydrants ───────────────────────────────────────────────────────── */

export const HYDRANT_COLOUR: Record<string, string> = {
  Operational: '#38bdf8',
  'Maintenance Required': '#f59e0b',
  'Out of Service': '#94a3b8',
};

/* ── Weather ────────────────────────────────────────────────────────── */

export function compass(deg: number | null | undefined): string {
  if (deg == null || !Number.isFinite(deg)) return '';
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return points[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;
}

/* ── TomTom feeds (via /api/external/*) ─────────────────────────────── */

export type FacilityKind = 'hospital' | 'police' | 'fire' | 'other';
export type Facility = { id: string; name: string; kind: FacilityKind; lat: number; lng: number; address: string | null };

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function facilityKind(codes: readonly string[]): FacilityKind {
  const text = codes.join(' ').toUpperCase();
  if (text.includes('HOSPITAL') || text.includes('EMERGENCY') || text.includes('CLINIC')) return 'hospital';
  if (text.includes('POLICE')) return 'police';
  if (text.includes('FIRE')) return 'fire';
  return 'other';
}

/**
 * TomTom's Durban data files GP rooms, beauty schools and support groups as
 * "hospital/polyclinic", and the odd shop as a police station. On a control
 * room map only the real thing helps, so a facility must also be named as one.
 */
const REAL_NAME: Partial<Record<FacilityKind, RegExp>> = {
  hospital: /^(?!.*veterinary|.*animal).*(hospital|mediclinic|netcare)/i,
  police: /police|saps/i,
};

/** TomTom nearby search → real facilities with a position, each once. */
export function parseFacilities(json: unknown): Facility[] {
  const out: Facility[] = [];
  const seen = new Set<string>();
  asArray(asRecord(json).results).forEach((raw, i) => {
    const r = asRecord(raw);
    const poi = asRecord(r.poi);
    const pos = asRecord(r.position);
    const lat = Number(pos.lat);
    const lng = Number(pos.lon);
    if (!hasPosition(lat, lng)) return;
    const codes = [
      ...asArray(poi.classifications).map((c) => String(asRecord(c).code ?? '')),
      ...asArray(poi.categories).map(String),
    ];
    const name = String(poi.name ?? '');
    const kind = facilityKind(codes);
    if (kind === 'other' || REAL_NAME[kind]?.test(name) === false) return;
    const id = String(r.id ?? `poi-${i}`);
    if (seen.has(id)) return;
    seen.add(id);
    out.push({
      id,
      name: name || 'Fire station',
      kind,
      lat,
      lng,
      address: (asRecord(r.address).freeformAddress as string | undefined) ?? null,
    });
  });
  return out;
}

/** TomTom traffic iconCategory → words. */
const TRAFFIC_CATEGORY: Record<number, string> = {
  1: 'Accident', 2: 'Fog', 3: 'Dangerous conditions', 4: 'Rain', 5: 'Ice', 6: 'Traffic jam',
  7: 'Lane closed', 8: 'Road closed', 9: 'Road works', 10: 'Wind', 11: 'Flooding', 14: 'Broken-down vehicle',
};

export type TrafficItem = {
  id: string;
  label: string;
  description: string;
  /** [lat, lng] — one point for a spot incident, several for a stretch of road. */
  points: Array<[number, number]>;
};

/** TomTom incident details → points or lines, with coordinates flipped to [lat, lng]. */
export function parseTraffic(json: unknown): TrafficItem[] {
  const out: TrafficItem[] = [];
  asArray(asRecord(json).incidents).forEach((raw, i) => {
    const feature = asRecord(raw);
    const geometry = asRecord(feature.geometry);
    const props = asRecord(feature.properties);
    const coords = geometry.type === 'Point' ? [geometry.coordinates] : asArray(geometry.coordinates);
    const points = coords
      .map((c) => asArray(c))
      .map((c) => [Number(c[1]), Number(c[0])] as [number, number])
      .filter(([lat, lng]) => hasPosition(lat, lng));
    if (!points.length) return;
    const category = Number(props.iconCategory);
    const description = asArray(props.events).map((e) => String(asRecord(e).description ?? '')).filter(Boolean).join(' · ');
    const label = TRAFFIC_CATEGORY[category] ?? 'Traffic incident';
    out.push({ id: `traffic-${i}`, label, description: description || label, points });
  });
  return out;
}
