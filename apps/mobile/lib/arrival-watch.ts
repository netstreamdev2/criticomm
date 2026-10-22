import AsyncStorage from '@react-native-async-storage/async-storage';
import { getOperationalSettings } from '@criticom/api';
import { getSupabase } from './supabase';
import { enqueueQuietly, isMine, readOutbox } from './outbox';
import { ARRIVE_RADIUS_M, arrivalFix, scenesToWatch, type SceneWatch } from './arrival-policy.ts';
import type { TrackPoint } from './track-policy.ts';

/**
 * On scene with no signal (0099, offline): the route recorder hands every
 * batch of fixes here, and the first fix inside a scene's radius queues On
 * Scene for that call at that fix's time — with the fix itself, which the
 * server checks before taking the status. Works with the app closed and the
 * screen off; nothing waits for signal but the delivery.
 *
 * The scenes come from two places: the calls the server last said the
 * officer is driving to (kept on the phone by useOpenCall), and Responding
 * presses still waiting in the outbox (they carry the scene).
 */

const SCENES_KEY = 'criticom.arrival.scenes.v1';
const DONE_KEY = 'criticom.arrival.done.v1';
const RADIUS_KEY = 'criticom.arrival.radius.v1';
const RADIUS_EVERY_MS = 30 * 60_000;

/** The reason the timeline shows: the phone, not a press. */
export const PHONE_ARRIVAL = 'Phone at the scene';

type Kept = { userId: string; scenes: SceneWatch[] };

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

let radiusFetchedAt = 0;

/** The scenes the server says this officer is driving to, kept for when there is no signal. */
export async function rememberScenes(userId: string, scenes: SceneWatch[]): Promise<void> {
  await AsyncStorage.setItem(SCENES_KEY, JSON.stringify({ userId, scenes } satisfies Kept)).catch(() => {});
  // The radius dispatch set in Operations Settings, now and then.
  if (Date.now() - radiusFetchedAt > RADIUS_EVERY_MS) {
    radiusFetchedAt = Date.now();
    void getOperationalSettings(getSupabase())
      .then((s) => AsyncStorage.setItem(RADIUS_KEY, String(s['dispatch.arrive_radius_m'])))
      .catch(() => {});
  }
}

let checking = false;

/** Fixes from the route recorder: queue On Scene for any scene they reach. */
export async function checkArrivals(userId: string, fixes: readonly TrackPoint[]): Promise<void> {
  if (checking || !fixes.length) return;
  checking = true;
  try {
    const kept = await readJson<Kept>(SCENES_KEY);
    const queued = (await readOutbox()).flatMap((e) => (
      e.op.kind === 'incident_status' && isMine(e, userId)
        ? [{ incidentId: e.op.incidentId, status: e.op.status, occurredAt: e.occurredAt, scene: e.op.scene, incidentNumber: e.op.incidentNumber }]
        : []
    ));
    const watching = scenesToWatch(kept?.userId === userId ? kept.scenes : [], queued);
    if (!watching.length) return;

    const radius = Number(await AsyncStorage.getItem(RADIUS_KEY).catch(() => null)) || ARRIVE_RADIUS_M;
    // Once per call: the server's own answer may take a while to come back.
    const done = new Set((await readJson<string[]>(DONE_KEY)) ?? []);
    for (const scene of watching) {
      if (done.has(scene.incidentId)) continue;
      const fix = arrivalFix(scene, fixes, radius);
      if (!fix) continue;
      await enqueueQuietly({
        kind: 'incident_status',
        incidentId: scene.incidentId,
        status: 'On Scene',
        incidentNumber: scene.incidentNumber,
        reason: PHONE_ARRIVAL,
        fix,
      }, userId, fix.t);
      done.add(scene.incidentId);
    }
    await AsyncStorage.setItem(DONE_KEY, JSON.stringify([...done].slice(-50))).catch(() => {});
  } catch (e) {
    console.warn('[criticom] arrival check failed', (e as Error).message);
  } finally {
    checking = false;
  }
}
