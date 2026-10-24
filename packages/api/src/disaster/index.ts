import type { CriticomClient, Database } from '@criticom/db';

type Tables = Database['public']['Tables'];

type Incident = Tables['incidents']['Row'];

/**
 * DisasterController.GetActiveIncidents — the Disaster Management incidents
 * still open (owned by Disaster or sent to it), newest first.
 */
export async function listOpenDisasterIncidents(client: CriticomClient): Promise<Incident[]> {
  const { data, error } = await client
    .from('incidents')
    .select('*')
    .or('silo.eq.EthekwiniDisaster,dispatched_silos.cs.{EthekwiniDisaster}')
    .not('status', 'in', '("Resolved","Closed")')
    .order('call_timestamp', { ascending: false })
    .limit(200);
  if (error) throw error;
  return data ?? [];
}

/** The deployment log for one incident, if resources were dispatched (one per incident, as V4). */
export async function getDisasterLogForIncident(client: CriticomClient, incidentId: string) {
  const { data, error } = await client
    .from('disaster_logs').select('*').eq('incident_id', incidentId)
    .order('dispatch_timestamp', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

/** DisasterController.Monitor — active disaster logs */
export async function listDisasterLogs(client: CriticomClient) {
  const { data, error } = await client
    .from('disaster_logs')
    .select('*')
    .order('dispatch_timestamp', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** DisasterController.DispatchResources POST (a new log; see updateDisasterLog for one already dispatched) */
export async function createDisasterLog(
  client: CriticomClient,
  input: Tables['disaster_logs']['Insert'],
) {
  const { data, error } = await client
    .from('disaster_logs').insert(input).select().single();
  if (error) throw error;
  return data;
}

/** DisasterController.DispatchResources POST for an incident already dispatched: the log is updated, as V4 did. */
export async function updateDisasterLog(
  client: CriticomClient,
  id: string,
  patch: Tables['disaster_logs']['Update'],
) {
  const { data, error } = await client.from('disaster_logs').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

/** DisasterController.LogPeriodicUpdate — append {timestamp,text} to the JSON timeline */
export async function appendDisasterUpdate(
  client: CriticomClient,
  args: { log_id: string; text: string },
) {
  const { data: row, error: getErr } = await client
    .from('disaster_logs').select('updates').eq('id', args.log_id).single();
  if (getErr) throw getErr;
  const updates = Array.isArray(row.updates) ? row.updates : [];
  const { data, error } = await client
    .from('disaster_logs')
    .update({ updates: [...updates, { timestamp: new Date().toISOString(), text: args.text }] })
    .eq('id', args.log_id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** DisasterController.GetPartnersByResource — mutual-aid directory */
export async function listMutualAidPartners(client: CriticomClient, resourceType?: string) {
  let q = client.from('mutual_aid_partners').select('*').eq('is_active', true);
  if (resourceType) q = q.eq('resource_type', resourceType);
  const { data, error } = await q.order('agency_name');
  if (error) throw error;
  return data ?? [];
}

/** DisasterController.PostMortem POST — after-action report */
type PostMortem = Tables['post_mortem_reports']['Row'];

/**
 * File the post-mortem that closes a Disaster incident (0065). The server
 * checks who may file, links it to the incident, takes the timeline, resolves
 * the incident and tells dispatch. Replaying it returns the report filed.
 */
export async function filePostMortem(
  client: CriticomClient,
  args: { incidentId: string; fields: Record<string, string> },
): Promise<PostMortem> {
  const { data, error } = await client.rpc('file_post_mortem', { p_incident_id: args.incidentId, p_fields: args.fields });
  if (error) throw error;
  return data as PostMortem;
}

/** The post-mortem filed against an incident, if any. */
export async function getPostMortemForIncident(client: CriticomClient, incidentId: string): Promise<PostMortem | null> {
  const { data, error } = await client
    .from('post_mortem_reports').select('*').eq('incident_id', incidentId)
    .order('report_filed_at', { ascending: true }).limit(1).maybeSingle();
  if (error) throw error;
  return data as PostMortem | null;
}

export async function listPostMortems(client: CriticomClient) {
  const { data, error } = await client
    .from('post_mortem_reports')
    .select('*')
    .order('report_filed_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/* ── On standby and the assessment on site (0107) ───────────────────────── */

export type StandbyRecord = Tables['disaster_standby']['Row'];
export type DisasterAssessment = Tables['disaster_assessments']['Row'];

/**
 * Go on standby: today's readiness check must be done; the number the call
 * centre dials and the kit are recorded (a missing item is noted, not refused).
 */
export async function startStandby(client: CriticomClient, args: { contactNumber: string; kit: Record<string, boolean> }) {
  const { data, error } = await client.rpc('start_standby', { p_fields: { contact_number: args.contactNumber, kit: args.kit } });
  if (error) throw error;
  return data as StandbyRecord;
}

/** End standby (refused while leading an open call-out). */
export async function endStandby(client: CriticomClient, reason?: string | null) {
  const { data, error } = await client.rpc('end_standby', { p_reason: reason ?? null });
  if (error) throw error;
  return data as StandbyRecord;
}

/** This officer's standby now, if on standby. */
export async function getMyStandby(client: CriticomClient, userId: string) {
  const { data, error } = await client.from('disaster_standby').select('*')
    .eq('user_id', userId).is('ended_at', null).maybeSingle();
  if (error) throw error;
  return data as StandbyRecord | null;
}

/** Who is on standby now, longest first: for the call centre and the JOC. */
export async function listOnStandby(client: CriticomClient) {
  const { data, error } = await client.from('disaster_standby').select('*')
    .is('ended_at', null).order('started_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as StandbyRecord[];
}

/** File one place's assessment; the same client reference returns the one filed. */
export async function fileDisasterAssessment(
  client: CriticomClient,
  args: { incidentId: string; clientRef: string; fields: Record<string, unknown> },
) {
  const { data, error } = await client.rpc('file_disaster_assessment', {
    p_incident_id: args.incidentId, p_client_ref: args.clientRef, p_fields: args.fields,
  });
  if (error) throw error;
  return data as DisasterAssessment;
}

/** The places assessed on a call (or on several), oldest first. */
export async function listDisasterAssessments(client: CriticomClient, incidentIds: string | string[]) {
  const ids = Array.isArray(incidentIds) ? incidentIds : [incidentIds];
  if (ids.length === 0) return [] as DisasterAssessment[];
  const { data, error } = await client.from('disaster_assessments').select('*')
    .in('incident_id', ids).order('filed_at', { ascending: true }).limit(1000);
  if (error) throw error;
  return (data ?? []) as DisasterAssessment[];
}

/** Relief stock inventory */
export async function listReliefStocks(client: CriticomClient) {
  const { data, error } = await client
    .from('relief_stocks').select('*').order('item_name');
  if (error) throw error;
  return data ?? [];
}
