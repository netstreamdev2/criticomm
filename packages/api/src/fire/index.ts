import type { CriticomClient, Database } from '@criticom/db';
import { cleanSearch } from '../cases/stage';

export type FirefighterReport = Database['public']['Tables']['firefighter_reports']['Row'];
type FirefighterReportInsert = Database['public']['Tables']['firefighter_reports']['Insert'];
type PirInsert = Database['public']['Tables']['public_incident_reports']['Insert'];

/** FirefightersController.Index — list all fire reports */
export async function listFirefighterReports(client: CriticomClient): Promise<FirefighterReport[]> {
  const { data, error } = await client
    .from('firefighter_reports')
    .select('*')
    .order('date_of_incident', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** FirefightersController.Details */
export async function getFirefighterReport(client: CriticomClient, id: string) {
  const { data, error } = await client
    .from('firefighter_reports')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

/** FirefightersController.Create POST — the 50+ field fire incident report */
export async function createFirefighterReport(
  client: CriticomClient,
  input: FirefighterReportInsert,
) {
  const { data, error } = await client
    .from('firefighter_reports')
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * File the fire incident report from the field (migration 0059). The server
 * checks the firefighter leads the incident and is on scene, files the report,
 * resolves the incident and tells dispatch. Replaying it returns the report
 * already filed, so the phone's outbox can retry it safely.
 */
export async function fileFireReport(
  client: CriticomClient,
  args: { incidentId: string; fields: Record<string, string> },
): Promise<FirefighterReport> {
  const { data, error } = await client.rpc('file_fire_report', { p_incident_id: args.incidentId, p_fields: args.fields });
  if (error) throw error;
  return data as FirefighterReport;
}

/** The fire report filed against an incident, if any. */
export async function getFireReportForIncident(client: CriticomClient, incidentId: string): Promise<FirefighterReport | null> {
  const { data, error } = await client
    .from('firefighter_reports').select('*').eq('incident_id', incidentId)
    .order('report_submission_date').limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

/** FireChiefController.GetAllHydrants */
export async function listHydrants(client: CriticomClient) {
  const { data, error } = await client
    .from('hydrants')
    .select('*')
    .order('location_name');
  if (error) throw error;
  return data ?? [];
}

/** PIRController.Index — published public incident reports */
export async function listPublicIncidentReports(client: CriticomClient) {
  const { data, error } = await client
    .from('public_incident_reports')
    .select('*')
    .order('published_date', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** PIRController.Publish — Chief sanitises a raw fire report into a PIR */
export async function publishPublicIncidentReport(client: CriticomClient, input: PirInsert) {
  const { data, error } = await client
    .from('public_incident_reports')
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data;
}

type FireInspection = Database['public']['Tables']['fire_safety_inspections']['Row'];
export type FireSafetyInspectionInput = Pick<FireInspection, 'business_name' | 'address' | 'contact_person' | 'extinguishers' | 'exits' | 'notes' | 'result'>;

/** Fire safety inspections (0066), newest first. */
export async function listFireInspections(client: CriticomClient, f: { q?: string | null; result?: string | null } = {}) {
  let query = client.from('fire_safety_inspections').select('*');
  const q = cleanSearch(f.q);
  if (q) query = query.or(['business_name', 'address', 'contact_person', 'inspection_ref'].map((c) => `${c}.ilike.*${q}*`).join(','));
  if (f.result === 'PASS' || f.result === 'FAIL') query = query.eq('result', f.result);
  const { data, error } = await query.order('inspected_at', { ascending: false }).limit(300);
  if (error) throw error;
  return (data ?? []) as FireInspection[];
}

/** File a fire safety inspection; the server stamps, numbers and checks it. */
export async function createFireInspection(client: CriticomClient, input: FireSafetyInspectionInput) {
  const { data, error } = await client.from('fire_safety_inspections').insert(input).select().single();
  if (error) throw error;
  return data as FireInspection;
}
