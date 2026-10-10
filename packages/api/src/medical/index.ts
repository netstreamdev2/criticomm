import type { CriticomClient, Database } from '@criticom/db';
import { cleanSearch } from '../cases/stage';

type Tables = Database['public']['Tables'];
type PcrInsert = Tables['paramedic_reports']['Insert'];
type PcrUpdate = Tables['paramedic_reports']['Update'];

export type PcrNestedInput = {
  medical_history?: Tables['medical_histories']['Insert'] | null;
  assessment?: Tables['assessment_findings']['Insert'] | null;
  vitals?: Tables['vital_signs']['Insert'] | null;
  interventions?: Tables['interventions']['Insert'] | null;
};

type Pcr = Tables['paramedic_reports']['Row'];

/**
 * File the patient care report that closes an EMS call (0063). The server
 * checks the crew leads the call and is on scene, files it with its vitals,
 * interventions and history, resolves the incident and tells dispatch.
 * Replaying it returns the report already filed, so the outbox can retry.
 */
export async function filePcr(
  client: CriticomClient,
  args: { incidentId: string; fields: Record<string, string> },
): Promise<Pcr> {
  const { data, error } = await client.rpc('file_pcr', { p_incident_id: args.incidentId, p_fields: args.fields });
  if (error) throw error;
  return data as Pcr;
}

