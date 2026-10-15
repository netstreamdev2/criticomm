import { useSyncExternalStore } from 'react';
import { tNow } from './translator';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { recordTrack } from '@criticom/api';
import { getSupabase } from './supabase';
import { isNetworkFailure } from './offline-cache-policy.ts';
import { BATCH, fromLocation, stillDeliverable, thin, type TrackPoint } from './track-policy.ts';

/**
 * The route recorder: while an officer is on duty, the phone records where
 * they are — in the background, with the screen off, with or without signal
 * — and keeps every fix on the phone until the server has it.
 *
 * On Android it runs as a foreground service (the "On duty" notification),
 * which keeps recording with the app in the background and needs only the
 * "while using the app" location permission. If that cannot start, it
 * records while the app is open instead.
 *
 * Fixes are thinned (track-policy.ts), written to small files per person,
 * and sent in batches through record_track() (migration 0071), which skips
 * any already on file — so a batch interrupted half way is simply sent
 * again. With no signal they wait; when signal returns the whole stretch is
 * delivered, and the console draws it as recorded offline. Dispatch sees the
 * last fix that reached it until then, with how long ago.
 *
 * Only the person who was on duty is recorded, and only their own files are
 * sent under their sign-in: a handset shared between shifts never sends one
 * officer's route as another's.
 */

export const ROUTE_TASK = 'criticom-duty-route';

const DIR = `${FileSystem.documentDirectory ?? ''}route/`;
const OWNER_KEY = 'criticom.route.owner.v1';
const LAST_KEY = 'criticom.route.last.v1';
/** Small files are merged once there are this many, so a long dead zone stays a handful of files. */
const MERGE_AT = 40;
/** At most this often unless forced: the batch is what saves battery and data. */
const SEND_EVERY_MS = 15_000;

const OPTIONS: Location.LocationTaskOptions = {
  accuracy: Location.Accuracy.High,
  timeInterval: 10_000,
  distanceInterval: 15,
  // Android hands fixes over in batches this far apart; the marker on the
  // console is never older than this while there is signal.
  deferredUpdatesInterval: 15_000,
  pausesUpdatesAutomatically: false,
  activityType: Location.ActivityType.AutomotiveNavigation,
  showsBackgroundLocationIndicator: true,
  foregroundService: {
    notificationTitle: 'On duty',
    notificationBody: 'Dispatch can see where you are.',
    notificationColor: '#dc3545',
    killServiceOnDestroy: false,
  },
};

/* ── Status, for the profile screen ───────────────────────────────────── */

export type RouteMode = 'off' | 'background' | 'foreground' | 'denied';
export type RouteStatus = {
  mode: RouteMode;
  /** When the last fix was kept. */
  lastFixAt: string | null;
  /** Fixes on the phone waiting for signal. */
  waiting: number;
  /** When the server last took a batch. */
  lastSentAt: string | null;
};

let status: RouteStatus = { mode: 'off', lastFixAt: null, waiting: 0, lastSentAt: null };
const listeners = new Set<() => void>();
function setStatus(patch: Partial<RouteStatus>) {
  status = { ...status, ...patch };
  for (const l of listeners) l();
}

export function useRouteStatus(): RouteStatus {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => status,
  );
}

/* ── Whose route ──────────────────────────────────────────────────────── */

let ownerMem: string | null | undefined;

/** The officer being recorded; null records nothing. Kept on the phone for the background task. */
async function setRouteOwner(userId: string | null) {
  ownerMem = userId;
  await (userId ? AsyncStorage.setItem(OWNER_KEY, userId) : AsyncStorage.removeItem(OWNER_KEY)).catch(() => {});
}

async function routeOwner(): Promise<string | null> {
  if (ownerMem !== undefined) return ownerMem;
  ownerMem = await AsyncStorage.getItem(OWNER_KEY).catch(() => null);
  return ownerMem;
}

/* ── Files ────────────────────────────────────────────────────────────── */

