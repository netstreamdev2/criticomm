import type { CriticomClient, Database, Silo } from '@criticom/db';
import type { ReportDefinition } from './query.ts';
import { getDataset } from './registry.ts';

export type ReportRow = Database['public']['Tables']['report_definitions']['Row'];
export type ReportVisibility = ReportRow['visibility'];

export type ChartSpec = {
  type: 'none' | 'bar' | 'line' | 'donut';
  /** Column key for the category axis — a grouping field or a plain column. */
  xField?: string;
  /** Column key for the value axis — usually a metric key like `count__*`. */
  yField?: string;
};

export type SavedReport = ReportRow & {
  spec: ReportDefinition;
  chartSpec: ChartSpec;
};

function hydrate(row: ReportRow): SavedReport {
  const spec = (row.definition ?? {}) as unknown as ReportDefinition;
  return {
    ...row,
    spec: { ...spec, dataset: row.dataset },
    chartSpec: ((row.chart ?? { type: 'none' }) as unknown) as ChartSpec,
  };
}

/**
 * Reports the caller can see: their own, plus anything shared to their
 * department or globally. RLS enforces this too — the filter here is so the
 * list is ordered and shaped, not so it is safe.
 */
export async function listReports(supabase: CriticomClient): Promise<SavedReport[]> {
  const { data, error } = await supabase
    .from('report_definitions')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []).map(hydrate);
}

export async function getReport(supabase: CriticomClient, id: string): Promise<SavedReport | null> {
  const { data, error } = await supabase
    .from('report_definitions')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? hydrate(data) : null;
}

export async function createReport(
  supabase: CriticomClient,
  input: {
    name: string;
    description?: string | null;
    silo: Silo;
    spec: ReportDefinition;
    chart?: ChartSpec;
    visibility: ReportVisibility;
    userId: string;
    userName: string | null;
  },
): Promise<SavedReport> {
  if (!getDataset(input.spec.dataset)) throw new Error(`Unknown dataset: ${input.spec.dataset}`);

  const { data, error } = await supabase
    .from('report_definitions')
    .insert({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      silo: input.silo,
      dataset: input.spec.dataset,
      definition: input.spec as unknown as Record<string, unknown>,
      chart: (input.chart ?? { type: 'none' }) as unknown as Record<string, unknown>,
      visibility: input.visibility,
      created_by: input.userId,
      created_by_name: input.userName,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return hydrate(data);
}

export async function updateReport(
  supabase: CriticomClient,
  id: string,
  patch: {
    name?: string;
    description?: string | null;
    spec?: ReportDefinition;
    chart?: ChartSpec;
    visibility?: ReportVisibility;
  },
): Promise<SavedReport> {
  const body: Database['public']['Tables']['report_definitions']['Update'] = {};
  if (patch.name !== undefined) body.name = patch.name.trim();
  if (patch.description !== undefined) body.description = patch.description?.trim() || null;
  if (patch.visibility !== undefined) body.visibility = patch.visibility;
  if (patch.spec) {
    if (!getDataset(patch.spec.dataset)) throw new Error(`Unknown dataset: ${patch.spec.dataset}`);
    body.definition = patch.spec as unknown as Record<string, unknown>;
    body.dataset = patch.spec.dataset;
  }
  if (patch.chart) body.chart = patch.chart as unknown as Record<string, unknown>;

  const { data, error } = await supabase
    .from('report_definitions')
    .update(body)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return hydrate(data);
}

export async function deleteReport(supabase: CriticomClient, id: string): Promise<void> {
  const { error } = await supabase.from('report_definitions').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** CSV for a result set. Quotes every field so embedded commas and newlines survive. */
export function toCsv(
  columns: Array<{ key: string; label: string }>,
  rows: Array<Record<string, unknown>>,
): string {
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    // A leading =, +, - or @ makes a spreadsheet treat the cell as a formula.
    // Incident data is attacker-influenced (caller names, descriptions), so
    // neutralise it rather than hand someone a CSV that executes on open.
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const head = columns.map((c) => esc(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => esc(r[c.key])).join(',')).join('\n');
  return `${head}\n${body}`;
}
