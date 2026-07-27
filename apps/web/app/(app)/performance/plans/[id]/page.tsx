import { notFound } from 'next/navigation';
import { getPlan, getPlanScores, listKpis, cycleLabel } from '@criticom/api';
import { ADMIN_ROLES } from '@criticom/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { getSession, siloFilter } from '@/lib/session';
import { PerfNav } from '../../perf-nav';
import { saveScoreAction, approveStageAction } from '../../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Appraisal Plan · Criticom' };

type Stage = 'MidYear' | 'Final';

export default async function PlanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, role, silo } = await getSession();
  const canManage = ADMIN_ROLES.includes(role) || role === 'Supervisor' || role === 'System';

  const plan = await getPlan(supabase, id).catch(() => null);
  if (!plan) notFound();

  const [scores, kpis] = await Promise.all([
    getPlanScores(supabase, id),
    listKpis(supabase, plan.cycle_year, siloFilter(silo)),
  ]);

  const scoreFor = (kpiId: string, stage: Stage) =>
    scores.find((s) => s.kpi_id === kpiId && s.stage === stage);

  const stageAvg = (stage: Stage) => {
    const ss = scores.filter((s) => s.stage === stage);
    return ss.length ? Math.round((ss.reduce((a, s) => a + s.score, 0) / ss.length) * 10) / 10 : null;
  };

  const renderStage = (stage: Stage) => (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>{stage === 'MidYear' ? 'Mid-year assessment' : 'Final assessment'}</CardTitle>
          <CardDescription>Average {stageAvg(stage) ?? '—'} / 5 across {kpis.length} KPIs.</CardDescription>
        </div>
        {canManage && (
          <form action={approveStageAction}>
            <input type="hidden" name="plan_id" value={plan.id} />
            <input type="hidden" name="stage" value={stage} />
            <button type="submit" className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold">
              Approve {stage === 'MidYear' ? 'mid-year' : 'final'}
            </button>
          </form>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {kpis.length === 0 && <p className="text-sm text-muted-foreground">No KPIs configured for this cycle.</p>}
        {kpis.map((k) => {
          const existing = scoreFor(k.id, stage);
          return (
            <form
              key={k.id}
              action={saveScoreAction}
              className="rounded-md border border-border/60 bg-bg-soft p-3"
            >
              <input type="hidden" name="plan_id" value={plan.id} />
              <input type="hidden" name="kpi_id" value={k.id} />
              <input type="hidden" name="kpi_title" value={k.title} />
              <input type="hidden" name="stage" value={stage} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">{k.title} <span className="text-xs text-muted-foreground">({k.weight}%)</span></p>
                  {k.description && <p className="text-xs text-muted-foreground">{k.description}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <select
                    name="score"
                    defaultValue={existing?.score ?? 3}
                    disabled={!canManage}
                    className="h-9 rounded-md border border-border bg-bg-card px-2 text-sm"
                  >
                    {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                  {existing?.approved && <span className="text-xs text-severity-low">✓ approved</span>}
                </div>
              </div>
              {canManage && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <input
                    name="comments" defaultValue={existing?.comments ?? ''} placeholder="Comments"
                    className="h-9 flex-1 rounded-md border border-border bg-bg-card px-2 text-xs"
                  />
                  <input
                    name="evidence" defaultValue={existing?.evidence ?? ''} placeholder="Evidence / portfolio ref"
                    className="h-9 flex-1 rounded-md border border-border bg-bg-card px-2 text-xs"
                  />
                  <button type="submit" className="h-9 rounded-md bg-primary px-3 text-xs font-semibold">Save</button>
                </div>
              )}
              {!canManage && existing?.comments && (
                <p className="mt-1 text-xs text-muted-foreground">{existing.comments}</p>
              )}
            </form>
          );
        })}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <PerfNav active="/performance/plans" />
      <header>
        <h1 className="text-2xl font-bold">{plan.employee_name ?? 'Member'} — appraisal</h1>
        <p className="text-muted-foreground">
          Cycle {cycleLabel(plan.cycle_year)} · {plan.department ?? plan.silo} · status <strong>{plan.status}</strong>
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        {renderStage('MidYear')}
        {renderStage('Final')}
      </div>
    </div>
  );
}