// One writer at a time: the background task and the app share these files.
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

const dirFor = (userId: string) => `${DIR}${userId}/`;
/** "<time>-<count>-<tag>.json": in time order by name, with its size in the name. */
const fileName = (at: number, count: number, tag: string) => `${String(at).padStart(15, '0')}-${count}-${tag}.json`;
const countIn = (name: string) => Number(name.split('-')[1]) || 0;

async function listFiles(userId: string): Promise<string[]> {
  try {
    const dir = dirFor(userId);
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) return [];
    return (await FileSystem.readDirectoryAsync(dir)).filter((n) => n.endsWith('.json')).sort();
  } catch {
    return [];
  }
}

async function readFile(userId: string, name: string): Promise<TrackPoint[]> {
  try {
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(`${dirFor(userId)}${name}`)) as unknown;
    return Array.isArray(parsed) ? (parsed as TrackPoint[]) : [];
  } catch {
    return [];
  }
}

let lastMem: { userId: string; point: TrackPoint } | null | undefined;

async function lastKept(userId: string): Promise<TrackPoint | null> {
  if (lastMem === undefined) {
    try {
      const raw = await AsyncStorage.getItem(LAST_KEY);
      lastMem = raw ? (JSON.parse(raw) as { userId: string; point: TrackPoint }) : null;
    } catch {
      lastMem = null;
    }
  }
  return lastMem && lastMem.userId === userId ? lastMem.point : null;
}

async function setLastKept(userId: string, point: TrackPoint) {
  lastMem = { userId, point };
  await AsyncStorage.setItem(LAST_KEY, JSON.stringify(lastMem)).catch(() => {});
}

let sending = false;

async function mergeIfMany(userId: string) {
  if (sending) return;
  const files = await listFiles(userId);
  if (files.length < MERGE_AT) return;
  const points: TrackPoint[] = [];
  for (const name of files) points.push(...await readFile(userId, name));
  const first = Number(files[0]?.split('-')[0]) || Date.now();
  await FileSystem.writeAsStringAsync(`${dirFor(userId)}${fileName(first, points.length, 'm')}`, JSON.stringify(points));
  for (const name of files) await FileSystem.deleteAsync(`${dirFor(userId)}${name}`, { idempotent: true });
}

/** Fixes from the phone (the background task, or the open app): thin, keep, send when possible. */
export async function recordFixes(locations: readonly Location.LocationObject[]): Promise<void> {
  const userId = await routeOwner();
  // Off duty or signed out: nothing is recorded.
  if (!userId) return;
  const fixes = locations.map(fromLocation).filter((p): p is TrackPoint => p !== null);
  if (!fixes.length) return;

  const kept = await serial(async () => {
    const out = thin(await lastKept(userId), fixes);
    if (!out.length) return out;
    const dir = dirFor(userId);
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    await FileSystem.writeAsStringAsync(
      `${dir}${fileName(Date.parse(out[0]!.t), out.length, Math.random().toString(36).slice(2, 8))}`,
      JSON.stringify(out),
    );
    await setLastKept(userId, out[out.length - 1]!);
    await mergeIfMany(userId).catch(() => {});
    return out;
  }).catch(() => [] as TrackPoint[]);

  if (kept.length) {
    setStatus({ lastFixAt: kept[kept.length - 1]!.t, waiting: status.waiting + kept.length });
    void sendRoute();
  }
}

/** Recount what is waiting, from the files (on start and after a send). */
export async function refreshRouteStatus(userId: string) {
  const files = await listFiles(userId);
  setStatus({ waiting: files.reduce((n, f) => n + countIn(f), 0) });
}

let lastAttempt = 0;

/**
 * Send what the phone holds for the signed-in officer. Safe to call often:
 * one send at a time, and at most every 15 seconds unless forced (signal
 * just came back). With no signal it stops at the first failure and the
 * files wait.
 */