/** The PCR filed against an incident, with its clinical records, if any. */
export async function getPcrForIncident(client: CriticomClient, incidentId: string) {
  const { data, error } = await client
    .from('paramedic_reports')
    .select(`*,
      medical_history:medical_history_id (*),
      vitals:vitals_id (*),
      interventions:interventions_id (*)`)
    .eq('incident_id', incidentId)
    .not('report_number', 'is', null)
    .order('filed_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export type PcrFilters = {
  q?: string | null;
  care?: string | null;
  hospital?: string | null;
  /** YYYY-MM-DD, SA days, on when the report was made. */
  from?: string | null;
  to?: string | null;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** ParamedicsController.Records — the clinical archive, newest first. */
export async function listPcrs(client: CriticomClient, f: PcrFilters = {}, withRef = true): Promise<Pcr[]> {
  let query = client.from('paramedic_reports').select('*');
  const q = cleanSearch(f.q);
  if (q) {
    const cols = ['patient_name', 'chief_complaint', 'destination_hospital', 'paramedic_names', 'incident_location'];
    if (withRef) cols.push('report_number');
    query = query.or(cols.map((c) => `${c}.ilike.*${q}*`).join(','));
  }
  if (f.care && ['BLS', 'ILS', 'ALS'].includes(f.care)) query = query.eq('level_of_care', f.care);
  if (f.hospital) query = query.eq('destination_hospital', f.hospital);
  if (f.from && DAY.test(f.from)) query = query.gte('created_at', new Date(`${f.from}T00:00:00+02:00`).toISOString());
  if (f.to && DAY.test(f.to)) query = query.lt('created_at', new Date(new Date(`${f.to}T00:00:00+02:00`).getTime() + 86_400_000).toISOString());
  const { data, error } = await query.order('created_at', { ascending: false }).limit(500);
  // Before 0063 there is no report number to search.
  if (error?.code === '42703' && withRef) return listPcrs(client, f, false);
  if (error) throw error;
  return data ?? [];
}

/** ParamedicsController.Details — PCR with nested clinical records */
export async function getPcr(client: CriticomClient, id: string) {
  const { data, error } = await client
    .from('paramedic_reports')
    .select(`*,
      medical_history:medical_history_id (*),
      assessment:assessment_id (*),
      vitals:vitals_id (*),
      interventions:interventions_id (*)`)
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

/** ParamedicsController.Create POST — PCR + nested vitals/assessment/history/interventions */
export async function createPcr(
  client: CriticomClient,
  pcr: PcrInsert,
  nested: PcrNestedInput = {},
) {
  const ids: Pick<PcrInsert, 'medical_history_id' | 'assessment_id' | 'vitals_id' | 'interventions_id'> = {};

  if (nested.medical_history) {
    const { data, error } = await client
      .from('medical_histories').insert(nested.medical_history).select('id').single();
    if (error) throw error;
    ids.medical_history_id = data.id;
  }
  if (nested.assessment) {
    const { data, error } = await client
      .from('assessment_findings').insert(nested.assessment).select('id').single();
    if (error) throw error;
    ids.assessment_id = data.id;
  }
  if (nested.vitals) {
    const { data, error } = await client
      .from('vital_signs').insert(nested.vitals).select('id').single();
    if (error) throw error;
    ids.vitals_id = data.id;
  }
  if (nested.interventions) {
    const { data, error } = await client
      .from('interventions').insert(nested.interventions).select('id').single();
    if (error) throw error;
    ids.interventions_id = data.id;
  }

  const { data, error } = await client
    .from('paramedic_reports')
    .insert({ ...pcr, ...ids })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** ParamedicsController.Edit POST — PCRs stay editable until the incident closes */
export async function updatePcr(client: CriticomClient, id: string, patch: PcrUpdate) {
  const { data, error } = await client
    .from('paramedic_reports')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Corrections to a PCR's vitals, interventions and history, in their own records. */
export async function updatePcrNested(
  client: CriticomClient,
  ids: { vitals_id: string | null; interventions_id: string | null; medical_history_id: string | null },
  nested: PcrNestedInput,
) {
  const jobs: Array<PromiseLike<{ error: { message: string } | null }>> = [];
  if (ids.vitals_id && nested.vitals) jobs.push(client.from('vital_signs').update(nested.vitals).eq('id', ids.vitals_id));
  if (ids.interventions_id && nested.interventions) jobs.push(client.from('interventions').update(nested.interventions).eq('id', ids.interventions_id));
  if (ids.medical_history_id && nested.medical_history) jobs.push(client.from('medical_histories').update(nested.medical_history).eq('id', ids.medical_history_id));
  for (const res of await Promise.all(jobs)) if (res.error) throw res.error;
}

export type HandoverFilters = { q?: string | null; hospital?: string | null; from?: string | null; to?: string | null };

/**
 * Hospital handovers (0064), newest first, with the report each came with.
 * They are written from the patient care report, never directly.
 */
export async function listHandovers(client: CriticomClient, f: HandoverFilters = {}) {
  let query = client
    .from('legal_handovers')
    .select('*, pcr:pcr_id (id, report_number, patient_name, chief_complaint, level_of_care, paramedic_names, incident_id)')
    .not('pcr_id', 'is', null);
  const q = cleanSearch(f.q);
  if (q) query = query.or(['doctor_name', 'receiving_hosp', 'patient_status_at_handover'].map((c) => `${c}.ilike.*${q}*`).join(','));
  if (f.hospital) query = query.eq('receiving_hosp', f.hospital);
  if (f.from && DAY.test(f.from)) query = query.gte('time_of_handover', new Date(`${f.from}T00:00:00+02:00`).toISOString());
  if (f.to && DAY.test(f.to)) query = query.lt('time_of_handover', new Date(new Date(`${f.to}T00:00:00+02:00`).getTime() + 86_400_000).toISOString());
  const { data, error } = await query.order('time_of_handover', { ascending: false }).limit(300);
  if (error) throw error;
  return (data ?? []) as Array<Tables['legal_handovers']['Row'] & {
    pcr: Pick<Pcr, 'id' | 'report_number' | 'patient_name' | 'chief_complaint' | 'level_of_care' | 'paramedic_names' | 'incident_id'> | null;
  }>;
}

/** ShiftController.InventoryCheck (medical branch) — ambulance restock log */
export async function listRestocks(client: CriticomClient) {
  const { data, error } = await client
    .from('ambulance_restocks')
    .select('*, unit:unit_id (unit_number, name)')
    .order('restock_date', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function addRestock(
  client: CriticomClient,
  input: Tables['ambulance_restocks']['Insert'],
) {
  const { data, error } = await client
    .from('ambulance_restocks').insert(input).select().single();
  if (error) throw error;
  return data;
}
