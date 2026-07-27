import type { CriticomClient, Database } from '@criticom/db';

type Tables = Database['public']['Tables'];
type PcrInsert = Tables['paramedic_reports']['Insert'];
type PcrUpdate = Tables['paramedic_reports']['Update'];

export type PcrNestedInput = {
  medical_history?: Tables['medical_histories']['Insert'] | null;
  assessment?: Tables['assessment_findings']['Insert'] | null;
  vitals?: Tables['vital_signs']['Insert'] | null;
  interventions?: Tables['interventions']['Insert'] | null;
};

/** ParamedicsController.Index — list Patient Care Reports */
export async function listPcrs(client: CriticomClient) {
  const { data, error } = await client
    .from('paramedic_reports')
    .select('*')
    .order('created_at', { ascending: false });
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

/** LegalHandover — signature capture at the hospital */
export async function createLegalHandover(
  client: CriticomClient,
  input: Tables['legal_handovers']['Insert'],
) {
  const { data, error } = await client
    .from('legal_handovers').insert(input).select().single();
  if (error) throw error;
  return data;
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
