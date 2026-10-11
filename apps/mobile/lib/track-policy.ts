/**
 * The route recorder's rules, with no dependencies.
 *
 * While an officer is on duty the phone takes a position fix every few
 * seconds, signal or not (lib/tracker.ts). Most of them are kept on the
 * phone and sent in batches; these rules decide which fixes are worth
 * keeping, so the route on the dispatcher's map is the road the crew drove
 * and not the noise a GPS chip makes in a basement:
 *
 *   • a fix is kept when the crew has moved MIN_MOVE_M, or STILL_EVERY_MS
 *     has passed (a parked unit still checks in once a minute);
 *   • a rough fix (worse than MAX_ACCURACY_M) is kept only when nothing
 *     better has come for ROUGH_AFTER_MS, and never one worse than 500 m;
 *   • a jump faster than MAX_SPEED_MS from the last kept fix is a GPS
 *     glitch, not a crew, unless enough time has passed to make it real.
 *
 * Tested in track-policy.test.ts.
 */

export type TrackPoint = {
  /** When the fix was taken (ISO). */
  t: string;
  lat: number;
  lng: number;
  /** Accuracy in metres, speed in m/s, heading in degrees — when the phone knows them. */
  acc: number | null;
  spd: number | null;
  hdg: number | null;
};

export const MIN_MOVE_M = 20;
export const STILL_EVERY_MS = 60_000;
export const MAX_ACCURACY_M = 75;
export const ROUGH_AFTER_MS = 2 * 60_000;
export const ROUGHEST_M = 500;
/** 250 km/h: faster than any response vehicle. */
export const MAX_SPEED_MS = 70;
/** The server takes fixes up to 72 hours old; the phone keeps them a little less. */
export const KEEP_FOR_MS = 70 * 3_600_000;
/** Fixes per delivery (the server takes up to 1,000). */
export const BATCH = 500;

/** Metres between two fixes (haversine). */
export function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

/** A fix from expo-location, as a point — or null when it is not a usable position. */
export function fromLocation(loc: {
  timestamp: number;
  coords: { latitude: number; longitude: number; accuracy?: number | null; speed?: number | null; heading?: number | null };
}): TrackPoint | null {
  const { latitude: lat, longitude: lng } = loc.coords ?? ({} as never);
  if (!finite(lat) || !finite(lng) || !finite(loc.timestamp)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180 || (lat === 0 && lng === 0)) return null;
  const acc = loc.coords.accuracy;
  const spd = loc.coords.speed;
  const hdg = loc.coords.heading;
  return {
    t: new Date(loc.timestamp).toISOString(),
    lat: round(lat, 6),
    lng: round(lng, 6),
    acc: finite(acc) && acc >= 0 ? round(acc, 1) : null,
    // The phones report -1 for "unknown".
    spd: finite(spd) && spd >= 0 ? round(spd, 1) : null,
    hdg: finite(hdg) && hdg >= 0 ? round(hdg, 0) : null,
  };
}

/** Whether `next` is worth keeping after `prev` (the last kept fix). */
export function worthKeeping(prev: TrackPoint | null, next: TrackPoint): boolean {
  const acc = next.acc ?? 0;
  if (acc > ROUGHEST_M) return false;
  // The first fix of a shift is kept even if rough: better than no marker.
  if (!prev) return true;
  const gap = Date.parse(next.t) - Date.parse(prev.t);
  if (!(gap > 0)) return false;
  if (acc > MAX_ACCURACY_M && gap < ROUGH_AFTER_MS) return false;
  const moved = metresBetween(prev, next);
  // A jump no vehicle could make, unless it is within the fixes' own error.
  if (moved / (gap / 1000) > MAX_SPEED_MS && moved > acc + (prev.acc ?? 0) + 100) return false;
  return moved >= MIN_MOVE_M || gap >= STILL_EVERY_MS;
}

/** The fixes worth keeping from a batch the phone delivered, in time order, after `prev`. */
export function thin(prev: TrackPoint | null, fixes: readonly TrackPoint[]): TrackPoint[] {
  const out: TrackPoint[] = [];
  let last = prev;
  for (const fix of [...fixes].sort((a, b) => Date.parse(a.t) - Date.parse(b.t))) {
    if (worthKeeping(last, fix)) {
      out.push(fix);
      last = fix;
    }
  }
  return out;
}

/** Fixes still worth delivering: the server refuses ones older than 72 hours. */
export function stillDeliverable(points: readonly TrackPoint[], now: number): TrackPoint[] {
  return points.filter((p) => now - Date.parse(p.t) < KEEP_FOR_MS && Date.parse(p.t) - now < 5 * 60_000);
}
