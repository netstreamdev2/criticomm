import { useSyncExternalStore } from 'react';
import * as FileSystem from 'expo-file-system';
import {
  cacheKey, cacheRule, evictions, hashKey, isNetworkFailure, MAX_ENTRY_BYTES, servable,
  type IndexRow, type KeptMeta,
} from './offline-cache-policy.ts';

/**
 * The offline read cache: the phone keeps the last answer to every database
 * read it made, and answers from it when there is no signal.
 *
 * It sits under supabase-js as its fetch (lib/supabase.ts), so every screen
 * gets it without changing how it loads: a screen asks as it always does, and
 * offline it receives what it showed last time, marked with when that was.
 * The rules — what is a read, how long an answer may stand in — are in
 * offline-cache-policy.ts and tested there.
 *
 * Answers are filed per person (setCacheOwner, set from the session), so one
 * crew member never sees another's on a shared handset, and they are deleted
 * when that person signs out. Files, not AsyncStorage: Android caps
 * AsyncStorage at a few megabytes, which the outbox needs.
 */

const DIR = `${FileSystem.documentDirectory ?? ''}offline-cache/`;
const INDEX = `${DIR}index.json`;

/** A read with no answer in this long is treated as no signal (a dead zone that never says so). */
const READ_TIMEOUT_MS = 20_000;
/** Renewing the sign-in waits no longer than this before the app carries on with the saved one. */
const AUTH_TIMEOUT_MS = 20_000;

let owner: string | null = null;

/** The person whose answers are read and kept. Null keeps nothing. */
export function setCacheOwner(userId: string | null) {
  owner = userId;
}

/* ── What the screens are showing ─────────────────────────────────────── */

/** When the oldest saved answer now on screen was saved, or null when everything is live. */
let showingSavedFrom: number | null = null;
const listeners = new Set<() => void>();
const notify = () => { for (const l of listeners) l(); };

function markServed(savedAt: number) {
  if (showingSavedFrom === null || savedAt < showingSavedFrom) {
    showingSavedFrom = savedAt;
    notify();
  }
}

function markLive() {
  if (showingSavedFrom !== null) {
    showingSavedFrom = null;
    notify();
  }
}

/** Null while screens show live data; otherwise when what they show was saved. */
export function useShowingSaved(): number | null {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => showingSavedFrom,
  );
}

/* ── Storage ──────────────────────────────────────────────────────────── */

type Kept = KeptMeta & {
  key: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
};

let index: Map<string, IndexRow> | null = null;
let indexLoad: Promise<Map<string, IndexRow>> | null = null;
let indexTimer: ReturnType<typeof setTimeout> | null = null;
let savesSincePrune = 0;

async function ensureDir() {
  const info = await FileSystem.getInfoAsync(DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
}

function loadIndex(): Promise<Map<string, IndexRow>> {
  if (index) return Promise.resolve(index);
  if (indexLoad) return indexLoad;
  indexLoad = (async () => {
    const map = new Map<string, IndexRow>();
    try {
      await ensureDir();
      const info = await FileSystem.getInfoAsync(INDEX);
      if (info.exists) {
        const rows = JSON.parse(await FileSystem.readAsStringAsync(INDEX)) as IndexRow[];
        for (const r of Array.isArray(rows) ? rows : []) {
          if (r && typeof r.hash === 'string' && typeof r.savedAt === 'number') map.set(r.hash, r);
        }
      }
    } catch {
      // A damaged index: start again rather than serve answers we cannot date.
      await FileSystem.deleteAsync(DIR, { idempotent: true }).catch(() => {});
      await ensureDir().catch(() => {});
    }
    index = map;
    indexLoad = null;
    void prune();
    return map;
  })();
  return indexLoad;
}

function writeIndexSoon() {
  if (indexTimer) return;
  indexTimer = setTimeout(() => {
    indexTimer = null;
    if (!index) return;
    void FileSystem.writeAsStringAsync(INDEX, JSON.stringify([...index.values()])).catch(() => {});
  }, 3_000);
}

async function prune() {
  const map = index;
  if (!map) return;
  for (const hash of evictions([...map.values()], Date.now())) {
    map.delete(hash);
    await FileSystem.deleteAsync(`${DIR}${hash}.json`, { idempotent: true }).catch(() => {});
  }
  writeIndexSoon();
}

async function keep(hash: string, kept: Kept) {
  try {
    const text = JSON.stringify(kept);
    if (text.length > MAX_ENTRY_BYTES) return;
    const map = await loadIndex();
    await ensureDir();
    await FileSystem.writeAsStringAsync(`${DIR}${hash}.json`, text);
    map.set(hash, { hash, savedAt: kept.savedAt, size: text.length });
    writeIndexSoon();
    if (++savesSincePrune >= 40) {
      savesSincePrune = 0;
      void prune();
    }
  } catch {
    // Storage full or unavailable: the app works on, it just keeps less.
  }
}

async function recall(hash: string, key: string): Promise<Kept | null> {
  try {
    const map = await loadIndex();
    if (!map.has(hash)) return null;
    const kept = JSON.parse(await FileSystem.readAsStringAsync(`${DIR}${hash}.json`)) as Kept;
    // Two requests whose keys share a hash must never swap answers.
    return kept.key === key ? kept : null;
  } catch {
    return null;
  }
}

/** Forget everything kept on this phone — on sign-out, so the next person sees none of it. */
export async function clearOfflineCache(): Promise<void> {
  // Nothing is answered from the phone from this moment; the files follow.
  index = new Map();
  showingSavedFrom = null;
  notify();
  await FileSystem.deleteAsync(DIR, { idempotent: true }).catch(() => {});
  index = null;
  indexLoad = null;
}

/* ── The fetch ────────────────────────────────────────────────────────── */

/** fetch, but a request with no answer in `ms` fails as a dead network does. */
async function timed(base: typeof fetch, input: RequestInfo | URL, init: RequestInit | undefined, ms: number) {
  const ctrl = new AbortController();
  const outer = init?.signal;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, ms);
  const forward = () => ctrl.abort();
  if (outer) {
    if (outer.aborted) ctrl.abort();
    else outer.addEventListener?.('abort', forward);
  }
  try {
    return await base(input, { ...init, signal: ctrl.signal });
  } catch (error) {
    if (timedOut && !outer?.aborted) throw new TypeError('Network request failed');
    throw error;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener?.('abort', forward);
  }
}

