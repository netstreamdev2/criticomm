import Link from 'next/link';
import { listAllIncidents } from '@criticom/api';
import type { IncidentStatus, Silo } from '@criticom/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession, siloFilter } from '@/lib/session';
import { formatSaTime, timeAgo } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Case Manager · HikTech' };

const STATUSES: IncidentStatus[] = [
  'New', 'Pending', 'Pending Dispatch', 'Dispatched', 'En Route', 'Arrived',
  'On Scene', 'Transporting', 'Active', 'Closed', 'Resolved',
];
const SILOS: Silo[] = ['MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster'];
const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'];
const OPEN = new Set(['New', 'Pending', 'Pending Dispatch', 'Dispatched', 'En Route', 'Arrived', 'On Scene', 'Transporting', 'Active']);

const min = (a: string, b: string) => Math.round((new Date(a).getTime() - new Date(b).getTime()) / 60000);

type Search = { q?: string; silo?: string; status?: string; severity?: string; from?: string; to?: string; view?: string };

export default async function CaseManagerPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { supabase, silo } = await getSession();
  const params = await searchParams;
  const view = params.view === 'closed' ? 'closed' : params.view === 'all' ? 'all' : 'open';

  const rows = await listAllIncidents(supabase, {
    silo: (params.silo as Silo) || siloFilter(silo),
    status: params.status as IncidentStatus | undefined,
    search: params.q,
    limit: 1000,
  });

  // Client-side filters (severity, date, view).
  const filtered = rows.filter((r) => {
    if (params.severity && r.incident_severity !== params.severity) return false;
    if (params.from && r.incident_created_at < params.from) return false;
    if (params.to && r.incident_created_at > `${params.to}T23:59:59`) return false;
    if (view === 'open' && !OPEN.has(r.status)) return false;
    if (view === 'closed' && OPEN.has(r.status)) return false;
    return true;
  });

  const openCount = rows.filter((r) => OPEN.has(r.status)).length;
  const closed = rows.filter((r) => !OPEN.has(r.status));
  const today = new Date().toISOString().slice(0, 10);
  const closedToday = closed.filter((r) => r.closed_at?.startsWith(today)).length;
  const resTimes = closed.filter((r) => r.closed_at).map((r) => min(r.closed_at!, r.incident_created_at));
  const avgRes = resTimes.length ? Math.round(resTimes.reduce((a, b) => a + b, 0) / resTimes.length) : 0;

  // Per-department open breakdown.
  const byDept = SILOS.map((s) => ({ silo: s, open: rows.filter((r) => r.silo === s && OPEN.has(r.status)).length }));

  const qs = (patch: Partial<Search>) => {
    const merged = { ...params, ...patch };
    return new URLSearchParams(Object.entries(merged).filter(([, v]) => v) as [string, string][]).toString();
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Case Manager</h1>
        <p className="text-muted-foreground">
          Review, filter and close cases across your departments. Open a case for its full lifecycle, evidence and audit.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card><CardContent className="p-4"><p className="text-xs uppercase text-muted-foreground">Open cases</p><p className="mt-2 text-3xl font-bold text-severity-medium-ink">{openCount}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs uppercase text-muted-foreground">Closed today</p><p className="mt-2 text-3xl font-bold text-severity-low-ink">{closedToday}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs uppercase text-muted-foreground">Closed total</p><p className="mt-2 text-3xl font-bold">{closed.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs uppercase text-muted-foreground">Avg resolution (min)</p><p className="mt-2 text-3xl font-bold text-accent">{avgRes}</p></CardContent></Card>
      </section>

      {/* Per-department open load */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {byDept.map((d) => (
          <Link key={d.silo} href={`/case-manager?${qs({ silo: d.silo, view: 'open' })}`}
            className="rounded-xl border border-border bg-bg-soft p-4 hover:border-accent/50">
            <p className="text-xs uppercase text-muted-foreground">{d.silo}</p>
            <p className="mt-1 text-2xl font-bold">{d.open}<span className="ml-1 text-xs font-normal text-muted-foreground">open</span></p>
          </Link>
        ))}
      </section>

      {/* View toggle */}
      <div className="flex flex-wrap gap-2">
        {(['open', 'closed', 'all'] as const).map((v) => (
          <Link key={v} href={`/case-manager?${qs({ view: v })}`}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold ${view === v ? 'bg-primary/15 text-fg' : 'text-fg/60 hover:bg-muted'}`}>
            {v === 'open' ? 'Open cases' : v === 'closed' ? 'Closed cases' : 'All'}
          </Link>
        ))}
      </div>

      {/* Filters */}
      <form method="get" className="grid gap-3 rounded-lg border border-border bg-bg-card p-4 sm:grid-cols-3 lg:grid-cols-6">
        <input type="hidden" name="view" value={view} />
        <div className="sm:col-span-2">
          <label className="text-xs uppercase text-muted-foreground" htmlFor="q">Search</label>
          <input id="q" name="q" defaultValue={params.q} placeholder="Incident #, caller, address" className="mt-1 block h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm" />
        </div>
        {silo === 'Ethekwini' && (
          <div>
            <label className="text-xs uppercase text-muted-foreground" htmlFor="silo">Department</label>
            <select id="silo" name="silo" defaultValue={params.silo ?? ''} className="mt-1 block h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm">
              <option value="">All</option>
              {SILOS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="text-xs uppercase text-muted-foreground" htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={params.status ?? ''} className="mt-1 block h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm">
            <option value="">Any</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs uppercase text-muted-foreground" htmlFor="severity">Severity</label>
          <select id="severity" name="severity" defaultValue={params.severity ?? ''} className="mt-1 block h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm">
            <option value="">Any</option>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs uppercase text-muted-foreground" htmlFor="from">From</label>
          <input id="from" name="from" type="date" defaultValue={params.from} className="mt-1 block h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm" />
        </div>
        <div>
          <label className="text-xs uppercase text-muted-foreground" htmlFor="to">To</label>
          <input id="to" name="to" type="date" defaultValue={params.to} className="mt-1 block h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm" />
        </div>
        <div className="flex items-end">
          <button type="submit" className="h-10 w-full rounded-md bg-primary text-sm font-semibold">Apply</button>
        </div>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>{filtered.length} cases</CardTitle>
          <CardDescription>
            {view === 'open' ? 'Open cases awaiting resolution.' : view === 'closed' ? 'Closed & resolved cases.' : 'All cases matching filters.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable
            headers={['Incident #', 'Dept', 'Type', 'Severity', 'Status', view === 'closed' ? 'Closed' : 'Age', 'Actions']}
            empty="No cases match your filters."
          >
            {filtered.slice(0, 200).map((i) => (
              <Tr key={i.id}>
                <Td className="font-mono">{i.incident_number}</Td>
                <Td>{i.silo}</Td>
                <Td>{i.incident_type}</Td>
                <Td><span className="severity-pill" data-sev={i.incident_severity}>{i.incident_severity}</span></Td>
                <Td><span className="status-badge" data-status={i.status}>{i.status}</span></Td>
                <Td className="whitespace-nowrap text-muted-foreground">
                  {view === 'closed' ? formatSaTime(i.closed_at) : timeAgo(i.incident_created_at)}
                </Td>
                <Td className="whitespace-nowrap">
                  <Link href={`/incidents/${i.id}`} className="text-accent hover:underline">{OPEN.has(i.status) ? 'Review & close' : 'Open'}</Link>
                  <span className="mx-1 text-muted-foreground">·</span>
                  <Link href={`/case-manager/audit?incident=${i.id}`} className="text-accent hover:underline">Audit</Link>
                  <span className="mx-1 text-muted-foreground">·</span>
                  <a href={`/api/pdf/incident/${i.id}`} className="text-accent hover:underline">PDF</a>
                </Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
