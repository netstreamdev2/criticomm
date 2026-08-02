import { getKpiRollup } from '@criticom/api';
import type { Silo } from '@criticom/db';
import { getSession, siloFilter } from '@/lib/session';
import { PerfNav } from '../perf-nav';
import { RollupExplorer } from './rollup-client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'KPI rollup · Criticom' };

const WINDOWS = [7, 30, 90, 365] as const;

export default async function KpiRollupPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; silo?: string }>;
}) {
  const { supabase, silo } = await getSession();
  const params = await searchParams;

  const days = WINDOWS.includes(Number(params.days) as never) ? Number(params.days) : 30;
  const from = new Date(Date.now() - days * 86_400_000).toISOString();

  // Global roles see the organisation; departmental roles are pinned to theirs,
  // so the tree they get is rooted at their own department.
  const scope: Silo | null = (params.silo as Silo) || siloFilter(silo) || null;

  const rollup = await getKpiRollup(supabase, { from, silo: scope });

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">KPI rollup</h1>
        <p className="text-muted-foreground">
          The same response metrics at every level — organisation, department, area and member.
          Drill in; the definitions never change, only the calls they cover.
        </p>
      </header>

      <PerfNav active="/performance/rollup" />

      <RollupExplorer rollup={rollup} days={days} />
    </div>
  );
}
