import Link from 'next/link';
import { Ban, CircleCheck, FileCheck, FileWarning, Hourglass } from 'lucide-react';
import { formatElapsed, getReportType, minutesBetween } from '@criticom/api';
import { caseStage, closeActionFor, type Database, type UserRole } from '@criticom/db';
import { Card, CardContent } from '@/components/ui/card';
import { formatSaTime } from '@/lib/utils';
import { CancelCallForm, ReviewCloseForm } from './case-forms';

type Incident = Database['public']['Tables']['incidents']['Row'];
type PoliceReport = { report_type: string | null; officer_name: string | null; badge_number: string | null; filed_at: string | null } | null;
type FireReport = { report_number: string; reporting_officer_name: string | null; report_submission_date: string } | null;

/**
 * Where the case stands and what happens next (0061). One card, three states:
 *
 *   live    the desk may close it without a report, with a reason
 *   review  the report is filed; a case manager (or command) reads it and closes
 *   closed  who closed it, how and why
 */
export function CaseReviewCard({
  incident, role, report, fireReport, pcr = null, postMortem = null, responding,
}: {
  incident: Incident;
  role: UserRole;
  report: PoliceReport;
  fireReport: FireReport;
  /** The paramedic's patient care report (0063). */
  pcr?: { report_number: string | null; paramedic_names: string | null } | null;
  /** The Disaster officer's post-mortem (0065). */
  postMortem?: { report_number: string | null; reporting_officer: string | null } | null;
  responding: number;
}) {
  const stage = caseStage(incident.status);
  const action = closeActionFor(role, incident.status);

  if (stage === 'live') {
    if (action !== 'cancel') return null;
    return (
      <Card id="case-review">
        <CardContent className="p-4">
          <CancelCallForm incidentId={incident.id} incidentNumber={incident.incident_number} responding={responding} />
        </CardContent>
      </Card>
    );
  }

  if (stage === 'closed') {
    const cancelled = incident.close_kind === 'Cancelled';
    return (
      <Card id="case-review" className={cancelled ? 'border-severity-critical/30' : 'border-severity-low/40'}>
        <CardContent className="flex flex-wrap items-start gap-3 p-4 text-sm">
          {cancelled
            ? <Ban className="mt-0.5 h-5 w-5 shrink-0 text-severity-critical-ink" aria-hidden />
            : <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-severity-low-ink" aria-hidden />}
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              {cancelled ? 'Closed without a report' : incident.close_kind === 'Reviewed' ? 'Case reviewed and closed' : 'Case closed'}
              {incident.closed_by_name ? ` by ${incident.closed_by_name}` : ''}
            </p>
            <p className="text-muted-foreground">
              {formatSaTime(incident.closed_at)}
              {incident.close_kind === 'Reviewed' && incident.report_filed_at
                ? ` · reviewed ${formatElapsed(minutesBetween(incident.report_filed_at, incident.closed_at))} after the report`
                : ''}
            </p>
            {incident.close_reason ? <p className="mt-1 whitespace-pre-wrap break-words">{incident.close_reason}</p> : null}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Review: the call is Resolved and waits to be read.
  const filedAt = incident.report_filed_at ?? incident.resolved_at;
  const waited = minutesBetween(filedAt, new Date().toISOString());
  const reportLine = report
    ? `${getReportType(report.report_type).label} by ${report.officer_name ?? 'the officer'}${report.badge_number ? ` #${report.badge_number}` : ''}`
    : fireReport
      ? `Fire report ${fireReport.report_number} by ${fireReport.reporting_officer_name ?? 'the crew'}`
      : pcr
        ? `Patient care report ${pcr.report_number ?? ''} by ${pcr.paramedic_names ?? 'the crew'}`
        : postMortem
          ? `Post-mortem ${postMortem.report_number ?? ''} by ${postMortem.reporting_officer ?? 'Disaster Management'}`
          : null;

  return (
    <Card id="case-review" className="border-accent/50">
      <CardContent className="grid gap-4 p-4 text-sm lg:grid-cols-[1fr_minmax(260px,380px)]">
        <div className="flex items-start gap-3">
          {reportLine
            ? <FileCheck className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
            : <FileWarning className="mt-0.5 h-5 w-5 shrink-0 text-severity-medium-ink" aria-hidden />}
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wider text-accent">Awaiting review</p>
            <p className="mt-0.5 font-semibold">{reportLine ?? 'Resolved with no report on file'}</p>
            <p className="text-muted-foreground">
              {filedAt ? `Resolved ${formatSaTime(filedAt)}` : 'Resolved'}
              {waited !== null ? ` · waiting ${formatElapsed(waited)}` : ''}
            </p>
            <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {reportLine ? <a href="#case-report" className="text-accent hover:underline">Read the report</a> : null}
              <a href="#case-evidence" className="text-accent hover:underline">Evidence</a>
              <a href="#case-history" className="text-accent hover:underline">Full history</a>
              <a href={`/api/pdf/incident/${incident.id}`} className="text-accent hover:underline">Case PDF</a>
            </p>
          </div>
        </div>
        <div>
          {action === 'review' ? (
            <ReviewCloseForm incidentId={incident.id} incidentNumber={incident.incident_number} />
          ) : (
            <p className="flex items-start gap-2 rounded-md border border-border bg-bg-soft p-3 text-xs text-muted-foreground">
              <Hourglass className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                Waiting for a case manager to read the report and close the case.{' '}
                <Link href="/case-manager/review" className="text-accent hover:underline">Review queue</Link>
              </span>
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
