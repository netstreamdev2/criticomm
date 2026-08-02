import { redirect } from 'next/navigation';
import { type ChartSpec, type ReportDefinition, datasetsForRole, getReport, listReports } from '@criticom/api';
import { getSession } from '@/lib/session';
import { ReportBuilder } from './builder-client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Report builder · Criticom' };

export default async function ReportBuilderPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; dataset?: string }>;
}) {
  const { supabase, role, userId } = await getSession();
  const params = await searchParams;

  // The catalogue is filtered to what this role may query, so the builder can
  // never offer a data source the engine would then refuse.
  const datasets = datasetsForRole(role);
  if (datasets.length === 0) redirect('/403');

  const saved = await listReports(supabase).catch(() => []);

  const existing = params.id ? await getReport(supabase, params.id).catch(() => null) : null;

  const requestedKey = existing?.dataset ?? params.dataset;
  const startDataset =
    (requestedKey ? datasets.find((d) => d.key === requestedKey) : undefined) ?? datasets[0]!;

  const initial: ReportDefinition = existing?.spec?.dataset
    ? existing.spec
    : {
        dataset: startDataset.key,
        columns: [...startDataset.defaultColumns],
        filters: [],
        groupBy: [],
        metrics: [],
        sort: { ...startDataset.defaultSort },
        limit: 1000,
      };

  const initialChart: ChartSpec = existing?.chartSpec ?? { type: 'none' };

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Report builder</h1>
        <p className="text-muted-foreground">
          Build a report from any data source, save it, and share it with your department.
        </p>
      </header>

      <ReportBuilder
        datasets={datasets}
        saved={saved.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          dataset: s.dataset,
          visibility: s.visibility,
          created_by_name: s.created_by_name,
          mine: s.created_by === userId,
        }))}
        initial={initial}
        initialChart={initialChart}
        initialMeta={{
          id: existing?.id,
          name: existing?.name ?? '',
          description: existing?.description ?? '',
          visibility: existing?.visibility ?? 'private',
        }}
      />
    </div>
  );
}
