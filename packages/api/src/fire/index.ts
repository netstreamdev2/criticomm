import type { CriticomClient, Database } from '@criticom/db';

type FirefighterReport = Database['public']['Tables']['firefighter_reports']['Row'];
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
