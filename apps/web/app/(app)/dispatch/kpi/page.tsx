import { getDispatcherKpis } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { getSession, siloFilter } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'KPI Dashboard · Criticom' };

function BarRow({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <li className="flex items-center gap-3 text-sm">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <div className="h-3 flex-1 overflow-hidden rounded bg-muted">
        <div className="h-full rounded bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-10 text-right font-mono">{value}</span>
    </li>
  );
}

export default async function KpiPage() {
  const { supabase, silo } = await getSession();
  const kpi = await getDispatcherKpis(supabase, siloFilter(silo));

  const tiles = [
    { label: 'Active deployments', value: kpi.activeDeployments, accent: 'text-accent' },
    { label: 'Critical alerts today', value: kpi.criticalAlertsToday, accent: 'text-severity-critical' },
    { label: 'Total calls today', value: kpi.totalIncidentsToday, accent: 'text-white' },
    { label: 'Personnel on duty', value: kpi.personnelOnDuty, accent: 'text-severity-low' },
    { label: 'Avg response (min)', value: kpi.avgResponseTime, accent: 'text-severity-medium' },
  ];

  const hourly = kpi.hourlyDistribution ?? [];
  const hourlyMax = Math.max(1, ...hourly);
  const severities = ['Low', 'Medium', 'High', 'Critical'] as const;
  const sevMax = Math.max(1, ...(kpi.priorityData ?? [0]));
  const depts = ['Police', 'Fire', 'Medical', 'Disaster'] as const;
  const deptMax = Math.max(1, ...(kpi.deptData ?? [0]));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Dispatcher KPIs</h1>
        <p className="text-muted-foreground">Operational metrics · refreshed {formatSaTime(new Date())}</p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {tiles.map((t) => (
          <Card key={t.label}>
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{t.label}</p>
              <p className={`mt-2 text-3xl font-bold ${t.accent}`}>{t.value}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Severity mix</CardTitle>
            <CardDescription>Calls by priority.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {severities.map((s, i) => (
                <BarRow key={s} label={s} value={kpi.priorityData?.[i] ?? 0} max={sevMax} />
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>By department</CardTitle>
            <CardDescription>Dispatches per silo.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {depts.map((d, i) => (
                <BarRow key={d} label={d} value={kpi.deptData?.[i] ?? 0} max={deptMax} />
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Hourly distribution</CardTitle>
            <CardDescription>Today's call volume by hour.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex h-32 items-end gap-0.5">
              {Array.from({ length: 24 }, (_, h) => {
                const v = hourly[h] ?? 0;
                return (
                  <div
                    key={h}
                    title={`${String(h).padStart(2, '0')}:00 — ${v} calls`}
                    className="flex-1 rounded-t bg-primary/70"
                    style={{ height: `${Math.max(3, (v / hourlyMax) * 100)}%` }}
                  />
                );
              })}
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
              <span>00:00</span><span>12:00</span><span>23:00</span>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
