import { Lock } from 'lucide-react';
import { getReportType, reportReadout, type getIncidentReport } from '@criticom/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatSaTime } from '@/lib/utils';
import { FormSectionTitle, ReportFormChips } from '@/components/report-form-chips';
import { requestT } from '@/lib/i18n';

type Report = NonNullable<Awaited<ReturnType<typeof getIncidentReport>>>;

/**
 * The officer's filed case report, read-only. It is a permanent record
 * (migration 0039): nobody, admins included, can edit or delete it.
 */
export async function PoliceReportCard({ report }: { report: Report }) {
  const { t } = await requestT();
  const type = getReportType(report.report_type);
  // The same readout the case PDF prints.
  const { sections, extra } = reportReadout(type, report as unknown as Record<string, unknown>);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>{t('Case report · {label}', { label: type.label })}</CardTitle>
            <CardDescription>
              {t('Filed by {value}{value2}{value3}{value4}', { value: report.officer_name ?? 'officer', value2: report.badge_number ? ` #${report.badge_number}` : '', value3: report.filed_at ? ` · ${formatSaTime(report.filed_at)}` : '', value4: report.station ? ` · ${report.station}` : '' })}
            </CardDescription>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-soft px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
            <Lock className="h-3 w-3" /> {' '}{t('Permanent record')}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <ReportFormChips forms={type.forms ?? []} />

        <div className="grid gap-3 sm:grid-cols-4">
          <div><p className="text-xs uppercase text-muted-foreground">{t('Case number')}</p><p className="font-mono">{report.case_number ?? '—'}</p></div>
          <div><p className="text-xs uppercase text-muted-foreground">{t('Dispatched')}</p><p className="font-mono">{report.dispatch_time ?? '—'}</p></div>
          <div><p className="text-xs uppercase text-muted-foreground">{t('On scene')}</p><p className="font-mono">{report.arrival_time ?? '—'}</p></div>
          <div><p className="text-xs uppercase text-muted-foreground">{t('Cleared · total')}</p><p className="font-mono">{report.clear_time ?? '—'}{report.total_time ? ` · ${report.total_time}` : ''}</p></div>
        </div>

        {sections.map((s) => (
          <div key={s.title}>
            <FormSectionTitle title={s.title} form={s.form} />
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
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t('Officer narrative')}</p>
          <p className="whitespace-pre-wrap rounded-md border border-border/60 bg-bg-soft p-3 leading-relaxed">
            {report.officer_narrative}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
