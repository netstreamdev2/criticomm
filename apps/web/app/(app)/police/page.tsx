import Link from 'next/link';
import { Search } from 'lucide-react';
import { getReportType, listPoliceReports, POLICE_REPORT_FORMS } from '@criticom/api';
import { canAccess } from '@criticom/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession } from '@/lib/session';
import { chatTime } from '@/lib/when';
import { CritiTiles } from '@/components/criti/insight-tiles';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Police Operations · HikTech' };

type Params = { q?: string; kind?: string; form?: string; from?: string; to?: string };

const OPERATIONS: Array<[string, string]> = [
  ['/police/reports/incident', 'Incident reports'], ['/police/reports', 'Police reports'],
  ['/police/fines', 'Fines'], ['/police/armoury', 'Armoury'], ['/police/firearm-checks', 'Firearm checks'],
  ['/police/firearms', 'Issue register'], ['/police/bodycams', 'Bodycams'], ['/police/security', 'Security'],
  ['/police/crime-hotspots', 'Crime hotspots'], ['/police/warrants', 'Warrants'], ['/police/summons', 'Summons'],
  ['/police/charges', 'Charges'], ['/police/transactions', 'Transactions'],
];

const field = 'h-9 rounded-md border border-border bg-bg-soft px-2.5 text-sm';

export default async function PolicePage({ searchParams }: { searchParams: Promise<Params> }) {
  const { supabase, role, silo } = await getSession();
  const params = await searchParams;
  const kind = params.kind === 'incident' || params.kind === 'police' ? params.kind : 'all';
  const filters = { q: params.q, form: params.form, from: params.from, to: params.to };
  const [incidentReports, policeReports, bookedOut] = await Promise.all([
    kind === 'police' ? Promise.resolve([]) : listPoliceReports(supabase, { kind: 'incident', ...filters }),
    kind === 'incident' ? Promise.resolve([]) : listPoliceReports(supabase, { kind: 'police', ...filters }),
    supabase.from('firearms').select('id', { count: 'exact', head: true }).eq('status', 'Issued'),
  ]);
  const recent = [...incidentReports, ...policeReports]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 25);
  const filtered = Boolean(params.q || params.form || params.from || params.to || kind !== 'all');
  const now = new Date();

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Police operations</h1>
        <p className="text-muted-foreground">Reports, fines, armoury and records.</p>
      </header>

      {/* Criti: what needs attention now, for this person. */}
      <CritiTiles />

      <section className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Incident reports{filtered ? ' (filtered)' : ''}</p>
          <Link href="/police/reports/incident" className="mt-2 block text-3xl font-bold hover:underline">{incidentReports.length}</Link>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Police reports{filtered ? ' (filtered)' : ''}</p>
          <Link href="/police/reports" className="mt-2 block text-3xl font-bold hover:underline">{policeReports.length}</Link>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Firearms booked out</p>
          <Link href="/police/armoury?status=Issued" className="mt-2 block text-3xl font-bold text-severity-medium-ink hover:underline">{bookedOut.count ?? 0}</Link>
        </CardContent></Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>New police report</CardTitle>
          <CardDescription>Choose a form to start; more can be added on the report.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {POLICE_REPORT_FORMS.map((f) => (
            <Link
              key={f.id}
              href={`/police/reports/new?forms=${f.id}`}
              className="rounded-md border border-border bg-bg-soft px-3 py-2.5 hover:bg-muted"
            >
              <span className="block font-mono text-[11px] text-accent">{f.code}</span>
              <span className="block text-sm font-semibold">{f.label}</span>
            </Link>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Police operations</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {OPERATIONS.filter(([href]) => canAccess(href, role, silo)).map(([href, label]) => (
            <Link key={href} href={href} className="rounded-full border border-border bg-bg-soft px-3 py-1.5 text-sm hover:bg-muted">{label}</Link>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Recent reports</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-0">
          <form method="get" className="flex flex-wrap items-end gap-2 px-4">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input name="q" defaultValue={params.q} placeholder="Search case #, location, officer, suspect"
                aria-label="Search reports" className={`${field} w-full pl-8`} />
            </div>
            <select name="kind" defaultValue={kind} aria-label="Kind" className={field}>
              <option value="all">All reports</option>
              <option value="incident">Incident reports</option>
              <option value="police">Police reports</option>
            </select>
            <select name="form" defaultValue={params.form ?? ''} aria-label="Form" className={field}>
              <option value="">All forms</option>
              {POLICE_REPORT_FORMS.map((f) => <option key={f.id} value={f.id}>{f.code} · {f.label}</option>)}
            </select>
            <label className="flex flex-col text-xs text-muted-foreground">
              From
              <input type="date" name="from" defaultValue={params.from} className={field} />
            </label>
            <label className="flex flex-col text-xs text-muted-foreground">
              To
              <input type="date" name="to" defaultValue={params.to} className={field} />
            </label>
            <button type="submit" className="h-9 rounded-md bg-accent px-4 text-sm font-semibold">Apply</button>
            {filtered ? <Link href="/police" className="self-center text-sm text-accent hover:underline">Clear</Link> : null}
          </form>
          <SimpleTable headers={['Case #', 'Kind', 'Forms', 'Officer', 'Location', 'Filed', '']} empty={filtered ? 'No reports match these filters.' : 'No reports yet.'}>
            {recent.map((r) => {
              const type = r.report_type ? getReportType(r.report_type) : null;
              return (
                <Tr key={r.id}>
                  <Td className="font-mono">{r.case_number}</Td>
                  <Td>{r.incident_id ? 'Incident' : 'Police'}</Td>
                  <Td>{type?.forms?.length ? type.forms.map((f) => f.code).join(' · ') : (type?.label ?? r.incident_category ?? '—')}</Td>
                  <Td>{r.officer_name ?? '—'}</Td>
                  <Td className="max-w-[220px] truncate">{r.location ?? '—'}</Td>
                  <Td className="whitespace-nowrap text-muted-foreground">{chatTime(r.filed_at ?? r.created_at, now)}</Td>
                  <Td><Link href={`/police/reports/${r.id}`} className="text-accent hover:underline">Open</Link></Td>
                </Tr>
              );
            })}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
