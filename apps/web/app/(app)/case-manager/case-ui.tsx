import Link from 'next/link';
import {
  CASE_DEPARTMENTS, CASE_SEVERITIES, DEPARTMENT_LABELS, departmentsOf, formatElapsed, getReportType, listCases,
  minutesBetween, resolvedAtOf, type CaseReportRef, type CaseRow, type CaseView,
} from '@criticom/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SimpleTable, Td, Tr } from '@/components/simple-table';
import { IncidentLive } from '@/components/incident-live';
import { getSession } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';

export type CaseSearch = { q?: string; department?: string; severity?: string; from?: string; to?: string };

/** "Metro Police", or "Metro Police, EMS" for a call sent to both. */
export function departmentLabel(row: Pick<CaseRow, 'silo' | 'dispatched_silos'>) {
  return departmentsOf(row).map((d) => DEPARTMENT_LABELS[d] ?? d).join(', ');
}

/** The report that resolved a case, in a line. */
export function reportLabel(report: CaseReportRef | null) {
  if (!report) return null;
  return report.kind === 'police'
    ? getReportType(report.label).label
    : `Fire report ${report.label ?? ''}`.trim();
}

/** Who has the call: the leading officer, else whoever it was assigned to. */
export function officerOf(row: CaseRow) {
  return row.responding_officer ?? row.assigned_to_name ?? (row.dispatch_time ? 'Sent to all on duty' : 'Not dispatched');
}

export function SeverityPill({ severity }: { severity: string }) {
  return <span className="severity-pill" data-sev={severity}>{severity}</span>;
}

export function CaseLink({ row, review = false }: { row: Pick<CaseRow, 'id' | 'incident_number'>; review?: boolean }) {
  return (
    <Link href={`/incidents/${row.id}${review ? '#case-review' : ''}`} className="font-mono font-semibold text-accent hover:underline">
      {row.incident_number}
    </Link>
  );
}

/** How a closed case ended. */
export function OutcomeChip({ row }: { row: CaseRow }) {
  if (row.close_kind === 'Cancelled') {
    return <span className="rounded-full border border-severity-critical/40 bg-severity-critical/10 px-2 py-0.5 text-xs font-semibold text-severity-critical-ink">Closed without report</span>;
  }
  if (row.close_kind === 'Reviewed') {
    return <span className="rounded-full border border-severity-low/40 bg-severity-low/10 px-2 py-0.5 text-xs font-semibold text-severity-low-ink">Reviewed</span>;
  }
  return <span className="rounded-full border border-border bg-bg-soft px-2 py-0.5 text-xs font-semibold text-muted-foreground">Closed</span>;
}

const VIEW_COPY: Record<Exclude<CaseView, 'all'>, { empty: string; order: string }> = {
  review: { empty: 'Nothing waiting. Every filed report has been reviewed.', order: 'Longest waiting first.' },
  live: { empty: 'No live calls.', order: 'Oldest call first.' },
  closed: { empty: 'No closed cases match.', order: 'Most recently closed first.' },
};

/**
 * One case register: the filters, then the table. Filters live in the URL so
 * a register can be bookmarked or sent to a colleague.
 */
