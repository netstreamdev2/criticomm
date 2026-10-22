/**
 * When the phone itself may say "on scene", with no dependencies.
 *
 * The server proves arrival from the fixes it receives (migration 0099). With
 * no signal those fixes wait on the phone, and so would the officer's On
 * Scene. So the phone runs the same test on its own fixes: the first one
 * inside the scene radius, accurate to within 100 m, taken after the officer
 * pressed Responding, puts them on scene at that fix's time. The fix travels
 * with the queued status and the server checks it again, so the phone's word
 * is never taken on trust.
 *
 * Tested in arrival-policy.test.ts.
 */
import { metresBetween, type TrackPoint } from './track-policy.ts';

/** The server's default radius; the phone uses it unless told otherwise. */
export const ARRIVE_RADIUS_M = 150;
/** A fix rougher than this proves nothing. */
export const ARRIVE_MAX_ACCURACY_M = 100;
/** A fix this long before Responding was pressed still counts (clock drift). */
export const BEFORE_RESPONDING_MS = 2 * 60_000;

/** A call the officer is driving to. */
export type SceneWatch = {
  incidentId: string;
  incidentNumber?: string;
  lat: number;
  lng: number;
  /** When they pressed Responding (ISO). */
  since: string;
};

/** The first fix that puts the officer at this scene, or null. */
export function arrivalFix(
  watch: SceneWatch,
  fixes: readonly TrackPoint[],
  radius = ARRIVE_RADIUS_M,
): TrackPoint | null {
  const from = Date.parse(watch.since) - BEFORE_RESPONDING_MS;
  const sorted = [...fixes].sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  for (const fix of sorted) {
    if (Date.parse(fix.t) < from) continue;
    // A location-faking app proves nothing (0100).
    if (fix.mock) continue;
    const acc = fix.acc ?? 0;
    if (acc > ARRIVE_MAX_ACCURACY_M) continue;
    if (metresBetween(fix, watch) - acc <= radius) return fix;
  }
  return null;
}

/**
 * The scenes still to watch: those the server says the officer is driving
 * to, and Responding presses still waiting on the phone that carry the scene,
 * less any call already given a later status (by hand or by the phone).
 */
export function scenesToWatch(
  known: readonly SceneWatch[],
  queued: ReadonlyArray<{ incidentId: string; status: string; occurredAt: string; scene?: { lat: number; lng: number }; incidentNumber?: string }>,
): SceneWatch[] {
  const byId = new Map<string, SceneWatch>();
  for (const w of known) byId.set(w.incidentId, w);
  for (const q of queued) {
    if (q.status === 'En Route' && q.scene && !byId.has(q.incidentId)) {
      byId.set(q.incidentId, { incidentId: q.incidentId, incidentNumber: q.incidentNumber, lat: q.scene.lat, lng: q.scene.lng, since: q.occurredAt });
    }
  }
  for (const q of queued) {
    if (q.status !== 'En Route') byId.delete(q.incidentId);
  }
  return [...byId.values()];
}
