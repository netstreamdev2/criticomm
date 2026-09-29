import { listAllIncidents, getDispatcherKpis } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleBarChart, MultiBarChart, SeverityDonut } from '@/components/charts';
import { getSession, siloFilter } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Analytics · HikTech' };

export default async function AnalyticsPage() {
  const { supabase, silo } = await getSession();
  const [incidents, kpi] = await Promise.all([
    listAllIncidents(supabase, { silo: siloFilter(silo), limit: 1000 }),
    getDispatcherKpis(supabase, siloFilter(silo)),
  ]);

  // By type (top 8)
  const byType = new Map<string, number>();
  for (const i of incidents) byType.set(i.incident_type, (byType.get(i.incident_type) ?? 0) + 1);
  const typeData = [...byType.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([type, count]) => ({ type, count }));

  // By month (last 6) split open/closed
  const months: Array<{ month: string; opened: number; closed: number }> = [];
  const now = new Date();
  for (let m = 5; m >= 0; m--) {
    const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const key = d.toISOString().slice(0, 7);
    const label = d.toLocaleString('en-ZA', { month: 'short' });
    months.push({
      month: label,
      opened: incidents.filter((i) => i.incident_created_at.startsWith(key)).length,
      closed: incidents.filter((i) => i.closed_at?.startsWith(key)).length,
    });
  }

  // By silo
  const bySilo = new Map<string, number>();
  for (const i of incidents) bySilo.set(i.silo, (bySilo.get(i.silo) ?? 0) + 1);
  const siloData = [...bySilo.entries()].map(([name, count]) => ({ name, count }));

  const severityData = (['Low', 'Medium', 'High', 'Critical'] as const).map((name) => ({
    name, value: incidents.filter((i) => i.incident_severity === name).length,
  }));

  const closedCount = incidents.filter((i) => i.status === 'Closed' || i.status === 'Resolved').length;
  const closureRate = incidents.length > 0 ? Math.round((closedCount / incidents.length) * 100) : 0;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">System analytics</h1>
        <p className="text-muted-foreground">
          Department statistics and response trends across the last {incidents.length} incidents.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card><CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Total incidents</p>
          <p className="mt-2 text-3xl font-bold">{incidents.length}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Closure rate</p>
          <p className="mt-2 text-3xl font-bold text-severity-low-ink">{closureRate}%</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Avg response (min)</p>
          <p className="mt-2 text-3xl font-bold text-severity-medium-ink">{kpi.avgResponseTime}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">On duty now</p>
          <p className="mt-2 text-3xl font-bold text-accent">{kpi.personnelOnDuty}</p>
        </CardContent></Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Monthly trend</CardTitle>
            <CardDescription>Opened vs closed over the last 6 months.</CardDescription>
          </CardHeader>
          <CardContent>
            <MultiBarChart
              data={months} xKey="month"
              series={[
                { key: 'opened', label: 'Opened', color: '#38bdf8' },
                { key: 'closed', label: 'Closed', color: '#22c55e' },
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Severity distribution</CardTitle>
            <CardDescription>All incidents in scope.</CardDescription>
          </CardHeader>
          <CardContent>
            <SeverityDonut data={severityData} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top incident types</CardTitle>
            <CardDescription>Most frequent call categories.</CardDescription>
          </CardHeader>
          <CardContent>
            <SimpleBarChart data={typeData} xKey="type" yKey="count" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>By department</CardTitle>
            <CardDescription>Incident ownership per silo.</CardDescription>
          </CardHeader>
          <CardContent>
            <SimpleBarChart data={siloData} xKey="name" yKey="count" color="#a78bfa" />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