export async function CaseRegister({
  view, title, description, params, basePath,
}: {
  view: Exclude<CaseView, 'all'>;
  title: string;
  description: string;
  params: CaseSearch;
  basePath: string;
}) {
  const { supabase, silo } = await getSession();
  const { rows, truncated } = await listCases(supabase, { view, ...params });
  const filtered = Boolean(params.q || params.department || params.severity || params.from || params.to);
  const field = 'mt-1 block h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm';
  const label = 'text-xs uppercase text-muted-foreground';
  const now = new Date().toISOString();

  return (
    <div className="space-y-4">
      {/* Live: a report filed or a case closed elsewhere re-renders the register. */}
      <IncidentLive />
      <header>
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-muted-foreground">{description}</p>
      </header>

      <form method="get" className="grid gap-3 rounded-lg border border-border bg-bg-card p-4 sm:grid-cols-3 lg:grid-cols-6">
        <div className="sm:col-span-2">
          <label className={label} htmlFor="q">Search</label>
          <input id="q" name="q" defaultValue={params.q} placeholder="Incident #, caller, address, officer" className={field} />
        </div>
        {silo === 'Ethekwini' ? (
          <div>
            <label className={label} htmlFor="department">Department</label>
            <select id="department" name="department" defaultValue={params.department ?? ''} className={field}>
              <option value="">All</option>
              {CASE_DEPARTMENTS.map((d) => <option key={d} value={d}>{DEPARTMENT_LABELS[d]}</option>)}
              <option value="Ethekwini">Control room (not dispatched)</option>
            </select>
          </div>
        ) : null}
        <div>
          <label className={label} htmlFor="severity">Severity</label>
          <select id="severity" name="severity" defaultValue={params.severity ?? ''} className={field}>
            <option value="">Any</option>
            {CASE_SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="from">Call from</label>
          <input id="from" name="from" type="date" defaultValue={params.from} className={field} />
        </div>
        <div>
          <label className={label} htmlFor="to">Call to</label>
          <input id="to" name="to" type="date" defaultValue={params.to} className={field} />
        </div>
        <div className="flex items-end gap-2 sm:col-span-3 lg:col-span-6">
          <button type="submit" className="h-10 rounded-md bg-primary px-5 text-sm font-semibold">Apply</button>
          {filtered ? <Link href={basePath} className="text-sm text-accent hover:underline">Clear filters</Link> : null}
        </div>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>{rows.length}{truncated ? '+' : ''} case{rows.length === 1 ? '' : 's'}</CardTitle>
          <CardDescription>
            {VIEW_COPY[view].order}
            {truncated ? ' Showing the first 200; narrow the filters to see the rest.' : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {view === 'review' ? (
            <SimpleTable headers={['Incident', 'Type', 'Department', 'Report', 'Filed by', 'Resolved', 'Waiting', '']} empty={VIEW_COPY.review.empty}>
              {rows.map((r) => {
                const at = resolvedAtOf(r);
                return (
                  <Tr key={r.id}>
                    <Td><CaseLink row={r} review /></Td>
                    <Td><span className="mr-2">{r.incident_type}</span><SeverityPill severity={r.incident_severity} /></Td>
                    <Td>{departmentLabel(r)}</Td>
                    <Td>{reportLabel(r.report) ?? <span className="text-severity-medium-ink">No report on file</span>}</Td>
                    <Td>{r.report?.officer ?? r.responding_officer ?? '—'}</Td>
                    <Td className="whitespace-nowrap text-muted-foreground">{formatSaTime(at)}</Td>
                    <Td className="whitespace-nowrap font-semibold">{formatElapsed(minutesBetween(at, now))}</Td>
                    <Td className="whitespace-nowrap">
                      <Link href={`/incidents/${r.id}#case-review`} className="rounded-md bg-primary/15 px-3 py-1.5 text-xs font-semibold text-fg hover:bg-primary/25">
                        Review
                      </Link>
                    </Td>
                  </Tr>
                );
              })}
            </SimpleTable>
          ) : view === 'live' ? (
            <SimpleTable headers={['Incident', 'Type', 'Department', 'Status', 'Officer', 'Received', 'Age']} empty={VIEW_COPY.live.empty}>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td><CaseLink row={r} /></Td>
                  <Td><span className="mr-2">{r.incident_type}</span><SeverityPill severity={r.incident_severity} /></Td>
                  <Td>{departmentLabel(r)}</Td>
                  <Td><span className="status-badge" data-status={r.status}>{r.status}</span></Td>
                  <Td>{officerOf(r)}</Td>
                  <Td className="whitespace-nowrap text-muted-foreground">{formatSaTime(r.call_timestamp)}</Td>
                  <Td className="whitespace-nowrap">{formatElapsed(minutesBetween(r.call_timestamp, now))}</Td>
                </Tr>
              ))}
            </SimpleTable>
          ) : (
            <SimpleTable headers={['Incident', 'Type', 'Department', 'Outcome', 'Closed by', 'Closed', 'Call to close', '']} empty={VIEW_COPY.closed.empty}>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td><CaseLink row={r} /></Td>
                  <Td><span className="mr-2">{r.incident_type}</span><SeverityPill severity={r.incident_severity} /></Td>
                  <Td>{departmentLabel(r)}</Td>
                  <Td>
                    <OutcomeChip row={r} />
                    {r.close_reason ? <p className="mt-1 max-w-[280px] truncate text-xs text-muted-foreground" title={r.close_reason}>{r.close_reason}</p> : null}
                  </Td>
                  <Td>{r.closed_by_name ?? '—'}</Td>
                  <Td className="whitespace-nowrap text-muted-foreground">{formatSaTime(r.closed_at)}</Td>
                  <Td className="whitespace-nowrap">{formatElapsed(minutesBetween(r.call_timestamp, r.closed_at))}</Td>
                  <Td className="whitespace-nowrap text-xs">
                    <a href={`/api/pdf/incident/${r.id}`} className="text-accent hover:underline">PDF</a>
                    <span className="mx-1 text-muted-foreground">·</span>
                    <Link href={`/case-manager/audit?incident=${r.id}`} className="text-accent hover:underline">Audit</Link>
                  </Td>
                </Tr>
              ))}
            </SimpleTable>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
