import type { CriticomClient, Database } from '@criticom/db';

/**
 * Early warnings (0116): SA Weather Service warnings for eThekwini, the
 * steps the desk takes each through, the JOC's readiness sessions, and the
 * councillors the warning SMS goes to. Reads go through RLS; every write is a
 * guarded function.
 */

type Tables = Database['public']['Tables'];
export type DisasterWarning = Tables['disaster_warnings']['Row'];
export type WarningEvent = Tables['disaster_warning_events']['Row'];
export type JocSession = Tables['disaster_joc_sessions']['Row'];
export type Councillor = Tables['disaster_councillors']['Row'];
export type FeedState = Tables['disaster_feed_state']['Row'];

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
const rpc = async <T>(client: CriticomClient, fn: string, args: Record<string, unknown>) => {
  const { data, error } = await (client.rpc as unknown as Rpc)(fn, args);
  if (error) throw error;
  return data as T;
};

/** The signed-in person's organisation, for the server's feed reader. */
export async function currentTenant(client: CriticomClient): Promise<string | null> {
  const { data, error } = await (client.rpc as unknown as Rpc)('current_tenant', {});
  return error || typeof data !== 'string' ? null : data;
}

/** Warnings that end after `since` (in force, coming, or just over), newest first; [] until 0116 is run. */
export async function listWarnings(client: CriticomClient, since: Date, limit = 100): Promise<DisasterWarning[]> {
  const { data, error } = await client.from('disaster_warnings').select('*')
    .gte('valid_until', since.toISOString()).order('valid_from', { ascending: false }).limit(limit);
  if (error) return [];
  return (data ?? []) as DisasterWarning[];
}

/** The warnings still to watch: not ended, not expired. */
export async function listLiveWarnings(client: CriticomClient): Promise<DisasterWarning[]> {
  const { data, error } = await client.from('disaster_warnings').select('*')
    .eq('status', 'Active').gt('valid_until', new Date().toISOString()).order('level', { ascending: false });
  if (error) return [];
  return (data ?? []) as DisasterWarning[];
}

export async function getWarning(client: CriticomClient, id: string): Promise<DisasterWarning | null> {
  const { data, error } = await client.from('disaster_warnings').select('*').eq('id', id).maybeSingle();
  if (error) return null;
  return (data ?? null) as DisasterWarning | null;
}

export async function listWarningEvents(client: CriticomClient, warningId: string): Promise<WarningEvent[]> {
  const { data, error } = await client.from('disaster_warning_events').select('*').eq('warning_id', warningId).order('at', { ascending: false }).limit(300);
  if (error) return [];
  return (data ?? []) as WarningEvent[];
}

export async function listReadinessSessions(client: CriticomClient, warningIds: string[]): Promise<JocSession[]> {
  if (!warningIds.length) return [];
  const { data, error } = await client.from('disaster_joc_sessions').select('*').in('warning_id', warningIds).order('held_at', { ascending: false });
  if (error) return [];
  return (data ?? []) as JocSession[];
}

export async function getFeedState(client: CriticomClient): Promise<FeedState | null> {
  const { data, error } = await client.from('disaster_feed_state').select('*').eq('feed', 'saws').maybeSingle();
  if (error) return null;
  return (data ?? null) as FeedState | null;
}

export async function listCouncillors(client: CriticomClient): Promise<Councillor[]> {
  const { data, error } = await client.from('disaster_councillors').select('*').order('ward', { ascending: true, nullsFirst: false }).order('name');
  if (error) return [];
  return (data ?? []) as Councillor[];
}

export const recordWarning = (client: CriticomClient, clientRef: string, fields: Record<string, unknown>) =>
  rpc<DisasterWarning>(client, 'record_disaster_warning', { p_client_ref: clientRef, p_fields: fields });
export const setWarningStep = (client: CriticomClient, warningId: string, step: string, done: boolean) =>
  rpc<DisasterWarning>(client, 'set_warning_step', { p_warning_id: warningId, p_step: step, p_done: done });
export const setWarningColour = (client: CriticomClient, warningId: string, colour: string | null) =>
  rpc<DisasterWarning>(client, 'set_warning_colour', { p_warning_id: warningId, p_colour: colour ?? '' });
export const endWarning = (client: CriticomClient, warningId: string, reason: string) =>
  rpc<DisasterWarning>(client, 'end_disaster_warning', { p_warning_id: warningId, p_reason: reason });
export const holdReadinessSession = (client: CriticomClient, warningId: string, clientRef: string, fields: Record<string, unknown>) =>
  rpc<JocSession>(client, 'hold_readiness_session', { p_warning_id: warningId, p_client_ref: clientRef, p_fields: fields });
export const openIncidentFromWarning = (client: CriticomClient, warningId: string, clientRef: string, fields: Record<string, unknown>) =>
  rpc<Tables['incidents']['Row']>(client, 'open_incident_from_warning', { p_warning_id: warningId, p_client_ref: clientRef, p_fields: fields });
export const logWarningSms = (client: CriticomClient, warningId: string, sent: number, failed: number, body: string) =>
  rpc<DisasterWarning>(client, 'log_warning_sms', { p_warning_id: warningId, p_sent: sent, p_failed: failed, p_body: body });
export const saveCouncillor = (client: CriticomClient, id: string | null, fields: Record<string, unknown>) =>
  rpc<Councillor>(client, 'save_councillor', { p_id: id, p_fields: fields });
export const importCouncillors = (client: CriticomClient, rows: Array<Record<string, unknown>>) =>
  rpc<{ added: number; changed: number; skipped: number }>(client, 'import_councillors', { p_rows: rows });
