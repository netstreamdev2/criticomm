import type { UserRole } from '@criticom/db';
import { hasPosition } from '@criticom/db/map-layers';

// The crime-zone maths and helpers are shared with the officer app.
export {
  compass, crimeCount, crimeZones, CRIME_KINDS, hasPosition, heatColour, isCrimeKind,
  type CrimeKind, type CrimeStation, type CrimeZone,
} from '@criticom/db/map-layers';

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
  { id: 'cameras', label: 'SANRAL cameras', group: 'Operations', hint: 'Freeway cameras that have a position.' },
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

/** Layers a viewer may switch on. SANRAL cameras follow the access rule of the /sanral screen. */
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

/* ── Hydrants ───────────────────────────────────────────────────────── */

export const HYDRANT_COLOUR: Record<string, string> = {
  Operational: '#38bdf8',
  'Maintenance Required': '#f59e0b',
  'Out of Service': '#94a3b8',
};

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
