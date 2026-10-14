import Link from 'next/link';
import { ArrowRight, FileCheck, History } from 'lucide-react';
import {
  DEPARTMENT_LABELS, formatElapsed, getCaseDashboard, listCases, minutesBetween, resolvedAtOf,
} from '@criticom/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SimpleTable, Td, Tr } from '@/components/simple-table';
import { IncidentLive } from '@/components/incident-live';
import { getSession } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';
import { CaseLink, OutcomeChip, SeverityPill, departmentLabel, officerOf, reportLabel } from './case-ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Case Management · HikTech' };

/**
 * Case Management (0061): the end of a call's life.
 *
 * A police call ends when the officer files the report: the call is Resolved
 * and lands here. The case manager reads the case file (report, evidence,
 * timeline, audit) and closes it. Everything on this page answers one of
 * three questions: what is waiting for me, what is still out there, and what
 * did we close.
 */
function Tile({ label, value, sub, tone, href }: { label: string; value: string | number; sub?: string; tone?: string; href?: string }) {
  const body = (
    <CardContent className="p-4">
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${tone ?? ''}`}>{value}</p>
      {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
    </CardContent>
  );
  return href ? (
    <Link href={href} className="rounded-xl transition-colors hover:ring-1 hover:ring-accent/50">
      <Card className="h-full">{body}</Card>
    </Link>
  ) : (
    <Card>{body}</Card>
  );
}

export default async function CaseDashboardPage() {
  const { supabase, silo } = await getSession();
  const [summary, review, live, closed] = await Promise.all([
    getCaseDashboard(supabase),
    listCases(supabase, { view: 'review', limit: 8 }),
    listCases(supabase, { view: 'live', limit: 8 }),
    listCases(supabase, { view: 'closed', limit: 6 }),
  ]);
  const now = new Date().toISOString();
  const scope = silo === 'Ethekwini' ? 'Every department' : (DEPARTMENT_LABELS[silo] ?? silo);

  const tiles: Array<{ label: string; value: string | number; sub?: string; tone?: string; href?: string }> = [
    {
      label: 'Awaiting review', value: summary.awaitingReview, tone: summary.awaitingReview ? 'text-accent' : undefined,
      sub: summary.oldestReviewSince ? `Oldest waiting ${formatElapsed(minutesBetween(summary.oldestReviewSince, now))}` : 'Nothing waiting',
      href: '/case-manager/review',
    },
    { label: 'Live calls', value: summary.live, tone: 'text-severity-medium-ink', sub: 'Being worked now', href: '/case-manager/open' },
    { label: 'Closed today', value: summary.closedToday, tone: 'text-severity-low-ink', sub: 'Since midnight', href: '/case-manager/closed' },
    { label: 'Reports filed today', value: summary.reportsToday, sub: 'Since midnight' },
    {
      label: 'Call to resolved', value: formatElapsed(summary.avgResolveMins),
      sub: `Average, last ${summary.windowDays} days · ${summary.resolvedInWindow} calls`,
    },
    {
      label: 'Report to closed', value: formatElapsed(summary.avgReviewMins),
      sub: `Average review time, last ${summary.windowDays} days`,
    },
  ];

  return (
    <div className="space-y-5">
      {/* Live: a report filed or a case closed anywhere re-renders the page. */}
      <IncidentLive />

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">Case Management · {scope}</p>
          <h1 className="mt-1 text-2xl font-bold">Case dashboard</h1>
          <p className="text-sm text-muted-foreground">
            A call comes here once its officer files the report. Read the case file, then close it.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/case-manager/review" className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold">
            <FileCheck className="h-4 w-4" aria-hidden /> Review queue ({summary.awaitingReview})
          </Link>
          <Link href="/case-manager/audit" className="inline-flex items-center gap-2 rounded-md border border-border bg-bg-soft px-4 py-2 text-sm hover:bg-muted">
            <History className="h-4 w-4" aria-hidden /> Audit trail
          </Link>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" aria-label="Case figures">
        {tiles.map((t) => <Tile key={t.label} {...t} />)}
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>Awaiting review</CardTitle>
                <CardDescription>Newest first. Open one to read its report and close it.</CardDescription>
              </div>
              <Link href="/case-manager/review" className="inline-flex shrink-0 items-center gap-1 text-sm text-accent hover:underline">
                All {summary.awaitingReview} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <SimpleTable headers={['Incident', 'Type', 'Report', 'Waiting', '']} empty="Nothing waiting. Every filed report has been reviewed.">
              {review.rows.map((r) => (
                <Tr key={r.id}>
                  <Td><CaseLink row={r} review /><p className="text-xs text-muted-foreground">{departmentLabel(r)}</p></Td>
                  <Td><span className="mr-2">{r.incident_type}</span><SeverityPill severity={r.incident_severity} /></Td>
                  <Td>
                    {reportLabel(r.report) ?? <span className="text-severity-medium-ink">No report on file</span>}
                    <p className="text-xs text-muted-foreground">{r.report?.officer ?? r.responding_officer ?? '—'}</p>
                  </Td>
                  <Td className="whitespace-nowrap font-semibold">{formatElapsed(minutesBetween(resolvedAtOf(r), now))}</Td>
                  <Td>
                    <Link href={`/incidents/${r.id}#case-review`} className="rounded-md bg-primary/15 px-3 py-1.5 text-xs font-semibold hover:bg-primary/25">
                      Review
                    </Link>
                  </Td>
                </Tr>
              ))}
            </SimpleTable>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>By department</CardTitle>
            <CardDescription>Waiting for review, and still live.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {summary.byDepartment.map((d) => (
              <div key={d.department} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-soft px-3 py-2.5 text-sm">
                <span className="font-medium">{d.label}</span>
                <span className="flex items-center gap-3 text-xs">
                  <Link href={`/case-manager/review?department=${d.department}`} className={d.review ? 'font-semibold text-accent hover:underline' : 'text-muted-foreground hover:underline'}>
                    {d.review} to review
                  </Link>
                  <Link href={`/case-manager/open?department=${d.department}`} className="text-muted-foreground hover:underline">
                    {d.live} live
                  </Link>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>Live calls</CardTitle>
                <CardDescription>Still being worked; newest first.</CardDescription>
              </div>
              <Link href="/case-manager/open" className="inline-flex shrink-0 items-center gap-1 text-sm text-accent hover:underline">
                All {summary.live} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <SimpleTable headers={['Incident', 'Status', 'Officer', 'Age']} empty="No live calls.">
              {live.rows.map((r) => (
                <Tr key={r.id}>
                  <Td><CaseLink row={r} /><p className="text-xs text-muted-foreground">{r.incident_type}</p></Td>
                  <Td><span className="status-badge" data-status={r.status}>{r.status}</span></Td>
                  <Td>{officerOf(r)}</Td>
                  <Td className="whitespace-nowrap">{formatElapsed(minutesBetween(r.call_timestamp, now))}</Td>
                </Tr>
              ))}
            </SimpleTable>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>Recently closed</CardTitle>
                <CardDescription>Who closed each case, and how.</CardDescription>
              </div>
              <Link href="/case-manager/closed" className="inline-flex shrink-0 items-center gap-1 text-sm text-accent hover:underline">
                Closed cases <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <SimpleTable headers={['Incident', 'Outcome', 'Closed by', 'Closed']} empty="Nothing closed yet.">
              {closed.rows.map((r) => (
                <Tr key={r.id}>
                  <Td><CaseLink row={r} /><p className="text-xs text-muted-foreground">{r.incident_type}</p></Td>
                  <Td><OutcomeChip row={r} /></Td>
                  <Td>{r.closed_by_name ?? '—'}</Td>
                  <Td className="whitespace-nowrap text-muted-foreground">{formatSaTime(r.closed_at)}</Td>
                </Tr>
              ))}
            </SimpleTable>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
