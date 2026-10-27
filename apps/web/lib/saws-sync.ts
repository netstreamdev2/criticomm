import 'server-only';
import { warningHazard } from '@criticom/db/disaster-warnings';
import { getServiceSupabase } from '@/lib/supabase';
import { forEthekwini, parseCap, parseFeed, stampTime } from './saws-cap';

/**
 * Reads the SA Weather Service's warning feed for eThekwini (0116) and hands
 * each new KZN file to ingest_saws_warning() with the service role, so only
 * the server can say a warning came from SAWS. At most once every five
 * minutes per organisation, across every server (disaster_feed_state); the
 * desk's open screens ask for it (/api/disaster/warnings/sync). Files are
 * read oldest first and the round stops at the first that does not load, so
 * a later re-issue is never overwritten by an earlier one.
 */

const FEED = 'https://caps.weathersa.co.za/Home/RssFeed';
const EVERY_MS = 5 * 60_000;
/** Older files are history; their warnings have long expired. */
const LOOK_BACK_MS = 4 * 24 * 3600_000;
const FILES_PER_ROUND = 25;

export type SyncResult = { ok: boolean; read: number; forUs: number; detail?: string };

const lastTry = new Map<string, number>();
const running = new Map<string, Promise<SyncResult>>();

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;

export function syncSawsWarnings(tenantId: string, opts: { force?: boolean } = {}): Promise<SyncResult> {
  const now = Date.now();
  if (!opts.force && now - (lastTry.get(tenantId) ?? 0) < EVERY_MS) return Promise.resolve({ ok: true, read: 0, forUs: 0, detail: 'read recently' });
  const busy = running.get(tenantId);
  if (busy) return busy;
  lastTry.set(tenantId, now);
  const job = run(tenantId, opts.force === true).finally(() => running.delete(tenantId));
  running.set(tenantId, job);
  return job;
}

async function run(tenantId: string, force: boolean): Promise<SyncResult> {
  let db: ReturnType<typeof getServiceSupabase>;
  try {
    db = getServiceSupabase();
  } catch {
    return { ok: false, read: 0, forUs: 0, detail: 'The server cannot reach the warnings store.' };
  }
  const call = db.rpc as unknown as Rpc;
  const note = (ok: boolean, detail: string) => call('note_feed_sync', { p_tenant: tenantId, p_feed: 'saws', p_ok: ok, p_detail: detail }).catch(() => undefined);

  // Another server may have read it a moment ago.
  if (!force) {
    const { data } = await db.from('disaster_feed_state').select('synced_at').eq('tenant_id', tenantId).eq('feed', 'saws').maybeSingle();
    const at = data ? Date.parse((data as { synced_at: string }).synced_at) : 0;
    if (Date.now() - at < EVERY_MS - 15_000) return { ok: true, read: 0, forUs: 0, detail: 'read recently' };
  }

  try {
    const res = await fetch(FEED, { cache: 'no-store', signal: AbortSignal.timeout(12_000) });
    if (!res.ok) throw new Error(`The SA Weather Service feed answered ${res.status}.`);
    const now = Date.now();
    const files = parseFeed(await res.text())
      .filter((f) => f.province === 'KZN' && now - stampTime(f.stamp).getTime() < LOOK_BACK_MS);
    const { data: seen } = await db.from('disaster_saws_files').select('file').eq('tenant_id', tenantId).in('file', files.map((f) => f.file));
    const done = new Set(((seen ?? []) as Array<{ file: string }>).map((r) => r.file));
    const todo = files.filter((f) => !done.has(f.file)).slice(0, FILES_PER_ROUND);

    let read = 0;
    let forUs = 0;
    for (const f of todo) {
      const r = await fetch(f.url, { cache: 'no-store', signal: AbortSignal.timeout(15_000) }).catch(() => null);
      if (!r?.ok) break;
      const alert = parseCap(await r.text());
      // A file that is not a warning is noted as read, so it never holds up the rest.
      const w = alert ? forEthekwini(alert, f, warningHazard)
        : { key: `${f.province}|unreadable|${f.file}`, file: f.file, msg_type: 'Alert', touches: false };
      const { error } = await call('ingest_saws_warning', { p_tenant: tenantId, p_fields: w });
      if (error) throw new Error(`A SAWS warning could not be saved: ${error.message}`);
      read++;
      if (w.touches) forUs++;
    }
    await note(true, `${read} new file${read === 1 ? '' : 's'} read, ${forUs} for eThekwini`);
    return { ok: true, read, forUs };
  } catch (e) {
    const detail = (e as Error).message?.slice(0, 200) || 'The SA Weather Service feed did not answer.';
    await note(false, detail);
    return { ok: false, read: 0, forUs: 0, detail };
  }
}