function headerOf(init: RequestInit | undefined, name: string): string | null {
  const h = init?.headers;
  if (!h) return null;
  if (typeof (h as Headers).get === 'function') return (h as Headers).get(name);
  if (Array.isArray(h)) {
    const hit = h.find(([k]) => k.toLowerCase() === name);
    return hit ? hit[1] : null;
  }
  for (const [k, v] of Object.entries(h as Record<string, string>)) {
    if (k.toLowerCase() === name) return v;
  }
  return null;
}

const NO_BODY = new Set([101, 204, 205, 304]);

function toResponse(kept: Kept, method: string): Response {
  const headers = { ...kept.headers, 'x-criticom-saved-at': new Date(kept.savedAt).toISOString() };
  const body = method === 'HEAD' || NO_BODY.has(kept.status) ? null : kept.body;
  return new Response(body, { status: kept.status, statusText: kept.statusText, headers });
}

/**
 * The fetch supabase-js uses. Reads are kept and, with no signal, answered
 * from the phone; everything else passes straight through (writes go through
 * the outbox, which keeps and replays them itself).
 *
 * `anonKey` tells a request sent as nobody apart: when the sign-in is due
 * for renewal and could not be renewed yet (the first minute back in signal),
 * supabase-js sends the project key instead, and the server answers as if
 * nobody were signed in — empty lists, refusals. Those reads are answered
 * from the phone instead, and never kept over the person's real answers.
 */
export function createOfflineFetch(base: typeof fetch = fetch, anonKey = ''): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();

    if (url.includes('/auth/v1/token')) return timed(base, input, init, AUTH_TIMEOUT_MS);

    const rule = cacheRule(method, url);
    const who = owner;
    if (!rule || !who) return base(input, init);

    const body = typeof init?.body === 'string' ? init.body : null;
    const { key, dated } = cacheKey({
      owner: who, method, url, body,
      accept: headerOf(init, 'accept'), prefer: headerOf(init, 'prefer'), range: headerOf(init, 'range'),
    });
    const hash = hashKey(key);

    if (anonKey && headerOf(init, 'authorization') === `Bearer ${anonKey}`) {
      const kept = await recall(hash, key);
      if (kept && servable(kept, Date.now())) {
        markServed(kept.savedAt);
        return toResponse(kept, method);
      }
      return base(input, init);
    }

    try {
      const res = await timed(base, input, init, READ_TIMEOUT_MS);
      markLive();
      if (res.ok && owner === who) {
        const copy = res.clone();
        void copy.text().then((text) => {
          const headers: Record<string, string> = {};
          copy.headers.forEach((value: string, name: string) => { if (name !== 'set-cookie') headers[name] = value; });
          return keep(hash, {
            key, savedAt: Date.now(), dated, rpc: rule.rpc,
            status: copy.status, statusText: copy.statusText, headers, body: text,
          });
        }).catch(() => {});
      }
      return res;
    } catch (error) {
      // Cancelled by the screen, or a real error from the server: not ours to answer.
      if (init?.signal?.aborted || !isNetworkFailure(error)) throw error;
      const kept = await recall(hash, key);
      if (kept && servable(kept, Date.now())) {
        markServed(kept.savedAt);
        return toResponse(kept, method);
      }
      throw error;
    }
  };
}
