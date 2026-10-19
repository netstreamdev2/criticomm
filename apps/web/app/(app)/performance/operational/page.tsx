import { getOperationalKpis } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';
import { PerfNav, cycleWindow } from '../perf-nav';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Operational KPIs · HikTech' };

export default async function OperationalKpiPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; dept?: string; region?: string }>;
}) {
  const { t } = await requestT();
  const { supabase } = await getSession();
  const params = await searchParams;
  const { from, to } = cycleWindow(params.from, params.to);

  const kpi = await getOperationalKpis(supabase, {
    from, to, department: params.dept, region: params.region,
  });

  const exportHref = `/api/performance/operational.csv?from=${from}&to=${to}` +
    `&dept=${params.dept ?? 'All'}&region=${params.region ?? 'All'}`;

  const tiles = [
    { label: 'Total calls', value: kpi.totals.totalCalls },
    { label: 'Dispatched', value: `${kpi.totals.dispatched} (${kpi.totals.dispatchRate}%)` },
    { label: 'Closed', value: `${kpi.totals.closed} (${kpi.totals.closureRate}%)` },
    { label: 'Still open', value: kpi.totals.stillOpen },
    { label: 'Avg dispatch', value: `${kpi.totals.avgDispatchMinutes}m` },
    { label: 'Avg resolution', value: `${kpi.totals.avgResolutionMinutes}m` },
  ];

  return (
    <div className="space-y-6">
      <PerfNav active="/performance/operational" />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('Operational KPI console')}</h1>
          <p className="text-muted-foreground">
            {t('Control-room throughput: call takers, dispatchers, category volume and raw call detail.')}</p>
        </div>
        <a href={exportHref} className="rounded-md border border-border px-4 py-2 text-sm font-semibold hover:bg-muted">
          {t('⬇ Export CSV')}</a>
      </header>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs uppercase text-muted-foreground" htmlFor="from">{t('From')}</label>
          <input id="from" name="from" type="date" defaultValue={from} className="mt-1 block h-10 rounded-md border border-border bg-bg-soft px-3 text-sm" />
        </div>
        <div>
          <label className="text-xs uppercase text-muted-foreground" htmlFor="to">{t('To')}</label>
          <input id="to" name="to" type="date" defaultValue={to} className="mt-1 block h-10 rounded-md border border-border bg-bg-soft px-3 text-sm" />
        </div>
        <div>
          <label className="text-xs uppercase text-muted-foreground" htmlFor="dept">{t('Department')}</label>
          <select id="dept" name="dept" defaultValue={params.dept ?? 'All'} className="mt-1 block h-10 rounded-md border border-border bg-bg-soft px-3 text-sm">
            <option value="All">{t('All')}</option>
            {kpi.departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs uppercase text-muted-foreground" htmlFor="region">{t('Region')}</label>
          <select id="region" name="region" defaultValue={params.region ?? 'All'} className="mt-1 block h-10 rounded-md border border-border bg-bg-soft px-3 text-sm">
            <option value="All">{t('All')}</option>
            {kpi.regions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <button type="submit" className="h-10 rounded-md bg-primary px-4 text-sm font-semibold">{t('Apply')}</button>
      </form>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <Card key={t.label}>
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{t.label}</p>
              <p className="mt-2 text-2xl font-bold">{t.value}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('Call takers ({length})', { length: kpi.callTakers.length })}</CardTitle>
            <CardDescription>{t('Operator throughput for the period.')}</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <SimpleTable headers={['Operator', 'Calls', 'Disp.', 'Closed', 'Avg disp (m)', 'Top category']} empty={t('No call-taker activity.')}>
              {kpi.callTakers.map((o) => (
                <Tr key={o.operator}>
                  <Td className="font-semibold">{o.operator}</Td>
                  <Td className="font-mono">{o.total}</Td>
                  <Td className="font-mono">{o.dispatched}</Td>
                  <Td className="font-mono">{o.closed}</Td>
                  <Td className="font-mono">{o.avgDispatchMinutes}</Td>
                  <Td>{o.topCategory}</Td>
                </Tr>
              ))}
            </SimpleTable>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('Dispatchers ({length})', { length: kpi.dispatchers.length })}</CardTitle>
            <CardDescription>{t('Units dispatched per operator.')}</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <SimpleTable headers={['Operator', 'Dispatched', 'Closed', 'Avg disp (m)', 'Avg res (m)']} empty={t('No dispatcher activity.')}>
              {kpi.dispatchers.map((o) => (
                <Tr key={o.operator}>
                  <Td className="font-semibold">{o.operator}</Td>
                  <Td className="font-mono">{o.dispatched}</Td>
                  <Td className="font-mono">{o.closed}</Td>
                  <Td className="font-mono">{o.avgDispatchMinutes}</Td>
                  <Td className="font-mono">{o.avgResolutionMinutes}</Td>
                </Tr>
              ))}
            </SimpleTable>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('Category pivot')}</CardTitle>
          <CardDescription>{t('Category × sub-category × region volume.')}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['Category', 'Sub-category', 'Region', 'Total']} empty={t('No incidents in range.')}>
            {kpi.categoryPivot.slice(0, 60).map((r, i) => (
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

      <Card>
        <CardHeader>
          <CardTitle>{t('Call detail ({length} of {callDetailTotal})', { length: kpi.callDetail.length, callDetailTotal: kpi.callDetailTotal })}</CardTitle>
          <CardDescription>{t('Most recent calls. Full set via CSV export.')}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['Incident #', 'Date', 'Category', 'Type', 'Region', 'Operator', 'Dispatcher', 'Status']} empty={t('No calls in range.')}>
            {kpi.callDetail.map((r) => (
              <Tr key={r.incidentNumber}>
                <Td className="font-mono">{r.incidentNumber}</Td>
                <Td className="text-muted-foreground">{formatSaTime(r.incidentDate)}</Td>
                <Td>{r.category}</Td>
                <Td>{r.subCategory}</Td>
                <Td>{r.region}</Td>
                <Td>{r.operator}</Td>
                <Td>{r.dispatcher}</Td>
                <Td>{r.status}</Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('Logons ({length})', { length: kpi.logons.length })}</CardTitle>
          <CardDescription>{t('User Logon report from the audit trail.')}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['When', 'User', 'Department']} empty={t('No logons recorded.')}>
            {kpi.logons.slice(0, 40).map((l, i) => (
              <Tr key={i}>
                <Td className="text-muted-foreground">{formatSaTime(l.logDate)}</Td>
                <Td>{l.userName}</Td>
                <Td>{l.department}</Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
