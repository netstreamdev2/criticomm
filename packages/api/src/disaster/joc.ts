import type { CriticomClient, Database } from '@criticom/db';

/**
 * Levels with their reasons, the JOC, the incident's status, recovery and
 * the review (0117). Reads go through RLS; every write is a guarded function.
 */

type Tables = Database['public']['Tables'];
type Facts = Tables['disaster_call_facts']['Row'];
export type LevelChange = Tables['disaster_level_changes']['Row'];
export type JocMember = Tables['disaster_joc_members']['Row'];
export type DisasterReview = Tables['disaster_reviews']['Row'];
export type JocDailySession = Tables['disaster_joc_sessions']['Row'];

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
const rpc = async <T>(client: CriticomClient, fn: string, args: Record<string, unknown>) => {
  const { data, error } = await (client.rpc as unknown as Rpc)(fn, args);
  if (error) throw error;
  return data as T;
};

export async function listLevelChanges(client: CriticomClient, incidentId: string): Promise<LevelChange[]> {
  const { data, error } = await client.from('disaster_level_changes').select('*').eq('incident_id', incidentId).order('at', { ascending: true });
  if (error) return [];
  return (data ?? []) as LevelChange[];
}

export async function listJocMembers(client: CriticomClient, incidentId: string): Promise<JocMember[]> {
  const { data, error } = await client.from('disaster_joc_members').select('*').eq('incident_id', incidentId).is('left_at', null).order('added_at');
  if (error) return [];
  return (data ?? []) as JocMember[];
}

export async function listJocSessions(client: CriticomClient, incidentId: string): Promise<JocDailySession[]> {
  const { data, error } = await client.from('disaster_joc_sessions').select('*').eq('incident_id', incidentId).order('held_at', { ascending: false });
  if (error) return [];
  return (data ?? []) as JocDailySession[];
}

export async function getReview(client: CriticomClient, incidentId: string): Promise<DisasterReview | null> {
  const { data, error } = await client.from('disaster_reviews').select('*').eq('incident_id', incidentId).maybeSingle();
  if (error) return null;
  return (data ?? null) as DisasterReview | null;
}

export async function listReviews(client: CriticomClient, incidentIds: string[]): Promise<DisasterReview[]> {
  if (!incidentIds.length) return [];
  const { data, error } = await client.from('disaster_reviews').select('*').in('incident_id', incidentIds);
  if (error) return [];
  return (data ?? []) as DisasterReview[];
}

/**
 * Disaster incidents whose response is over but whose review is not signed
 * off: the Recovery and review panel. Stood down, in recovery, or closed by
 * the desk; the case may be closed too.
 */
export async function listRecoveryFacts(client: CriticomClient): Promise<Facts[]> {
  const { data, error } = await client.from('disaster_call_facts').select('*').in('dm_status', ['Stood down', 'In recovery', 'Closed'])
    .order('dm_status_at', { ascending: false }).limit(200);
  if (error) return [];
  return (data ?? []) as Facts[];
}

export const escalateIncident = (client: CriticomClient, incidentId: string, level: 'Bronze' | 'Silver' | 'Gold', fields: Record<string, unknown>) =>
  rpc<Facts>(client, 'escalate_incident', { p_incident_id: incidentId, p_level: level, p_fields: fields });
export const setLevelPlaces = (client: CriticomClient, incidentId: string, fields: Record<string, unknown>) =>
  rpc<Facts>(client, 'set_level_places', { p_incident_id: incidentId, p_fields: fields });
export const setIncidentCheck = (client: CriticomClient, incidentId: string, key: string, done: boolean) =>
  rpc<Facts>(client, 'set_incident_check', { p_incident_id: incidentId, p_key: key, p_done: done });
export const setInformalSettlement = (client: CriticomClient, incidentId: string, on: boolean) =>
  rpc<Facts>(client, 'set_informal_settlement', { p_incident_id: incidentId, p_on: on });
export const addJocMember = (client: CriticomClient, incidentId: string, fields: Record<string, unknown>) =>
  rpc<JocMember>(client, 'add_joc_member', { p_incident_id: incidentId, p_fields: fields });
export const removeJocMember = (client: CriticomClient, memberId: string) =>
  rpc<JocMember>(client, 'remove_joc_member', { p_member_id: memberId });
export const logJocSession = (client: CriticomClient, incidentId: string, clientRef: string, fields: Record<string, unknown>) =>
  rpc<JocDailySession>(client, 'log_joc_session', { p_incident_id: incidentId, p_client_ref: clientRef, p_fields: fields });
export const setDmStatus = (client: CriticomClient, incidentId: string, status: string, fields: Record<string, unknown>) =>
  rpc<Facts>(client, 'set_dm_status', { p_incident_id: incidentId, p_status: status, p_fields: fields });
export const setRecoveryTask = (client: CriticomClient, incidentId: string, task: string, state: string, note: string | null) =>
  rpc<Facts>(client, 'set_recovery_task', { p_incident_id: incidentId, p_task: task, p_state: state, p_note: note });
export const saveReview = (client: CriticomClient, incidentId: string, fields: Record<string, unknown>) =>
  rpc<DisasterReview>(client, 'save_disaster_review', { p_incident_id: incidentId, p_fields: fields });
export const signReview = (client: CriticomClient, incidentId: string, key: string, done: boolean) =>
  rpc<DisasterReview>(client, 'sign_disaster_review', { p_incident_id: incidentId, p_key: key, p_done: done });

/**
 * Every Disaster incident of the last year, open or closed, newest first (the
 * Incidents list): the call and its Disaster facts.
 */
export async function listDisasterIncidents(client: CriticomClient, since: Date, limit = 500) {
  const { data, error } = await client.from('incidents')
    .select('id, incident_number, incident_type, disaster_type, incident_severity, location_address, suburb, status, call_timestamp, updated_at, number_of_victims')
    .or('silo.eq.EthekwiniDisaster,dispatched_silos.cs.{EthekwiniDisaster},tagged_silos.cs.{EthekwiniDisaster}')
    .gte('call_timestamp', since.toISOString())
    .order('call_timestamp', { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []) as Array<{
    id: string; incident_number: string; incident_type: string; disaster_type: string | null; incident_severity: string;
    location_address: string; suburb: string | null; status: string; call_timestamp: string; updated_at: string | null; number_of_victims: number | null;
  }>;
}

/** Incidents the desk placed in a ward (the call's facts), newest first. */
export async function listWardIncidentFacts(client: CriticomClient, ward: number) {
  const { data, error } = await client.from('disaster_call_facts').select('*').eq('ward', String(ward)).order('updated_at', { ascending: false }).limit(200);
  if (error) return [];
  return (data ?? []) as Facts[];
}
