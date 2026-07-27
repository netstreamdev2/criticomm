import { getMyPerformance } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { SimpleBarChart } from '@/components/charts';
import { getSession } from '@/lib/session';
import { PerfNav, cycleWindow } from '../perf-nav';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My Performance · Criticom' };

export default async function MyPerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { supabase, userId, silo, fullName } = await getSession();
  const params = await searchParams;
  const { from, to } = cycleWindow(params.from, params.to);

  const perf = await getMyPerformance(supabase, { from, to, displayName: fullName, userId, silo });

  const tiles = [
    { label: 'Calls taken', value: perf.asCallTaker.total, sub: `team avg ${perf.teamAvgCallsTaken}` },
    { label: 'Dispatched', value: perf.asDispatcher.dispatched, sub: `${perf.asDispatcher.avgDispatchMinutes}m avg` },
    { label: 'Attended', value: perf.asResponder.total, sub: `${perf.asResponder.closed} closed` },
    { label: 'Volume rank', value: `#${perf.rankByVolume}`, sub: `of ${perf.teamSize}` },
  ];

  const trendData = perf.monthlyTrend.map((m) => ({ month: m.label.slice(5), count: m.count }));

  return (
    <div className="space-y-6">
      <PerfNav active="/performance/mine" />
      <header>
        <h1 className="text-2xl font-bold">My performance</h1>
        <p className="text-muted-foreground">
          Your operational throughput vs the team, plus your annual appraisal ({perf.cycleLabel}).
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label}>
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{t.label}</p>
              <p className="mt-2 text-3xl font-bold">{t.value}</p>
              <p className="text-xs text-muted-foreground">{t.sub}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Monthly call volume</CardTitle>
            <CardDescription>Calls you took, by month.</CardDescription>
          </CardHeader>
          <CardContent>
            {trendData.length > 0 ? (
              <SimpleBarChart data={trendData} xKey="month" yKey="count" />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">No call activity recorded in range.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>My category breakdown</CardTitle>
            <CardDescription>What you handled most.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <SimpleTable headers={['Category', 'Sub-category', 'Region', 'Total']} empty="No activity.">
              {perf.myCategoryBreakdown.slice(0, 12).map((r, i) => (
                <Tr key={i}>
                  <Td>{r.category}</Td>
                  <Td>{r.subCategory}</Td>
                  <Td>{r.region}</Td>
                  <Td className="font-mono">{r.total}</Td>
                </Tr>
              ))}
            </SimpleTable>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Annual appraisal — {perf.cycleLabel}</CardTitle>
          <CardDescription>
            {perf.hasPlan
              ? `Plan status: ${perf.planStatus}. Mid-year avg ${perf.midYearAverage ?? '—'}, final avg ${perf.finalAverage ?? '—'} (out of 5).`
              : 'No appraisal plan has been created for you this cycle yet.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['KPI', 'Mid-year', 'Final', 'Approved']} empty="No appraisal scores yet.">
            {perf.appraisal.map((a, i) => (
              <Tr key={i}>
                <Td className="font-semibold">{a.kpiTitle}</Td>
                <Td className="font-mono">{a.midYearScore ?? '—'}</Td>
                <Td className="font-mono">{a.finalScore ?? '—'}</Td>
                <Td>{a.approved ? <span className="text-severity-low">Yes</span> : 'Pending'}</Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
