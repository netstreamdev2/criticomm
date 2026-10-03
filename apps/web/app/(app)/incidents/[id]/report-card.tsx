import { Lock } from 'lucide-react';
import { describeReportDetails, getReportType, type getIncidentReport } from '@criticom/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatSaTime } from '@/lib/utils';

type Report = NonNullable<Awaited<ReturnType<typeof getIncidentReport>>>;

/** Column answers worth showing: blanks, "No" defaults and zero counts are noise. */
function shown(v: unknown) {
  if (v === null || v === undefined || v === '' || v === false || v === 0) return null;
  return v === true ? 'Yes' : String(v);
}

/**
 * The officer's filed case report, read-only. It is a permanent record
 * (migration 0039): nobody, admins included, can edit or delete it.
 */
export function PoliceReportCard({ report }: { report: Report }) {
  const type = getReportType(report.report_type);
  const row = report as unknown as Record<string, unknown>;

  const sections = type.sections
    .filter((s) => s.title !== 'Narrative')
    .map((s) => ({
      title: s.title,
      items: s.fields.flatMap((f) => {
        const v = shown(f.column ? row[f.key] : (report.details ?? {})[f.key]);
        return v ? [{ label: f.label, value: v }] : [];
      }),
    }))
    .filter((s) => s.items.length > 0);
  // Answers from a form version that no longer lists them still belong on record.
  const listed = new Set(sections.flatMap((s) => s.items.map((i) => i.label)));
  const extra = describeReportDetails(type, report.details).filter((d) => !listed.has(d.label));

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>Case report · {type.label}</CardTitle>
            <CardDescription>
              Filed by {report.officer_name ?? 'officer'}
              {report.badge_number ? ` #${report.badge_number}` : ''}
              {report.filed_at ? ` · ${formatSaTime(report.filed_at)}` : ''}
              {report.station ? ` · ${report.station}` : ''}
            </CardDescription>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-soft px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
            <Lock className="h-3 w-3" /> Permanent record
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid gap-3 sm:grid-cols-4">
          <div><p className="text-xs uppercase text-muted-foreground">Case number</p><p className="font-mono">{report.case_number ?? '—'}</p></div>
          <div><p className="text-xs uppercase text-muted-foreground">Dispatched</p><p className="font-mono">{report.dispatch_time ?? '—'}</p></div>
          <div><p className="text-xs uppercase text-muted-foreground">On scene</p><p className="font-mono">{report.arrival_time ?? '—'}</p></div>
          <div><p className="text-xs uppercase text-muted-foreground">Cleared · total</p><p className="font-mono">{report.clear_time ?? '—'}{report.total_time ? ` · ${report.total_time}` : ''}</p></div>
        </div>

        {sections.map((s) => (
          <div key={s.title}>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{s.title}</p>
            <dl className="grid gap-x-4 gap-y-2 rounded-md border border-border/60 bg-bg-soft p-3 sm:grid-cols-2">
              {s.items.map((i) => (
                <div key={i.label}>
                  <dt className="text-xs text-muted-foreground">{i.label}</dt>
                  <dd className="whitespace-pre-wrap break-words">{i.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}

        {extra.length > 0 ? (
          <dl className="grid gap-x-4 gap-y-2 rounded-md border border-border/60 bg-bg-soft p-3 sm:grid-cols-2">
            {extra.map((i) => (
              <div key={i.label}><dt className="text-xs text-muted-foreground">{i.label}</dt><dd>{i.value}</dd></div>
            ))}
          </dl>
        ) : null}

        <div>
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Officer narrative</p>
          <p className="whitespace-pre-wrap rounded-md border border-border/60 bg-bg-soft p-3 leading-relaxed">
            {report.officer_narrative}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
