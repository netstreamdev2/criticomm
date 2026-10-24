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

/**
 * FireChiefController.GetAllHydrants. The register holds the city's whole
 * water register (about 34,000, scripts/load-hydrants.mjs --from-gis) and the
 * database returns 1,000 rows at most: a map reads listHydrantsInArea, a
 * count reads countHydrants.
 */
export async function listHydrants(client: CriticomClient) {
  const { data, error } = await client
    .from('hydrants')
    .select('*')
    .order('location_name');
  if (error) throw error;
  return data ?? [];
}

export type MapArea = { south: number; west: number; north: number; east: number };

/** The hydrants inside a map area, up to `limit`, read 1,000 at a time. */
export async function listHydrantsInArea(client: CriticomClient, area: MapArea, limit = 3000) {
  const rows: Database['public']['Tables']['hydrants']['Row'][] = [];
  for (let from = 0; from < limit; from += 1000) {
    const { data, error } = await client
      .from('hydrants')
      .select('*')
      .gte('latitude', area.south).lte('latitude', area.north)
      .gte('longitude', area.west).lte('longitude', area.east)
      .order('id')
      .range(from, Math.min(from + 999, limit - 1));
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return rows;
}

/** How many hydrants the register holds, and how many are in service, counted by the database. */
export async function countHydrants(client: CriticomClient) {
  const [all, operational] = await Promise.all([
    client.from('hydrants').select('id', { count: 'exact', head: true }),
    client.from('hydrants').select('id', { count: 'exact', head: true }).eq('status', 'Operational'),
  ]);
  if (all.error) throw all.error;
  if (operational.error) throw operational.error;
  return { total: all.count ?? 0, operational: operational.count ?? 0 };
}

/**
 * The hydrants the fire service has to act on or has looked at: those not in
 * service, then the latest inspected. The rest of the register is on the map.
 */
export async function listHydrantsToWatch(client: CriticomClient, limit = 200) {
  const [down, inspected] = await Promise.all([
    client.from('hydrants').select('*').neq('status', 'Operational').order('location_name').limit(limit),
    client.from('hydrants').select('*').eq('status', 'Operational').not('last_inspected', 'is', null)
      .order('last_inspected', { ascending: false }).limit(limit),
  ]);
  if (down.error) throw down.error;
  if (inspected.error) throw inspected.error;
  return { down: down.data ?? [], inspected: inspected.data ?? [] };
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

export type FireSiteInspection = Database['public']['Tables']['fire_safety_inspections']['Row'];
export type FirePremises = Database['public']['Tables']['fire_premises']['Row'];

/** Fire safety inspections (0066, 0106), newest first; by outcome, or PASS/FAIL for the older ones. */
export async function listFireInspections(
  client: CriticomClient,
  f: { q?: string | null; result?: string | null; outcome?: string | null; inspector?: string | null; limit?: number } = {},
) {
  let query = client.from('fire_safety_inspections').select('*');
  const q = cleanSearch(f.q);
  if (q) query = query.or(['business_name', 'address', 'contact_person', 'inspection_ref'].map((c) => `${c}.ilike.*${q}*`).join(','));
  if (f.result === 'PASS' || f.result === 'FAIL') query = query.eq('result', f.result);
  if (f.outcome === 'Compliant' || f.outcome === 'Compliance notice' || f.outcome === 'Instruction') query = query.eq('outcome', f.outcome);
  if (f.inspector) query = query.eq('inspector_id', f.inspector);
  const { data, error } = await query.order('inspected_at', { ascending: false }).limit(f.limit ?? 300);
  if (error) throw error;
  return (data ?? []) as FireSiteInspection[];
}

export async function getFireInspection(client: CriticomClient, id: string) {
  const { data, error } = await client.from('fire_safety_inspections').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data as FireSiteInspection | null;
}

/**
 * File a site inspection (0106). The server checks every answer against its
 * own checklist, numbers it, writes the notice and the dates, and keeps the
 * premises register; the same client reference returns the inspection filed.
 */
export async function fileFireInspection(client: CriticomClient, args: { clientRef: string; fields: Record<string, unknown> }) {
  const { data, error } = await client.rpc('file_fire_inspection', { p_client_ref: args.clientRef, p_fields: args.fields });
  if (error) throw error;
  return data as FireSiteInspection;
}

/** The premises register: due first (never inspected, then by date), then by name. */
export async function listFirePremises(client: CriticomClient, f: { q?: string | null; dueBy?: string | null; limit?: number } = {}) {
  let query = client.from('fire_premises').select('*');
  const q = cleanSearch(f.q);
  if (q) query = query.or(['name', 'address', 'contact_person'].map((c) => `${c}.ilike.*${q}*`).join(','));
  if (f.dueBy) query = query.or(`next_due.is.null,next_due.lte.${f.dueBy}`);
  const { data, error } = await query
    .order('next_due', { ascending: true, nullsFirst: true })
    .order('name', { ascending: true })
    .limit(f.limit ?? 500);
  if (error) throw error;
  return (data ?? []) as FirePremises[];
}

export async function getFirePremises(client: CriticomClient, id: string) {
  const { data, error } = await client.from('fire_premises').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data as FirePremises | null;
}

/** A premises' visits, newest first. */
export async function listPremisesInspections(client: CriticomClient, premisesId: string) {
  const { data, error } = await client.from('fire_safety_inspections').select('*')
    .eq('premises_id', premisesId).order('inspected_at', { ascending: false }).limit(50);
  if (error) throw error;
  return (data ?? []) as FireSiteInspection[];
}

/** Fire command adds a site to the register, or changes its use, risk or contact (0106). */
export async function saveFirePremises(client: CriticomClient, args: { id?: string | null; fields: Record<string, unknown> }) {
  const { data, error } = await client.rpc('save_fire_premises', { p_id: args.id ?? null, p_fields: args.fields });
  if (error) throw error;
  return data as FirePremises;
}
