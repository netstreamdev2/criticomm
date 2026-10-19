import Link from 'next/link';
import { Download, FileDown } from 'lucide-react';
import { REPORT_KINDS, REPORT_STANDINGS, STANDING_TONE, filterReports, reportStats, reportWindow } from '@criticom/api';
import { POLICE_REPORTS_PATH } from '@criticom/db';
import { StackedBarChart, ToneDonut } from '@/components/charts';
import { SimpleTable, Td, Tr } from '@/components/simple-table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { describeFilters, loadReportCentre, readReportQuery, reportQueryString } from '@/lib/police-reports';
import { formatSaTime } from '@/lib/utils';
import { BarList, CentreHeader, Kpi, RecordForms, StandingPill } from '../parts';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Specialised Report · Police Reports · HikTech' };

const SHOWN = 200;
const BASE = `${POLICE_REPORTS_PATH}/specialised`;
const field = 'mt-1 block h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm';
const label = 'text-xs font-semibold uppercase text-muted-foreground';

/**
 * A report made to order: the forms, dates, station, officer and outcome the
 * person chooses, with its totals, graphs and the reports themselves, as a
 * PDF or a spreadsheet.
 */
export default async function SpecialisedReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { t } = await requestT();
  const { records } = await loadReportCentre();
  const params = await searchParams;
  const query = readReportQuery(params);
  const ran = Object.keys(params).length > 0;
  const shown = ran ? filterReports(records, query) : [];
  const { now, days } = reportWindow(query);
  const s = reportStats(shown, now, days);
  const chosen = new Set(query.forms ?? (query.form ? [query.form] : []));
  const kinds = s.byKind.filter((k) => (chosen.size ? chosen.has(k.id) : k.count > 0));
  const qs = reportQueryString(query);

  return (
    <div className="space-y-5">
      <CentreHeader
        title={t('Specialised report')}
        subtitle={t('Choose the forms, the dates and the people. The report is built from the reports on record.')}
        active="specialised"
        actions={ran ? (
          <>
            <a href={`${POLICE_REPORTS_PATH}/export${qs}`} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-bg-soft px-3 text-sm font-semibold hover:bg-bg">
              <Download className="h-4 w-4" /> {' '}{t('Spreadsheet')}</a>
            <a href={`${POLICE_REPORTS_PATH}/export/pdf${qs}`} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-semibold">
              <FileDown className="h-4 w-4" /> {' '}{t('Download PDF')}</a>
          </>
        ) : undefined}
      />

      <form method="get" className="frost space-y-4 rounded-xl border border-border p-4">
        <fieldset>
          <legend className={label}>{t('Forms (none ticked: every form)')}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {REPORT_KINDS.map((k) => (
              <label
                key={k.id}
                className="frost-pill inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold has-[:checked]:text-fg"
                style={{ borderColor: `${k.tone}77`, backgroundColor: chosen.has(k.id) ? `${k.tone}22` : undefined }}
              >
                <input type="checkbox" name="forms" value={k.id} defaultChecked={chosen.has(k.id)} className="h-3.5 w-3.5" style={{ accentColor: k.tone }} />
                <span className="font-mono" style={{ color: k.tone }}>{k.code}</span> {k.label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className={label} htmlFor="from">{t('From')}</label>
            <input id="from" name="from" type="date" defaultValue={query.from ?? ''} className={field} />
          </div>
          <div>
            <label className={label} htmlFor="to">{t('To')}</label>
            <input id="to" name="to" type="date" defaultValue={query.to ?? ''} className={field} />
          </div>
          <div>
            <label className={label} htmlFor="station">{t('Station')}</label>
            <input id="station" name="station" defaultValue={query.station ?? ''} placeholder={t('Any station')} className={field} />
          </div>
          <div>
            <label className={label} htmlFor="officer">{t('Officer')}</label>
            <input id="officer" name="officer" defaultValue={query.officer ?? ''} placeholder={t('Any officer')} className={field} />
          </div>
          <div>
            <label className={label} htmlFor="standing">{t('Status')}</label>
            <select id="standing" name="standing" defaultValue={query.standing ?? ''} className={field}>
              <option value="">{t('Any')}</option>
              {REPORT_STANDINGS.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="arrest">{t('Arrest')}</label>
            <select id="arrest" name="arrest" defaultValue={query.arrest ?? ''} className={field}>
              <option value="">{t('Either')}</option>
              <option value="Yes">{t('With an arrest')}</option>
              <option value="No">{t('Without an arrest')}</option>
            </select>
          </div>
          <div>
            <label className={label} htmlFor="q">{t('Words')}</label>
            <input id="q" name="q" defaultValue={query.q ?? ''} placeholder={t('Place, call, case number')} className={field} />
          </div>
          <div className="flex items-end gap-2">
            <button type="submit" name="run" value="1" className="h-10 flex-1 rounded-md bg-primary text-sm font-semibold">{t('Build report')}</button>
            <Link href={BASE} className="flex h-10 items-center rounded-md border border-border px-3 text-sm">{t('Clear')}</Link>
          </div>
        </div>
      </form>

      {!ran ? (
        <p className="frost rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {t('Choose what the report covers, then press Build report.')}</p>
      ) : (
        <>
          <p className="text-sm font-semibold">{describeFilters(query)}</p>

          <section className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
            <Kpi label={t('Reports')} value={s.total} tone="#d946ef" />
            <Kpi label={t('Reviewed')} value={s.byStanding.Reviewed} tone={STANDING_TONE.Reviewed} hint={s.reviewedPct === null ? undefined : `${s.reviewedPct}%`} />
            <Kpi label={t('Awaiting review')} value={s.byStanding['Awaiting review']} tone={STANDING_TONE['Awaiting review']} />
            <Kpi label={t('Console reports')} value={s.byStanding['Console report']} tone={STANDING_TONE['Console report']} />
            <Kpi label={t('Arrests')} value={s.arrests} tone="#ef4444" />
          </section>

          {s.total > 0 ? (
            <>
              <div className="grid gap-4 lg:grid-cols-3">
                <Card className="frost lg:col-span-2">
                  <CardHeader>
                    <CardTitle>{t('By day')}</CardTitle>
                    <CardDescription>{t('{days} day{value} to {day}, by where each report stands.', { days, value: days === 1 ? '' : 's', day: s.byDay.at(-1)?.day })}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <StackedBarChart
                      data={s.byDay.map((d) => ({ ...d, label: days > 7 ? d.day.slice(5) : d.label }))}
                      xKey="label"
                      series={REPORT_STANDINGS.map((k) => ({ key: k, label: k, color: STANDING_TONE[k] }))}
                    />
                  </CardContent>
                </Card>
                <Card className="frost">
                  <CardHeader><CardTitle>{t('By form')}</CardTitle></CardHeader>
                  <CardContent>
                    <ToneDonut data={kinds.filter((k) => k.count > 0).map((k) => ({ name: `${k.code} ${k.label}`, value: k.count, color: k.tone }))} />
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="frost">
                  <CardHeader><CardTitle>{t('Stations')}</CardTitle></CardHeader>
                  <CardContent><BarList items={s.byStation} tone="#6366f1" empty={t('No station given.')} /></CardContent>
                </Card>
                <Card className="frost">
                  <CardHeader><CardTitle>{t('Officers')}</CardTitle></CardHeader>
                  <CardContent><BarList items={s.byOfficer} tone="#06b6d4" empty={t('No officer given.')} /></CardContent>
                </Card>
              </div>
            </>
          ) : null}

          <Card className="frost">
            <CardHeader>
              <CardTitle>{t('The reports')}</CardTitle>
              <CardDescription>
                {shown.length > SHOWN ? `The latest ${SHOWN} of ${shown.length}; the spreadsheet and the PDF carry them all.` : `${shown.length} report${shown.length === 1 ? '' : 's'}.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <SimpleTable headers={['Case number', 'Forms', 'Officer', 'Station', 'Call', 'Filed', 'Status', '']} empty={t('No reports match.')}>
                {shown.slice(0, SHOWN).map((r) => (
                  <Tr key={r.id}>
                    <Td className="font-mono font-semibold">{r.caseNumber}</Td>
                    <Td><RecordForms record={r} /></Td>
                    <Td>{r.officer ?? '—'}</Td>
                    <Td>{r.station ?? '—'}</Td>
                    <Td className="font-mono text-xs">{r.incidentNumber ?? '—'}</Td>
                    <Td className="whitespace-nowrap text-xs">{formatSaTime(r.at)}</Td>
                    <Td><StandingPill standing={r.standing} /></Td>
                    <Td><Link href={`${POLICE_REPORTS_PATH}/report/${r.id}`} className="font-semibold text-accent hover:underline">{t('View')}</Link></Td>
                  </Tr>
                ))}
              </SimpleTable>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
