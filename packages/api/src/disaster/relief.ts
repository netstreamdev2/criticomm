import type { CriticomClient, Database } from '@criticom/db';

/**
 * Relief through the ward councillors (0118): beneficiaries and items issued
 * by ward on an incident, and the relief stock with its minimums. Reads go
 * through RLS; every write is a guarded function.
 */

type Tables = Database['public']['Tables'];
export type WardRelief = Tables['disaster_ward_relief']['Row'];
export type ReliefStock = Tables['relief_stocks']['Row'];

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
const rpc = async <T>(client: CriticomClient, fn: string, args: Record<string, unknown>) => {
  const { data, error } = await (client.rpc as unknown as Rpc)(fn, args);
  if (error) throw error;
  return data as T;
};

export async function listWardRelief(client: CriticomClient, incidentId: string): Promise<WardRelief[]> {
  const { data, error } = await client.from('disaster_ward_relief').select('*').eq('incident_id', incidentId).order('municipality').order('ward');
  if (error) return [];
  return (data ?? []) as WardRelief[];
}

/** Every ward's relief recorded from `since` (a financial year's issues, C69's people). */
export async function listWardReliefSince(client: CriticomClient, since: Date, until: Date): Promise<WardRelief[]> {
  const { data, error } = await client.from('disaster_ward_relief').select('*')
    .gte('recorded_at', since.toISOString()).lt('recorded_at', until.toISOString()).limit(5000);
  if (error) return [];
  return (data ?? []) as WardRelief[];
}

export const saveWardRelief = (client: CriticomClient, incidentId: string, fields: Record<string, unknown>) =>
  rpc<WardRelief>(client, 'save_ward_relief', { p_incident_id: incidentId, p_fields: fields });
export const removeWardRelief = (client: CriticomClient, id: string) => rpc<null>(client, 'remove_ward_relief', { p_id: id });
export const setReliefStock = (client: CriticomClient, item: string, inStorage: number, minimum: number) =>
  rpc<ReliefStock>(client, 'set_relief_stock', { p_item: item, p_in_storage: inStorage, p_minimum: minimum });

/** One ward's relief on every incident, newest first (the ward profile). */
export async function listWardReliefForWard(client: CriticomClient, ward: number): Promise<WardRelief[]> {
  const { data, error } = await client.from('disaster_ward_relief').select('*').eq('municipality', 'eThekwini Metro').eq('ward', ward)
    .order('recorded_at', { ascending: false }).limit(200);
  if (error) return [];
  return (data ?? []) as WardRelief[];
}
