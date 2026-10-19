import Link from 'next/link';
import { REPORT_STANDINGS, STANDING_TONE, reportStats } from '@criticom/api';
import { POLICE_REPORTS_PATH } from '@criticom/db';
import { StackedBarChart, ToneDonut } from '@/components/charts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { loadReportCentre } from '@/lib/police-reports';
import { ActivityRow, BarList, CentreHeader, Kpi, NoReports } from '../parts';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Reports Management · HikTech' };

/** V4's Reports → Management dashboard, on the real reports: totals, the last seven days, each form, and the latest filed. */
export default async function ReportsManagementPage() {
  const { t } = await requestT();
  const { records } = await loadReportCentre();
  const s = reportStats(records);
  const donut = s.byKind.filter((k) => k.count > 0).map((k) => ({ name: `${k.code} ${k.label}`, value: k.count, color: k.tone }));

  return (
    <div className="space-y-6">
      <CentreHeader title={t('Reports management')} subtitle={t('Police reports at a glance: where they stand, what was filed, and by whom.')} active="management" />

      <section className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi label={t('Total reports')} value={s.total} tone="#6366f1" />
        <Kpi label={t('Reviewed')} value={s.byStanding.Reviewed} tone={STANDING_TONE.Reviewed} hint={s.reviewedPct === null ? undefined : `${s.reviewedPct}% of reports on calls`} />
        <Kpi label={t('Awaiting review')} value={s.byStanding['Awaiting review']} tone={STANDING_TONE['Awaiting review']} hint={t('Call not closed yet')} />
        <Kpi label={t('Console reports')} value={s.byStanding['Console report']} tone={STANDING_TONE['Console report']} hint={t('Not on a dispatched call')} />
        <Kpi label={t('This week')} value={s.thisWeek} tone="#06b6d4" hint={t('Last 7 days')} />
        <Kpi label={t('Arrests')} value={s.arrests} tone="#ef4444" />
      </section>

      {s.total === 0 ? <NoReports /> : (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="frost lg:col-span-2">
              <CardHeader>
                <CardTitle>{t('Reports — last 7 days')}</CardTitle>
                <CardDescription>{t('Each day\'s reports, by where they stand.')}</CardDescription>
              </CardHeader>
              <CardContent>
                <StackedBarChart
                  data={s.byDay}
                  xKey="label"
                  series={REPORT_STANDINGS.map((k) => ({ key: k, label: k, color: STANDING_TONE[k] }))}
                />
              </CardContent>
            </Card>
            <Card className="frost">
              <CardHeader>
                <CardTitle>{t('By form')}</CardTitle>
                <CardDescription>{t('A report with two forms counts under both.')}</CardDescription>
              </CardHeader>
              <CardContent><ToneDonut data={donut} /></CardContent>
            </Card>
          </div>

          <section className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">{t('Report type breakdown')}</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {s.byKind.map((k) => (
                <Link
                  key={k.id}
                  href={`${POLICE_REPORTS_PATH}/records?form=${k.id}`}
                  className="frost rounded-xl border p-4 transition-colors hover:bg-bg-soft/80"
                  style={{ borderColor: `${k.tone}55` }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: k.tone }} aria-hidden />
                      <span className="truncate font-semibold">{k.label}</span>
                    </span>
                    <span className="font-mono text-xs font-bold" style={{ color: k.tone }}>{k.code}</span>
                  </div>
                  <p className="mt-2 text-3xl font-bold tabular-nums" style={{ color: k.tone }}>{k.count}</p>
                  <div className="mt-2 h-2 rounded-full bg-bg-soft" title={`${k.pct}% reviewed`}>
                    <div className="h-2 rounded-full" style={{ width: `${k.pct}%`, backgroundColor: k.tone }} />
                  </div>
                  <p className="mt-1.5 flex justify-between text-xs text-muted-foreground">
                    <span><span style={{ color: STANDING_TONE.Reviewed }}>●</span> {' '}{t('{reviewed} reviewed', { reviewed: k.reviewed })}</span>
                    <span><span style={{ color: STANDING_TONE['Awaiting review'] }}>●</span> {' '}{t('{awaiting} awaiting', { awaiting: k.awaiting })}</span>
                    <span className="font-semibold">{k.pct}%</span>
                  </p>
                </Link>
              ))}
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="frost lg:col-span-2">
              <CardHeader className="flex flex-row items-start justify-between gap-2">
                <div>
                  <CardTitle>{t('Recent activity')}</CardTitle>
                  <CardDescription>{t('The latest reports filed.')}</CardDescription>
                </div>
                <Link href={`${POLICE_REPORTS_PATH}/activity`} className="text-sm font-semibold text-accent hover:underline">{t('See all')}</Link>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">{records.slice(0, 8).map((r) => <ActivityRow key={r.id} r={r} />)}</ul>
              </CardContent>
            </Card>
            <div className="space-y-4">
              <Card className="frost">
                <CardHeader><CardTitle>{t('Busiest stations')}</CardTitle></CardHeader>
                <CardContent><BarList items={s.byStation} tone="#6366f1" empty={t('No station given yet.')} /></CardContent>
              </Card>
              <Card className="frost">
                <CardHeader><CardTitle>{t('Most reports filed')}</CardTitle></CardHeader>
                <CardContent><BarList items={s.byOfficer} tone="#06b6d4" empty={t('No officer given yet.')} /></CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
