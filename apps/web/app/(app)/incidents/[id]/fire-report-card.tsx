import Link from 'next/link';
import { Lock } from 'lucide-react';
import type { FirefighterReport } from '@criticom/api';
import { FIRE_REPORT_SECTIONS, formatDuration } from '@criticom/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatSaTime } from '@/lib/utils';
import { requestT } from '@/lib/i18n';

/** Answers worth showing: blanks, "No" defaults and zero counts are noise. */
function shown(v: unknown) {
  if (v === null || v === undefined || v === '' || v === false || v === 0 || v === '0' || v === '0.00') return null;
  return v === true ? 'Yes' : String(v);
}

/**
 * The firefighter's filed fire report, read-only. It is a permanent record
 * (migration 0059): nobody, admins included, can edit or delete it.
 */
export async function FireReportCard({ report }: { report: FirefighterReport }) {
  const { t } = await requestT();
  const row = report as unknown as Record<string, unknown>;
  const sections = FIRE_REPORT_SECTIONS
    .filter((s) => s.id !== 'narrative')
    .map((s) => ({
      title: s.title,
      items: s.fields.flatMap((f) => {
        // ventilation_type 'None' is stored as not conducted; money is a number column.
        const v = shown(row[f.key]);
        return v ? [{ label: f.label, value: f.kind === 'money' ? `R ${Number(v).toLocaleString('en-ZA')}` : v }] : [];
      }),
    }))
    .filter((s) => s.items.length > 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>{t('Fire report · {value}', { value: report.report_number })}</CardTitle>
            <CardDescription>
              {t('Filed by {value}{value2}{value3}{value4}{value5}', { value: report.reporting_officer_rank ? `${report.reporting_officer_rank} ` : '', value2: report.reporting_officer_name ?? 'firefighter', value3: report.reporting_officer_id ? ` #${report.reporting_officer_id}` : '', value4: ` · ${formatSaTime(report.report_submission_date)}`, value5: report.station_number ? ` · Station ${report.station_number}` : '' })}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/fire/reports/${report.id}`} className="text-xs font-semibold text-accent hover:underline">{t('Open full report')}</Link>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-soft px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
              <Lock className="h-3 w-3" /> {' '}{t('Permanent record')}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            ['Call → dispatch', formatDuration(Number(report.dispatch_time_seconds))],
            ['Dispatch → arrival', formatDuration(Number(report.arrival_time_seconds))],
            ['Time on scene', formatDuration(Number(report.total_time_on_scene_seconds))],
            ['Photos', report.photos_attached ? 'Attached' : report.no_photo_reason ? `None — ${report.no_photo_reason}` : 'None'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border bg-bg-soft p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
              <p className="mt-1 text-sm font-bold">{value}</p>
            </div>
          ))}
        </div>

        {report.narrative_summary ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('Summary')}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm">{report.narrative_summary}</p>
          </div>
        ) : null}
        {report.initial_observations ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('Initial observations')}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm">{report.initial_observations}</p>
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sections.map((s) => (
            <div key={s.title} className="rounded-lg border border-border p-3">
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">{s.title}</p>
              <dl className="space-y-1 text-sm">
                {s.items.map((i) => (
                  <div key={i.label} className="flex gap-2">
                    <dt className="w-40 shrink-0 text-muted-foreground">{i.label}</dt>
                    <dd className="font-medium">{i.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
