import type { CriticomClient, Database } from '@criticom/db';

/**
 * Past disasters from the records (0119): read through RLS, loaded only
 * through import_past_events().
 */

export type PastEvent = Database['public']['Tables']['disaster_past_events']['Row'];

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;

/** Past events, newest first; one ward's when ward is given. [] until 0119 is run. */
export async function listPastEvents(client: CriticomClient, opts: { ward?: number; limit?: number } = {}): Promise<PastEvent[]> {
  let q = client.from('disaster_past_events').select('*');
  if (opts.ward != null) q = q.eq('ward', opts.ward);
  const { data, error } = await q.order('year', { ascending: false }).order('occurred_on', { ascending: false, nullsFirst: false }).limit(opts.limit ?? 2000);
  if (error) return [];
  return (data ?? []) as PastEvent[];
}

export async function importPastEvents(client: CriticomClient, source: string, rows: Array<Record<string, unknown>>) {
  const { data, error } = await (client.rpc as unknown as Rpc)('import_past_events', { p_source: source, p_rows: rows });
  if (error) throw error;
  return data as { loaded: number; skipped: number };
}
