import type { CriticomClient, Database } from '@criticom/db';

type MetroReport = Database['public']['Tables']['metro_reports']['Row'];
type MetroReportInsert = Database['public']['Tables']['metro_reports']['Insert'];
type FirearmAuth = Database['public']['Tables']['firearm_authorizations']['Row'];
type FirearmAuthInsert = Database['public']['Tables']['firearm_authorizations']['Insert'];

/** MetroController.Records — list all metro (police) reports */
export async function listMetroReports(client: CriticomClient): Promise<MetroReport[]> {
  const { data, error } = await client
    .from('metro_reports')
    .select('*')
    .order('created_at', { ascending: false });
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

/** MetroController.FirearmChecklist POST — issue a firearm */
export async function createFirearmAuthorization(
  client: CriticomClient,
  input: FirearmAuthInsert,
) {
  const { data, error } = await client
    .from('firearm_authorizations')
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** MetroController firearm return — record rounds returned + condition */
export async function returnFirearm(
  client: CriticomClient,
  args: { id: string; rounds_returned: number; received_by: string; condition?: string | null },
) {
  const { data, error } = await client
    .from('firearm_authorizations')
    .update({
      rounds_returned: args.rounds_returned,
      received_by: args.received_by,
      condition: args.condition ?? null,
      date_received: new Date().toISOString(),
    })
    .eq('id', args.id)
    .select()
    .single();
  if (error) throw error;
  return data;
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
