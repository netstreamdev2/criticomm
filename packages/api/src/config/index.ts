import type { CriticomClient, Database } from '@criticom/db';

type CommandRecord = Database['public']['Tables']['command_records']['Row'];

export const CONFIG_MODULES = ['IncidentCategory', 'LeaveType', 'ShiftType', 'ReportTemplate'] as const;
export type ConfigModule = (typeof CONFIG_MODULES)[number];

/** AdminConfigController.Index — all records for a module (incl. inactive). */
export async function listConfigRecords(
  client: CriticomClient,
  module: ConfigModule,
): Promise<CommandRecord[]> {
  const { data, error } = await client
    .from('command_records')
    .select('*')
    .eq('module', module)
    .order('detail1', { ascending: true, nullsFirst: true })
    .order('name', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** AdminConfigController.List — active entries only, for capture-form dropdowns. */
export async function listActiveConfig(
  client: CriticomClient,
  module: ConfigModule,
): Promise<CommandRecord[]> {
  const { data, error } = await client
    .from('command_records')
    .select('*')
    .eq('module', module)
    .eq('status', 'Active')
    .order('detail1', { ascending: true, nullsFirst: true })
    .order('name', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Incident category groups + their sub-categories, ready for a cascading picker. */
export async function getIncidentCategoryTree(client: CriticomClient) {
  const rows = await listActiveConfig(client, 'IncidentCategory');
  const groups = rows.filter((r) => !r.detail1);
  return groups.map((g) => ({
    id: g.id,
    code: g.code,
    name: g.name ?? '',
    subcategories: rows
      .filter((r) => r.detail1 === g.name)
      .map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name ?? '',
        // detail2 = newline-separated extra form prompts
        prompts: (s.detail2 ?? '').split('\n').map((p) => p.trim()).filter(Boolean),
      })),
  }));
}

/** AdminConfigController.Add */
export async function addConfigRecord(
  client: CriticomClient,
  args: { module: ConfigModule; name: string; code?: string | null; parent?: string | null; prompts?: string | null; createdBy?: string },
) {
  const { data, error } = await client
    .from('command_records')
    .insert({
      module: args.module,
      name: args.name.trim(),
      code: args.code?.trim() || null,
      detail1: args.parent?.trim() || null,
      detail2: args.prompts?.trim() || null,
      status: 'Active',
      created_by: args.createdBy ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** AdminConfigController.SetStatus — soft toggle Active/Inactive. */
export async function toggleConfigStatus(client: CriticomClient, id: string) {
  const { data: current, error: readErr } = await client
    .from('command_records').select('status').eq('id', id).single();
  if (readErr) throw readErr;
  const next = current.status === 'Active' ? 'Inactive' : 'Active';
  const { data, error } = await client
    .from('command_records').update({ status: next }).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

/** Saved report templates for a user (ReportTemplate module). */
export async function listReportTemplates(client: CriticomClient, userId: string) {
  const { data, error } = await client
    .from('command_records')
    .select('*')
    .eq('module', 'ReportTemplate')
    .eq('detail1', userId)
    .eq('status', 'Active')
    .order('name');
  if (error) throw error;
  return data ?? [];
}

/** ReportHubController.SaveTemplate — persist a filter payload as a named template. */
export async function saveReportTemplate(
  client: CriticomClient,
  args: { userId: string; name: string; payload: unknown; createdBy?: string },
) {
  const { data, error } = await client
    .from('command_records')
    .insert({
      module: 'ReportTemplate',
      name: args.name.trim(),
      detail1: args.userId,
      detail2: JSON.stringify(args.payload),
      status: 'Active',
      created_by: args.createdBy ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}