export async function sendRoute(opts: { force?: boolean } = {}): Promise<void> {
  if (sending) return;
  if (!opts.force && Date.now() - lastAttempt < SEND_EVERY_MS) return;
  lastAttempt = Date.now();
  sending = true;
  try {
    const sb = getSupabase();
    const { data } = await sb.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) return;

    for (let round = 0; round < 50; round++) {
      const files = await serial(() => listFiles(userId));
      if (!files.length) break;
      const take: string[] = [];
      const points: TrackPoint[] = [];
      for (const name of files) {
        const more = await readFile(userId, name);
        if (take.length && points.length + more.length > BATCH) break;
        take.push(name);
        points.push(...more);
        if (points.length >= BATCH) break;
      }
      const deliverable = stillDeliverable(points, Date.now());
      try {
        for (let i = 0; i < deliverable.length; i += BATCH) {
          await recordTrack(sb, deliverable.slice(i, i + BATCH));
        }
      } catch (error) {
        const code = (error as { code?: string }).code;
        // A batch the server can never take would block the rest for ever.
        if (code !== '22023') {
          if (!isNetworkFailure(error)) console.warn('[criticom] route not sent', (error as Error).message);
          break;
        }
      }
      await serial(async () => {
        for (const name of take) await FileSystem.deleteAsync(`${dirFor(userId)}${name}`, { idempotent: true });
      });
      setStatus({ lastSentAt: new Date().toISOString() });
    }
    await refreshRouteStatus(userId);
  } catch {
    // Nothing is lost: the files wait for the next send.
  } finally {
    sending = false;
  }
}

/* ── Start and stop ───────────────────────────────────────────────────── */

let watcher: Location.LocationSubscription | null = null;

function stopWatcher() {
  watcher?.remove();
  watcher = null;
}

/**
 * Start recording for this officer. Background recording (a foreground
 * service on Android) is tried first; it must start while the app is open,
 * so the caller retries when the app comes back to the front.
 */
export async function startRoute(userId: string): Promise<RouteMode> {
  await setRouteOwner(userId);
  try {
    let perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== 'granted' && perm.canAskAgain) perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') {
      setStatus({ mode: 'denied' });
      return 'denied';
    }
    // iOS records with the app closed only with "Always"; ask once, carry on without it.
    if (Platform.OS === 'ios') await Location.requestBackgroundPermissionsAsync().catch(() => null);

    try {
      if (!TaskManager.isTaskDefined(ROUTE_TASK)) throw new Error('The route task is not defined');
      if (!(await Location.hasStartedLocationUpdatesAsync(ROUTE_TASK))) {
        // The duty notification in the person's language.
        await Location.startLocationUpdatesAsync(ROUTE_TASK, {
          ...OPTIONS,
          foregroundService: { ...OPTIONS.foregroundService!, notificationTitle: tNow('On duty'), notificationBody: tNow('Dispatch can see where you are.') },
        });
      }
      stopWatcher();
      setStatus({ mode: 'background' });
      return 'background';
    } catch (e) {
      // An older build without the background module, or Android refusing to
      // start the service right now: record while the app is open.
      console.warn('[criticom] background route unavailable, recording while open', (e as Error).message);
      if (!watcher) {
        watcher = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: 10_000, distanceInterval: 15 },
          (loc) => { void recordFixes([loc]); },
        );
      }
      setStatus({ mode: 'foreground' });
      return 'foreground';
    }
  } catch (e) {
    console.warn('[criticom] route recording could not start', (e as Error).message);
    setStatus({ mode: 'denied' });
    return 'denied';
  }
}

/** Stop recording (off duty, signing out). What is on the phone still sends. */
export async function stopRoute(): Promise<void> {
  await setRouteOwner(null);
  stopWatcher();
  try {
    if (TaskManager.isTaskDefined(ROUTE_TASK) && await Location.hasStartedLocationUpdatesAsync(ROUTE_TASK)) {
      await Location.stopLocationUpdatesAsync(ROUTE_TASK);
    }
  } catch { /* not running */ }
  setStatus({ mode: 'off' });
}
