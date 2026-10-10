import { noteText } from '@criticom/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatSaTime } from '@/lib/utils';

type PostMortem = {
  report_number: string | null; incident_type: string | null; location: string | null;
  start_time: string | null; end_time: string | null; total_duration_hours: number | string | null;
  injuries: number; fatalities: number; displaced_people: number;
  root_cause: string | null; lessons_learned: string | null; reporting_officer: string | null;
  report_filed_at: string; timeline_snapshot: unknown;
};

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="whitespace-pre-wrap break-words">{value ?? '—'}</dd>
    </div>
  );
}

/** A filed post-mortem (Official After-Action Report), read back in V4's sections. */
export function PostMortemCard({ report }: { report: PostMortem }) {
  const timeline = Array.isArray(report.timeline_snapshot) ? (report.timeline_snapshot as Array<{ timestamp?: string; text?: string }>) : [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Post-mortem{report.report_number ? ` · ${report.report_number}` : ''}</CardTitle>
        <CardDescription>{report.reporting_officer ?? 'Disaster Management'} · {formatSaTime(report.report_filed_at)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div>
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Incident Overview</p>
          <dl className="grid gap-x-4 gap-y-2 rounded-md border border-border/60 bg-bg-soft p-3 sm:grid-cols-2">
            <Item label="Type" value={report.incident_type} />
            <Item label="Location" value={report.location} />
            <Item label="Start Time" value={report.start_time ? formatSaTime(report.start_time) : null} />
            <Item label="Resolved Time" value={report.end_time ? formatSaTime(report.end_time) : null} />
            <Item label="Duration" value={report.total_duration_hours != null ? `${report.total_duration_hours} hours` : null} />
          </dl>
        </div>
        <div>
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Impact Metrics</p>
          <dl className="grid gap-x-4 gap-y-2 rounded-md border border-border/60 bg-bg-soft p-3 sm:grid-cols-3">
            <Item label="Confirmed Injuries" value={report.injuries} />
            <Item label="Confirmed Fatalities" value={report.fatalities} />
            <Item label="Displaced Persons (Requiring Shelter)" value={report.displaced_people} />
          </dl>
        </div>
        <div>
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Operational Analysis</p>
          <dl className="grid gap-x-4 gap-y-2 rounded-md border border-border/60 bg-bg-soft p-3">
            <Item label="Root Cause Analysis" value={report.root_cause} />
            <Item label="Lessons Learned / Recommendations" value={report.lessons_learned} />
            <Item label="Reporting Officer Name" value={report.reporting_officer} />
          </dl>
        </div>
        {timeline.length ? (
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Timeline</p>
            <ul className="space-y-1 rounded-md border border-border/60 bg-bg-soft p-3">
              {timeline.map((e, n) => (
                <li key={`${e.timestamp}-${n}`} className="flex gap-3">
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">{e.timestamp}</span>
                  <span>{noteText(e.text)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
