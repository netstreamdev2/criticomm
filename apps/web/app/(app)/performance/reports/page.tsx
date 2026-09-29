import Link from 'next/link';
import { Download } from 'lucide-react';
import { getHrAnalytics } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { PerfNav } from '../perf-nav';
import { getSession, siloFilter } from '@/lib/session';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Performance Reports · HikTech' };

const fmtMins = (m: number | null) =>
  m === null ? '—' : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;

/** Proportional bar used inside table cells — reads at a glance. */
function Bar({ value, max, tone = 'bg-accent' }: { value: number; max: number; tone?: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
        <span className={cn('block h-full rounded-full', tone)} style={{ width: `${max > 0 ? Math.round((value / max) * 100) : 0}%` }} />
      </span>
      <span className="font-mono text-xs">{value}</span>
    </span>
  );
}

export default async function PerformanceReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { supabase, silo } = await getSession();
  const sf = siloFilter(silo);

  const sp = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const defaultFrom = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? '') ? sp.from! : defaultFrom;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? '') ? sp.to! : today;

  const report = await getHrAnalytics(supabase, { from, to, silo: sf });
  const csv = (kind: string) => `/api/hr/report.csv?kind=${kind}&from=${from}&to=${to}`;

  const maxMember = Math.max(1, ...report.members.map((r) => r.callsTaken + r.dispatches + r.responded));
  const maxDept = Math.max(1, ...report.departments.map((r) => r.total));
  const maxType = Math.max(1, ...report.incidentTypes.map((r) => r.total));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Performance reports</h1>
        <p className="text-muted-foreground">
          The same window cut three ways — by member, by department, by incident type.
        </p>
      </header>

      <PerfNav active="/performance/reports" />

      {/* ── Range picker (plain GET form — no client JS needed) ── */}
      <form className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-bg-card p-4">
        <div>
          <label htmlFor="from" className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">From</label>
          <input id="from" name="from" type="date" defaultValue={from} max={to}
            className="h-10 rounded-lg border border-border bg-bg-soft px-3 text-sm focus:border-accent focus:outline-none" />
        </div>
        <div>
          <label htmlFor="to" className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-muted-foreground">To</label>
          <input id="to" name="to" type="date" defaultValue={to} max={today}
            className="h-10 rounded-lg border border-border bg-bg-soft px-3 text-sm focus:border-accent focus:outline-none" />
        </div>
        <button type="submit" className="h-10 rounded-lg bg-primary px-5 text-sm font-semibold">Run</button>
        <p className="ml-auto text-xs text-muted-foreground">
          {from} → {to}{sf ? ` · ${sf}` : ' · all departments'}
        </p>
      </form>

      {/* ── By member ── */}
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>By member</CardTitle>
            <CardDescription>
              Attribution from the incident log: calls taken, dispatches made, responses run.
            </CardDescription>
          </div>
          <Link href={csv('member')} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted">
            <Download className="h-3.5 w-3.5" /> CSV
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable
            headers={['Member', 'Calls taken', 'Dispatches', 'Responded', 'Closed', 'Avg close', 'Leave days']}
            empty="No attributed activity in this window."
          >
            {report.members.slice(0, 25).map((r) => (
              <Tr key={r.name}>
                <Td className="font-semibold">{r.name}</Td>
                <Td><Bar value={r.callsTaken} max={maxMember} /></Td>
                <Td><Bar value={r.dispatches} max={maxMember} tone="bg-severity-medium" /></Td>
                <Td><Bar value={r.responded} max={maxMember} tone="bg-severity-low" /></Td>
                <Td className="font-mono">{r.closed}</Td>
                <Td className="font-mono">{fmtMins(r.avgCloseMins)}</Td>
                <Td className="font-mono">{r.leaveDays || '—'}</Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>

      {/* ── By department ── */}
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>By department</CardTitle>
            <CardDescription>Volume, closure, staffing and leave burden side by side.</CardDescription>
          </div>
          <Link href={csv('department')} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted">
            <Download className="h-3.5 w-3.5" /> CSV
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable
            headers={['Department', 'Incidents', 'Closed', 'Closure', 'Critical', 'Avg close', 'Headcount', 'On duty', 'Leave days']}
            empty="No incidents in this window."
          >
            {report.departments.map((r) => (
              <Tr key={r.silo}>
                <Td className="font-semibold">{r.silo}</Td>
                <Td><Bar value={r.total} max={maxDept} /></Td>
                <Td className="font-mono">{r.closed}</Td>
                <Td>
                  <span className={cn('font-mono', r.closureRate >= 80 ? 'text-severity-low-ink' : r.closureRate >= 50 ? 'text-severity-medium-ink' : 'text-severity-critical-ink')}>
                    {r.closureRate}%
                  </span>
                </Td>
                <Td className="font-mono text-severity-critical-ink">{r.critical}</Td>
                <Td className="font-mono">{fmtMins(r.avgCloseMins)}</Td>
                <Td className="font-mono">{r.headcount}</Td>
                <Td className="font-mono text-severity-low-ink">{r.onDutyNow}</Td>
                <Td className="font-mono">{r.leaveDaysApproved || '—'}</Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>

      {/* ── By incident type ── */}
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>By incident type</CardTitle>
            <CardDescription>What the city is actually calling about, and how it resolves.</CardDescription>
          </div>
          <Link href={csv('incident')} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted">
            <Download className="h-3.5 w-3.5" /> CSV
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable
            headers={['Type', 'Total', 'Low', 'Med', 'High', 'Critical', 'Closed', 'Avg close']}
            empty="No incidents in this window."
          >
            {report.incidentTypes.map((r) => (
              <Tr key={r.type}>
                <Td className="max-w-[260px] truncate font-semibold">{r.type}</Td>
                <Td><Bar value={r.total} max={maxType} /></Td>
                <Td className="font-mono">{r.low}</Td>
                <Td className="font-mono text-severity-medium-ink">{r.medium}</Td>
                <Td className="font-mono text-severity-high-ink">{r.high}</Td>
                <Td className="font-mono text-severity-critical-ink">{r.critical}</Td>
                <Td className="font-mono">{r.closed}</Td>
                <Td className="font-mono">{fmtMins(r.avgCloseMins)}</Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
