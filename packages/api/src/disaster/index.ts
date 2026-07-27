import type { CriticomClient, Database } from '@criticom/db';

type Tables = Database['public']['Tables'];

/** DisasterController.Monitor — active disaster logs */
export async function listDisasterLogs(client: CriticomClient) {
  const { data, error } = await client
    .from('disaster_logs')
    .select('*')
    .order('dispatch_timestamp', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** DisasterController.DispatchResources POST */
export async function createDisasterLog(
  client: CriticomClient,
  input: Tables['disaster_logs']['Insert'],
) {
  const { data, error } = await client
    .from('disaster_logs').insert(input).select().single();
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
export async function createPostMortem(
  client: CriticomClient,
  input: Tables['post_mortem_reports']['Insert'],
) {
  const { data, error } = await client
    .from('post_mortem_reports').insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function listPostMortems(client: CriticomClient) {
  const { data, error } = await client
    .from('post_mortem_reports')
    .select('*')
    .order('report_filed_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Relief stock inventory */
export async function listReliefStocks(client: CriticomClient) {
  const { data, error } = await client
    .from('relief_stocks').select('*').order('item_name');
  if (error) throw error;
  return data ?? [];
}
