import { getDispatcherKpis, listPersonnel, listAuditLogs } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession, siloFilter } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';
import { PerfNav } from './perf-nav';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Performance · HikTech' };

export default async function PerformancePage() {
  const { t } = await requestT();
  const { supabase, silo } = await getSession();
  const [kpi, personnel, recentAudit] = await Promise.all([
    getDispatcherKpis(supabase, siloFilter(silo)),
    listPersonnel(supabase, siloFilter(silo)),
    listAuditLogs(supabase, { silo: siloFilter(silo), limit: 100 }),
  ]);

  // Per-user activity from the audit trail (SystemAnalytics officer-performance proxy)
  const activity = new Map<string, number>();
  for (const log of recentAudit) {
    if (log.user_name) activity.set(log.user_name, (activity.get(log.user_name) ?? 0) + 1);
  }
  const topActive = [...activity.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const onDuty = personnel.filter((p) => p.is_on_duty);

  return (
    <div className="space-y-6">
      <PerfNav active="/performance" />
      <header>
        <h1 className="text-2xl font-bold">{t('Performance & analytics')}</h1>
        <p className="text-muted-foreground">{t('Department stats, response trends and officer activity.')}</p>
      </header>

      <section className="grid gap-3 sm:grid-cols-4">
        <Card><CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">{t('Personnel')}</p>
          <p className="mt-2 text-3xl font-bold">{personnel.length}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">{t('On duty now')}</p>
          <p className="mt-2 text-3xl font-bold text-severity-low-ink">{onDuty.length}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">{t('Calls today')}</p>
          <p className="mt-2 text-3xl font-bold">{kpi.totalIncidentsToday}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">{t('Avg response (min)')}</p>
          <p className="mt-2 text-3xl font-bold text-severity-medium-ink">{kpi.avgResponseTime}</p>
        </CardContent></Card>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('Most active (last 100 audit events)')}</CardTitle>
            <CardDescription>{t('Officer performance proxy until full analytics land.')}</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <SimpleTable headers={['Member', 'Actions']} empty={t('No recorded activity.')}>
              {topActive.map(([name, count]) => (
                <Tr key={name}>
                  <Td>{name}</Td>
                  <Td className="font-mono">{count}</Td>
                </Tr>
              ))}
            </SimpleTable>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('On-duty roster')}</CardTitle>
            <CardDescription>{t('Live from personnel heartbeat.')}</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <SimpleTable headers={['Member', 'Rank', 'Station', 'Last login']} empty={t('Nobody on duty.')}>
              {onDuty.map((p) => (
                <Tr key={p.id}>
                  <Td>{p.first_name} {p.last_name}</Td>
                  <Td>{p.rank}</Td>
                  <Td>{p.station ?? '—'}</Td>
                  <Td className="text-muted-foreground">{formatSaTime(p.last_login)}</Td>
                </Tr>
              ))}
            </SimpleTable>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
