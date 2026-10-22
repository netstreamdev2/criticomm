/**
 * Following a crew to the scene (0099), the way a ride app follows a car:
 * how far they have come, how far is left, when they should get there, and
 * how their arrival was recorded. Pure, so the console, the phone and the
 * tests read it the same.
 */

export type TrackSilo = 'MetroPolice' | 'MetroFire' | 'Medical' | 'EthekwiniDisaster' | 'Ethekwini';

/** Each department's vehicle on the progress strip: Police a car with a blue light bar, EMS red, Fire orange, Disaster yellow. */
export const DEPARTMENT_VEHICLE: Record<TrackSilo, { tone: string; light: string; kind: 'car' | 'ambulance' | 'truck' }> = {
  MetroPolice: { tone: '#2563eb', light: '#3b82f6', kind: 'car' },
  Ethekwini: { tone: '#2563eb', light: '#3b82f6', kind: 'car' },
  Medical: { tone: '#dc2626', light: '#ef4444', kind: 'ambulance' },
  MetroFire: { tone: '#ea580c', light: '#f97316', kind: 'truck' },
  EthekwiniDisaster: { tone: '#ca8a04', light: '#eab308', kind: 'truck' },
};
export const vehicleFor = (silo: string | null | undefined) =>
  DEPARTMENT_VEHICLE[(silo ?? 'MetroPolice') as TrackSilo] ?? DEPARTMENT_VEHICLE.MetroPolice;

type Point = { lat: number; lng: number };

/** Metres between two points (haversine), as the database's distance_m(). */
export function metresApart(a: Point, b: Point): number {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** "38 m", "2.4 km", "12 km". */
export function distanceWords(m: number | null | undefined): string | null {
  if (m === null || m === undefined || !Number.isFinite(m)) return null;
  if (m < 1000) return `${Math.round(m)} m`;
  return m < 10_000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 1000)} km`;
}

/**
 * How far along the way to the scene, 0 to 1: the share of the distance
 * from where they set off that is behind them. Never backwards past the
 * start, never past the scene before they arrive (0.97 at most).
 */
export function progressAlong(startDistanceM: number | null | undefined, leftM: number | null | undefined): number | null {
  if (leftM === null || leftM === undefined || !Number.isFinite(leftM)) return null;
  const start = startDistanceM && startDistanceM > 0 ? Math.max(startDistanceM, leftM) : null;
  if (!start) return leftM < 200 ? 0.95 : null;
  return Math.min(0.97, Math.max(0.02, 1 - leftM / start));
}

/** Minutes to cover `m` metres by road, from the straight-line distance (Operations Settings: speed and road factor). */
export function etaMinutes(m: number | null | undefined, speedKmh = 42, roadFactor = 1.35): number | null {
  if (m === null || m === undefined || !Number.isFinite(m)) return null;
  return Math.max(1, Math.round(((m * roadFactor) / 1000 / Math.max(5, speedKmh)) * 60));
}

/** A fix older than this is too old to place them on the strip with confidence. */
export const STALE_FIX_MS = 3 * 60_000;

export type Arrival = {
  arrived_by: string | null;
  arrived_verified: boolean | null;
  arrived_distance_m: number | null;
};

/** How an arrival was recorded, in words, and whether it is a warning. */
export function arrivalWords(a: Arrival): { text: string; tone: 'ok' | 'warn' | 'plain' } | null {
  if (!a.arrived_by) return null;
  const d = distanceWords(a.arrived_distance_m);
  if (a.arrived_by === 'gps') return { text: d ? `GPS ✓ · ${d} from the scene` : 'GPS ✓', tone: 'ok' };
  if (a.arrived_by === 'desk') return { text: 'Marked by dispatch (radio)', tone: 'plain' };
  if (a.arrived_verified === true) return { text: d ? `Marked by officer · GPS ✓ ${d}` : 'Marked by officer · GPS ✓', tone: 'ok' };
  if (a.arrived_verified === null) return { text: 'Marked by officer · no map position to check', tone: 'plain' };
  return { text: d ? `Not verified · ${d} away when marked` : 'Not verified · no position from the phone', tone: 'warn' };
}
