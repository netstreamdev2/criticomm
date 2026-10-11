/**
 * The offline read cache's rules, with no dependencies.
 *
 * Every read the app makes from the database goes through one fetch
 * (lib/offline-cache.ts). When it succeeds, the answer is kept on the phone;
 * when the phone has no signal, the kept answer is handed back instead, so
 * every screen the crew has already opened still opens: their calls, the
 * call sheet, the timeline, the report forms, the schedule, the alerts.
 *
 * Split out from the storage so it can be tested: what counts as a read,
 * what a kept answer is filed under, and how old an answer may be before it
 * is no longer shown. Writes are never cached here — they go through the
 * outbox, which keeps and replays them.
 */

/**
 * RPCs that only read. Any other RPC may change something, and answering it
 * from the phone would pretend a change was made. Names ending in `_today`
 * are only answered from the phone on the day they were saved.
 */
export const READ_RPCS: ReadonlySet<string> = new Set([
  'has_completed_shift_start_today',
  'shift_readiness_passed_today',
  'shift_vehicle_passed_today',
  'shift_firearm_resolved_today',
  'shift_bodycam_resolved_today',
  'shift_requires_firearm',
  'shift_requires_bodycam',
  'count_unread_alerts',
  'bodycam_watch_status',
  'get_dispatcher_kpis',
  'search_everything',
  'criti_thresholds',
]);

/** A kept answer older than this is not shown: two shifts is the most a crew works offline. */
export const MAX_AGE_MS = 48 * 3_600_000;
/** Kept answers on the phone, newest kept first when trimming. */
export const MAX_ENTRIES = 800;
export const MAX_BYTES = 40 * 1024 * 1024;
/** One answer larger than this is not kept (a bulk export, not a screen). */
export const MAX_ENTRY_BYTES = 2 * 1024 * 1024;

export type CacheRule = { rpc: string | null };

/** Whether this request is a read worth keeping for offline, and which RPC it is. */
export function cacheRule(method: string, url: string): CacheRule | null {
  const m = method.toUpperCase();
  const at = url.indexOf('/rest/v1/');
  if (at < 0) return null;
  const path = url.slice(at + '/rest/v1/'.length).split('?')[0] ?? '';
  if (path.startsWith('rpc/')) {
    const name = decodeURIComponent(path.slice(4));
    if (m !== 'POST' && m !== 'GET') return null;
    return READ_RPCS.has(name) ? { rpc: name } : null;
  }
  return m === 'GET' || m === 'HEAD' ? { rpc: null } : null;
}

const ISO = String.raw`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?`;
const ISO_TIME = new RegExp(ISO, 'g');
const HAS_ISO_TIME = new RegExp(ISO);

/**
 * What a kept answer is filed under. Clock times in a query ("assigned since
 * 08:00 today", "the last 30 days") are folded into one placeholder, so the
 * same screen asked a minute later finds its answer; such answers are then
 * served only on the day they were saved (`dated`).
 */
export function cacheKey(req: {
  owner: string;
  method: string;
  url: string;
  accept?: string | null;
  prefer?: string | null;
  range?: string | null;
  body?: string | null;
}): { key: string; dated: boolean } {
  let url = req.url;
  try { url = decodeURIComponent(url); } catch { /* keep as sent */ }
  const body = req.body ?? '';
  const dated = HAS_ISO_TIME.test(url) || HAS_ISO_TIME.test(body);
  const fold = (s: string) => s.replace(ISO_TIME, '<t>');
  const key = [
    req.owner,
    req.method.toUpperCase(),
    fold(url),
    req.accept ?? '',
    req.prefer ?? '',
    req.range ?? '',
    fold(body),
  ].join('\n');
  return { key, dated };
}

/** The calendar day in South Africa (UTC+2 all year) for an instant. */
export function saDay(ms: number): string {
  return new Date(ms + 2 * 3_600_000).toISOString().slice(0, 10);
}

export type KeptMeta = { savedAt: number; dated: boolean; rpc: string | null };

/** Whether a kept answer may stand in for the server now. */
export function servable(meta: KeptMeta, now: number): boolean {
  if (now - meta.savedAt > MAX_AGE_MS) return false;
  if (meta.savedAt - now > 5 * 60_000) return false; // a clock that jumped back
  const sameDayOnly = meta.dated || (meta.rpc?.endsWith('_today') ?? false);
  return !sameDayOnly || saDay(meta.savedAt) === saDay(now);
}

/** A 53-bit string hash (cyrb53), as hex: the kept answer's file name. */
export function hashKey(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

export type IndexRow = { hash: string; savedAt: number; size: number };

/** Which kept answers to delete: too old, then the oldest until under both limits. */
export function evictions(
  rows: readonly IndexRow[],
  now: number,
  limits: { maxEntries: number; maxBytes: number; maxAge: number } = {
    maxEntries: MAX_ENTRIES, maxBytes: MAX_BYTES, maxAge: MAX_AGE_MS,
  },
): string[] {
  const out: string[] = [];
  const keep: IndexRow[] = [];
  for (const r of rows) {
    if (now - r.savedAt > limits.maxAge) out.push(r.hash);
    else keep.push(r);
  }
  keep.sort((a, b) => b.savedAt - a.savedAt);
  let bytes = 0;
  keep.forEach((r, i) => {
    bytes += r.size;
    if (i >= limits.maxEntries || bytes > limits.maxBytes) out.push(r.hash);
  });
  return out;
}

/**
 * Whether an error means "no connection" rather than "the server said no".
 * Only these fall back to what is kept on the phone, and only these are
 * shown as "No connection".
 */
export function isNetworkFailure(error: unknown): boolean {
  const e = error as { name?: string; message?: string; code?: string; status?: number } | null;
  if (!e) return false;
  if (e.name === 'AbortError' || e.code === 'ABORT_ERR') return true;
  const message = `${e.name ?? ''} ${e.message ?? ''}`;
  if (/network request failed|failed to fetch|fetcherror|network ?error|timed? ?out|no connection|load failed|internet connection/i.test(message)) {
    return true;
  }
  return false;
}

/** The words a screen shows for an error: "No connection" for a dead network, the server's reason otherwise. */
export function errorWords(error: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (isNetworkFailure(error)) return 'No connection. Try again when you have signal.';
  const message = (error as { message?: string } | null)?.message?.trim();
  return message || fallback;
}
