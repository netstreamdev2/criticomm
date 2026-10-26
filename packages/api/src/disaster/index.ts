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
    .or('silo.eq.EthekwiniDisaster,dispatched_silos.cs.{EthekwiniDisaster},tagged_silos.cs.{EthekwiniDisaster}')
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

/* ── The Disaster desk: call-outs, updates and Criti's notes (0111) ─────── */

export type DisasterCallout = Tables['disaster_callouts']['Row'];
export type DisasterDeskUpdate = Tables['disaster_desk_updates']['Row'];
export type DisasterAiBrief = Tables['disaster_ai_briefs']['Row'];
export type CalloutStatus = DisasterCallout['status'];
type DeskChannel = DisasterCallout['how'];

/** Call a partner out: from the directory (partnerId) or by name. The same clientRef returns the one made. */
export async function callOutPartner(
  client: CriticomClient,
  args: {
    incidentId: string; clientRef: string; how: DeskChannel;
    partnerId?: string | null; officerId?: string | null; agencyName?: string | null; contactNumber?: string | null;
    reason?: string | null; etaMinutes?: number | null; suggestedByAi?: boolean;
  },
) {
  const { data, error } = await client.rpc('disaster_call_out', {
    p_incident_id: args.incidentId, p_client_ref: args.clientRef,
    p_fields: {
      how: args.how, partner_id: args.partnerId ?? null, officer_id: args.officerId ?? null, agency_name: args.agencyName ?? null,
      contact_number: args.contactNumber ?? null, reason: args.reason ?? null,
      eta_minutes: args.etaMinutes ?? null, suggested_by_ai: args.suggestedByAi ?? false,
    },
  });
  if (error) throw error;
  return data as DisasterCallout;
}

/** A partner's progress as they report it; forward only. */
export async function setCalloutStatus(
  client: CriticomClient,
  args: { calloutId: string; status: Exclude<CalloutStatus, 'Called'>; how?: DeskChannel | null; note?: string | null; etaMinutes?: number | null },
) {
  const { data, error } = await client.rpc('set_callout_status', {
    p_callout_id: args.calloutId, p_status: args.status,
    p_fields: { how: args.how ?? null, note: args.note ?? null, eta_minutes: args.etaMinutes ?? null },
  });
  if (error) throw error;
  return data as DisasterCallout;
}

/** Log what came in, how and from whom; the same clientRef returns the one logged. */
export async function logDeskUpdate(
  client: CriticomClient,
  args: { incidentId: string; clientRef: string; source: DeskChannel; text: string; calloutId?: string | null; fromName?: string | null },
) {
  const { data, error } = await client.rpc('log_disaster_update', {
    p_incident_id: args.incidentId, p_client_ref: args.clientRef,
    p_fields: { source: args.source, text: args.text, callout_id: args.calloutId ?? null, from_name: args.fromName ?? null },
  });
  if (error) throw error;
  return data as DisasterDeskUpdate;
}

