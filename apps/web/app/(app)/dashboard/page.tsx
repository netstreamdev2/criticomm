import Link from 'next/link';
import { getDispatcherKpis, listActiveIncidents, getMyPerformance } from '@criticom/api';
import { DISPATCH_ROLES, RESPONDER_ROLES, ADMIN_ROLES } from '@criticom/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { HourlyAreaChart, SeverityDonut } from '@/components/charts';
import { getSession, siloFilter } from '@/lib/session';
import { timeAgo } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboard · Criticom' };

export default async function DashboardPage() {
  const { supabase, silo, role, fullName, userId } = await getSession();

  const isFieldRole = RESPONDER_ROLES.includes(role);
  const now = new Date();
  const cycleStart = now.getMonth() >= 6
    ? new Date(now.getFullYear(), 6, 1)
    : new Date(now.getFullYear() - 1, 6, 1);

  const [kpi, active, myPerf] = await Promise.all([
    getDispatcherKpis(supabase, siloFilter(silo)),
    listActiveIncidents(supabase, siloFilter(silo)),
    isFieldRole
      ? getMyPerformance(supabase, {
          from: cycleStart.toISOString().slice(0, 10),
          to: new Date(now.getTime() + 86400000).toISOString().slice(0, 10),
          displayName: fullName, userId, silo,
        }).catch(() => null)
      : Promise.resolve(null),
  ]);

  const tiles = [
    { label: 'Active deployments', value: kpi.activeDeployments, accent: 'text-accent' },
    { label: 'Critical alerts today', value: kpi.criticalAlertsToday, accent: 'text-severity-critical' },
    { label: 'Total calls today', value: kpi.totalIncidentsToday, accent: 'text-white' },
    { label: 'Personnel on duty', value: kpi.personnelOnDuty, accent: 'text-severity-low' },
    { label: 'Avg response (min)', value: kpi.avgResponseTime, accent: 'text-severity-medium' },
  ];

  const hourlyData = Array.from({ length: 24 }, (_, h) => ({
    hour: `${String(h).padStart(2, '0')}:00`,
    calls: kpi.hourlyDistribution?.[h] ?? 0,
  }));
  const severityData = (['Low', 'Medium', 'High', 'Critical'] as const).map((name, i) => ({
    name, value: kpi.priorityData?.[i] ?? 0,
  }));

  // Role-aware quick actions (mirrors each V4 role's landing workflow)
  const actions: Array<{ href: string; label: string }> = [];
  if (DISPATCH_ROLES.includes(role)) {
    actions.push(
      { href: '/dispatch/log-call', label: '📞 Log incoming call' },
      { href: '/dispatch/pending', label: '🗂 Pending queue' },
      { href: '/incidents/map', label: '🗺 Live map' },
    );
  }
  if (RESPONDER_ROLES.includes(role)) {
    actions.push(
      { href: '/responder', label: '🚨 My incidents' },
      { href: '/shift/mental-check', label: '✅ Start of shift' },
    );
  }
  if (ADMIN_ROLES.includes(role)) {
    actions.push({ href: '/admin', label: '⚙️ Administration' });
  }
  if (actions.length === 0) {
    actions.push({ href: '/incidents', label: '📋 Browse incidents' });
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Command Centre</h1>
          <p className="text-muted-foreground">Welcome back, {fullName.split(' ')[0]}. Live operations overview.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className="rounded-md border border-border bg-bg-soft px-3 py-2 text-sm font-semibold hover:bg-muted"
            >
              {a.label}
            </Link>
          ))}
        </div>
      </header>

      {myPerf && (
        <Card className="border-primary/30 bg-gradient-to-br from-primary/10 to-transparent">
          <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Officer portal · {myPerf.cycleLabel}</p>
              <p className="mt-1 text-lg font-bold">{fullName}</p>
              <p className="text-sm text-muted-foreground">
                Volume rank #{myPerf.rankByVolume} of {myPerf.teamSize} ·{' '}
                appraisal {myPerf.hasPlan ? myPerf.planStatus : 'not started'}
              </p>
            </div>
            <div className="flex gap-6 text-center">
              <div><p className="text-2xl font-bold text-accent">{myPerf.asResponder.total}</p><p className="text-xs text-muted-foreground">Attended</p></div>
              <div><p className="text-2xl font-bold">{myPerf.asResponder.closed}</p><p className="text-xs text-muted-foreground">Closed</p></div>
              <div><p className="text-2xl font-bold text-severity-medium">{myPerf.finalAverage ?? myPerf.midYearAverage ?? '—'}</p><p className="text-xs text-muted-foreground">Appraisal /5</p></div>
            </div>
            <Link href="/performance/mine" className="rounded-md border border-border bg-bg-soft px-4 py-2 text-sm font-semibold hover:bg-muted">
              My performance →
            </Link>
          </CardContent>
        </Card>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
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
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Call volume — today</CardTitle>
            <CardDescription>Hourly distribution across visible silos.</CardDescription>
          </CardHeader>
          <CardContent>
            <HourlyAreaChart data={hourlyData} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Severity mix</CardTitle>
            <CardDescription>All calls by priority.</CardDescription>
          </CardHeader>
          <CardContent>
            <SeverityDonut data={severityData} />
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Active incidents ({active.length})</CardTitle>
          <CardDescription>
            Everything currently dispatched, en route, on scene, or transporting. Updates in realtime.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable
            headers={['Incident', 'Type', 'Severity', 'Status', 'Location', 'Logged', '']}
            empty="No active incidents."
          >
            {active.slice(0, 12).map((i) => (
              <Tr key={i.id}>
                <Td className="font-mono">{i.incident_number}</Td>
                <Td>{i.incident_type}</Td>
                <Td><span className="severity-pill" data-sev={i.incident_severity}>{i.incident_severity}</span></Td>
                <Td><span className="status-badge" data-status={i.status}>{i.status}</span></Td>
                <Td className="max-w-[260px] truncate">{i.location_address}</Td>
                <Td className="text-muted-foreground">{timeAgo(i.incident_created_at)}</Td>
                <Td><Link href={`/incidents/${i.id}`} className="text-accent hover:underline">Open</Link></Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
