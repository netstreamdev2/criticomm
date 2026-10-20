import type { CriticomClient, Database } from '@criticom/db';
import { cleanSearch } from '../cases/stage';
import { REPORT_RECORD_COLUMNS, toReportRecord, type ReportRecord, type PoliceReportRow } from './report-stats';

type MetroReport = Database['public']['Tables']['metro_reports']['Row'];
type MetroReportInsert = Database['public']['Tables']['metro_reports']['Insert'];
type FirearmAuth = Database['public']['Tables']['firearm_authorizations']['Row'];

/** MetroController.Records — list all metro (police) reports */
export async function listMetroReports(client: CriticomClient): Promise<MetroReport[]> {
  const { data, error } = await client
    .from('metro_reports')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/**
 * Police records, filtered. Incident reports are the ones an officer filed on
 * a dispatched call (they carry the incident); police reports are filed from
 * the console without one.
 */
export type PoliceReportFilters = {
  kind: 'incident' | 'police';
  q?: string | null;
  /** A DMPS form id ("arrest", "tow"…): reports that include it. */
  form?: string | null;
  /** YYYY-MM-DD, on the day of the offence. */
  from?: string | null;
  to?: string | null;
  officer?: string | null;
  arrest?: 'Yes' | 'No' | null;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const FORM_ID = /^[a-z]+$/;

export async function listPoliceReports(client: CriticomClient, f: PoliceReportFilters): Promise<MetroReport[]> {
  let query = client.from('metro_reports').select('*');
  query = f.kind === 'incident' ? query.not('incident_id', 'is', null) : query.is('incident_id', null);
  const q = cleanSearch(f.q);
  if (q) {
    query = query.or(['case_number', 'incident_category', 'officer_name', 'location', 'suspect_name', 'offender_name', 'charges']
      .map((c) => `${c}.ilike.*${q}*`).join(','));
  }
  // report_type is "arrest+tow": match the form id as a whole part.
  if (f.form && FORM_ID.test(f.form)) {
    query = query.or(`report_type.eq.${f.form},report_type.like.${f.form}+*,report_type.like.*+${f.form},report_type.like.*+${f.form}+*`);
  }
  if (f.from && DAY.test(f.from)) query = query.gte('date_of_offense', f.from);
  if (f.to && DAY.test(f.to)) query = query.lte('date_of_offense', f.to);
  const officer = cleanSearch(f.officer);
  if (officer) query = query.ilike('officer_name', `%${officer}%`);
  if (f.arrest === 'Yes') query = query.eq('arrest_made', 'Yes');
  else if (f.arrest === 'No') query = query.or('arrest_made.is.null,arrest_made.neq.Yes');
  const { data, error } = await query.order('created_at', { ascending: false }).limit(500);
  if (error) throw error;
  return data ?? [];
}

/** MetroController.Details */
export async function getMetroReport(client: CriticomClient, id: string) {
  const { data, error } = await client
    .from('metro_reports')
    .select('*, offenses:metro_offenses (*)')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

/** MetroController.Create / Wizard(type) POST — report + itemized offenses */
export async function createMetroReport(
  client: CriticomClient,
  report: MetroReportInsert,
  offenses: Array<{ offense_type: string; fine_amount: number }> = [],
) {
  const { data, error } = await client
    .from('metro_reports')
    .insert(report)
    .select()
    .single();
  if (error) throw error;
  if (offenses.length > 0) {
    const { error: offErr } = await client
      .from('metro_offenses')
      .insert(offenses.map((o) => ({ ...o, metro_id: data.id })));
    if (offErr) throw offErr;
  }
  return data;
}

/** MetroController.ArmoryRecords */
export async function listFirearmAuthorizations(client: CriticomClient): Promise<FirearmAuth[]> {
  const { data, error } = await client
    .from('firearm_authorizations')
    .select('*')
    .order('from_date', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export type FirearmIssueInput = {
  employee_name: string;
  id_number: string;
  firearm_number: string;
  company_number?: string | null;
  form_number?: string | null;
  make?: string | null;
  rounds: number;
  from: string;
  to: string;
  posted_location?: string | null;
  chamber_status?: string | null;
  notes?: string | null;
};

/**
 * MetroController.FirearmChecklist POST — issue a firearm, through
 * issue_firearm_authorization() only (0089): Metro Police command and the
 * system administrators; the issuer is whoever is signed in; audited.
 */
export async function createFirearmAuthorization(client: CriticomClient, input: FirearmIssueInput): Promise<FirearmAuth> {
  const { data, error } = await client.rpc('issue_firearm_authorization', { p: input });
  if (error) throw error;
  return data as FirearmAuth;
}

/** MetroController firearm return — once per issue, through return_firearm_authorization() (0089); audited. */
export async function returnFirearm(
  client: CriticomClient,
  args: { id: string; rounds_returned: number; condition?: string | null },
): Promise<FirearmAuth> {
  const { data, error } = await client.rpc('return_firearm_authorization', {
    p_id: args.id, p_rounds_returned: args.rounds_returned, p_condition: args.condition ?? null,
  });
  if (error) throw error;
  return data as FirearmAuth;
}

/** SecuritiesController — private security guard incident reports */
export async function listSecurityReports(client: CriticomClient) {
  const { data, error } = await client
    .from('security_reports')
    .select('*')
    .order('incident_start_time', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** SecuritiesController.Create */
export async function createSecurityReport(
  client: CriticomClient,
  input: Database['public']['Tables']['security_reports']['Insert'],
) {
  const { data, error } = await client
    .from('security_reports').insert(input).select().single();
  if (error) throw error;
  return data;
}

/** SecuritiesController resolve action */
export async function resolveSecurityReport(
  client: CriticomClient,
  args: { id: string; resolution_summary?: string | null },
) {
  const { data, error } = await client
    .from('security_reports')
    .update({
      is_incident_resolved: true,
      resolution_time: new Date().toISOString(),
      resolution_summary: args.resolution_summary ?? null,
    })
    .eq('id', args.id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** CrimeController.GetHotspots */
export async function listCrimeStats(client: CriticomClient, year?: string) {
  let q = client.from('crime_stats').select('*');
  if (year) q = q.eq('year', year);
  const { data, error } = await q.limit(500);
  if (error) throw error;
  return data ?? [];
}

/**
 * The live map's crime-zone layer: one district's police stations for the
 * latest financial year loaded. The SAPS dataset spells districts in lower
 * case ("ethekwini"), so the match ignores case.
 */
export async function listCrimeZones(client: CriticomClient, district = 'ethekwini') {
  const latest = await client
    .from('crime_stats')
    .select('year')
    .ilike('district_municipality', district)
    .order('year', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest.error) throw latest.error;
  if (!latest.data) return { year: null, stations: [] };

  const { data, error } = await client
    .from('crime_stats')
    .select('id, station_name, latitude, longitude, murder, carjacking, burglary_residential, robbery_residential, drug_crime, dui')
    .ilike('district_municipality', district)
    .eq('year', latest.data.year)
    .not('latitude', 'is', null)
    .not('longitude', 'is', null);
  if (error) throw error;
  return { year: latest.data.year, stations: data ?? [] };
}
export * from './report-types';

export * from './report-stats';

/**
 * Police reports for the reporting pages (Reports → Management, Records,
 * Recent activity, Specialised report), newest first, each with its call.
 * Read with the person's own session: the database's rules decide which
 * reports they see (0002, 0039, 0081).
 */
export async function listPoliceReportRecords(
  client: CriticomClient,
  opts: { since?: string | null; limit?: number } = {},
): Promise<ReportRecord[]> {
  let q = client.from('metro_reports').select(REPORT_RECORD_COLUMNS);
  if (opts.since) q = q.gte('created_at', opts.since);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(Math.min(opts.limit ?? 2000, 5000));
  if (error) throw error;
  return ((data ?? []) as unknown as PoliceReportRow[]).map(toReportRecord);
}