/** Everything the desk shows for one call, oldest first. Empty until 0111 is run. */
export async function getDeskRecord(client: CriticomClient, incidentId: string) {
  const [callouts, updates, brief] = await Promise.all([
    client.from('disaster_callouts').select('*').eq('incident_id', incidentId).order('called_at'),
    client.from('disaster_desk_updates').select('*').eq('incident_id', incidentId).order('logged_at'),
    client.from('disaster_ai_briefs').select('*').eq('incident_id', incidentId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  return {
    callouts: (callouts.data ?? []) as DisasterCallout[],
    updates: (updates.data ?? []) as DisasterDeskUpdate[],
    brief: (brief.data ?? null) as DisasterAiBrief | null,
    // The desk tables are missing until 0111 is run.
    ready: !callouts.error,
  };
}

/** The call-outs on several calls: for the desk's list of open calls. */
export async function listCallouts(client: CriticomClient, incidentIds: string[]) {
  if (incidentIds.length === 0) return [] as DisasterCallout[];
  const { data, error } = await client.from('disaster_callouts').select('*').in('incident_id', incidentIds).order('called_at');
  if (error) return [] as DisasterCallout[];
  return (data ?? []) as DisasterCallout[];
}

/** The last update on several calls: for the overdue-update warning on the list. */
export async function listLastDeskUpdates(client: CriticomClient, incidentIds: string[]) {
  if (incidentIds.length === 0) return [] as DisasterDeskUpdate[];
  const { data, error } = await client.from('disaster_desk_updates').select('*').in('incident_id', incidentIds)
    .order('logged_at', { ascending: false }).limit(500);
  if (error) return [] as DisasterDeskUpdate[];
  return (data ?? []) as DisasterDeskUpdate[];
}

/** Save Criti's reading of the call (once a minute per reading). */
export async function saveDisasterBrief(
  client: CriticomClient,
  args: { incidentId: string; provider: string | null; readMarker: string; brief: Record<string, unknown> },
) {
  const { data, error } = await client.rpc('save_disaster_ai_brief', {
    p_incident_id: args.incidentId, p_provider: args.provider, p_read_marker: args.readMarker, p_brief: args.brief,
  });
  if (error) throw error;
  return data as DisasterAiBrief;
}

/* ── The Disaster desk, the eThekwini way (0112) ────────────────────────── */

export type DisasterCallFacts = Tables['disaster_call_facts']['Row'];
export type DisasterShelter = Tables['disaster_shelters']['Row'];
export type ShelterOpening = Tables['disaster_shelter_openings']['Row'];
export type ShelterEntry = Tables['disaster_shelter_entries']['Row'];
export type DisasterDuty = Tables['disaster_duty']['Row'];
export type ScgChair = Tables['disaster_scg_chairs']['Row'];
export type MutualAidPartner = Tables['mutual_aid_partners']['Row'];

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
const rpc = async <T>(client: CriticomClient, fn: string, args: Record<string, unknown>) => {
  const { data, error } = await (client.rpc as unknown as Rpc)(fn, args);
  if (error) throw error;
  return data as T;
};

/** The call's title, hazard, municipalities and level; null until first set (or until 0112 is run). */
export async function getCallFacts(client: CriticomClient, incidentId: string): Promise<DisasterCallFacts | null> {
  const { data, error } = await client.from('disaster_call_facts').select('*').eq('incident_id', incidentId).maybeSingle();
  if (error) return null;
  return (data ?? null) as DisasterCallFacts | null;
}

export async function listCallFacts(client: CriticomClient, incidentIds: string[]): Promise<DisasterCallFacts[]> {
  if (incidentIds.length === 0) return [];
  const { data, error } = await client.from('disaster_call_facts').select('*').in('incident_id', incidentIds);
  if (error) return [];
  return (data ?? []) as DisasterCallFacts[];
}

export const setDisasterCall = (client: CriticomClient, incidentId: string, fields: Record<string, unknown>) =>
  rpc<DisasterCallFacts>(client, 'set_disaster_call', { p_incident_id: incidentId, p_fields: fields });

export const setCoordinationLevel = (client: CriticomClient, incidentId: string, level: 'Bronze' | 'Silver' | 'Gold', note?: string | null) =>
  rpc<DisasterCallFacts>(client, 'set_coordination_level', { p_incident_id: incidentId, p_level: level, p_note: note ?? null });

export const saveMutualAidPartner = (client: CriticomClient, id: string | null, fields: Record<string, unknown>) =>
  rpc<MutualAidPartner>(client, 'save_mutual_aid_partner', { p_id: id, p_fields: fields });

/* Shelters and reception centres */

export async function listShelters(client: CriticomClient, includeInactive = false): Promise<DisasterShelter[]> {
  let q = client.from('disaster_shelters').select('*');
  if (!includeInactive) q = q.eq('is_active', true);
  const { data, error } = await q.order('name');
  if (error) return [];
  return (data ?? []) as DisasterShelter[];
}

/** Shelters open now, for every call or for one. */
export async function listOpenShelters(client: CriticomClient, incidentId?: string): Promise<ShelterOpening[]> {
  let q = client.from('disaster_shelter_openings').select('*').is('closed_at', null);
  if (incidentId) q = q.eq('incident_id', incidentId);
  const { data, error } = await q.order('opened_at');
  if (error) return [];
  return (data ?? []) as ShelterOpening[];
}

/** Every shelter opened for a call, open or closed, oldest first. */
export async function listCallShelters(client: CriticomClient, incidentId: string): Promise<ShelterOpening[]> {
  const { data, error } = await client.from('disaster_shelter_openings').select('*').eq('incident_id', incidentId).order('opened_at');
  if (error) return [];
  return (data ?? []) as ShelterOpening[];
}

export async function listShelterEntries(client: CriticomClient, incidentId: string): Promise<ShelterEntry[]> {
  const { data, error } = await client.from('disaster_shelter_entries').select('*').eq('incident_id', incidentId).order('logged_at');
  if (error) return [];
  return (data ?? []) as ShelterEntry[];
}

export const saveShelter = (client: CriticomClient, id: string | null, fields: Record<string, unknown>) =>
  rpc<DisasterShelter>(client, 'save_disaster_shelter', { p_id: id, p_fields: fields });
export const openShelter = (client: CriticomClient, a: { incidentId: string; shelterId: string; clientRef: string; fields: Record<string, unknown> }) =>
  rpc<ShelterOpening>(client, 'open_disaster_shelter', { p_incident_id: a.incidentId, p_shelter_id: a.shelterId, p_client_ref: a.clientRef, p_fields: a.fields });
export const updateShelter = (client: CriticomClient, a: { openingId: string; clientRef: string; fields: Record<string, unknown> }) =>
  rpc<ShelterOpening>(client, 'update_disaster_shelter', { p_opening_id: a.openingId, p_client_ref: a.clientRef, p_fields: a.fields });
export const closeShelter = (client: CriticomClient, openingId: string, note?: string | null) =>
  rpc<ShelterOpening>(client, 'close_disaster_shelter', { p_opening_id: openingId, p_note: note ?? null });

/* Officers, the duty roster and the SCG duty chair */

export type DisasterOfficer = { id: string; name: string; phone: string | null; userId: string | null };

/** Disaster Management's own members, for the roster and call-outs. */
export async function listDisasterOfficers(client: CriticomClient): Promise<DisasterOfficer[]> {
  const { data, error } = await client.from('personnel').select('id, user_id, rank, first_name, last_name, work_cellphone')
    .eq('silo', 'EthekwiniDisaster').order('last_name');
  if (error) return [];
  type Row = { id: string; user_id: string | null; rank: string | null; first_name: string; last_name: string; work_cellphone: string | null };
  return ((data ?? []) as Row[]).map((p) => ({
    id: p.id, userId: p.user_id, phone: p.work_cellphone, name: [p.rank, p.first_name, p.last_name].filter(Boolean).join(' '),
  }));
}

/** Roster entries that end after `from` (default: now), soonest first. */
export async function listDuty(client: CriticomClient, from?: Date): Promise<DisasterDuty[]> {
  const { data, error } = await client.from('disaster_duty').select('*')
    .gt('ends_at', (from ?? new Date()).toISOString()).order('starts_at').limit(300);
  if (error) return [];
  return (data ?? []) as DisasterDuty[];
}

export const saveDuty = (client: CriticomClient, id: string | null, fields: Record<string, unknown>) =>
  rpc<DisasterDuty>(client, 'save_disaster_duty', { p_id: id, p_fields: fields });
export const endDuty = (client: CriticomClient, id: string) => rpc<DisasterDuty>(client, 'end_disaster_duty', { p_id: id });

export async function listScgChairs(client: CriticomClient, year: number): Promise<ScgChair[]> {
  const { data, error } = await client.from('disaster_scg_chairs').select('*').eq('year', year).order('month');
  if (error) return [];
  return (data ?? []) as ScgChair[];
}
export const setScgChair = (client: CriticomClient, a: { year: number; month: number; name: string | null; phone?: string | null }) =>
  rpc<ScgChair>(client, 'set_scg_chair', { p_year: a.year, p_month: a.month, p_name: a.name, p_phone: a.phone ?? null });

/** Every partner, switched-off ones too: for the administrator's list. */
export async function listAllPartners(client: CriticomClient): Promise<MutualAidPartner[]> {
  const { data, error } = await client.from('mutual_aid_partners').select('*').order('agency_name');
  if (error) throw error;
  return (data ?? []) as MutualAidPartner[];
}
