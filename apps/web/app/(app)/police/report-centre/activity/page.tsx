import Link from 'next/link';
import { REPORT_KINDS, filterReports, type ReportFilters } from '@criticom/api';
import { POLICE_REPORTS_PATH } from '@criticom/db';
import { loadReportCentre, readReportQuery, reportQueryString } from '@/lib/police-reports';
import { ActivityRow, CentreHeader, NoReports } from '../parts';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Recent Activity · Police Reports · HikTech' };

const SHOWN = 100;
const PERIODS: Array<{ id: ReportFilters['period']; label: string }> = [
  { id: 'today', label: 'Today' }, { id: 'week', label: 'Last 7 days' }, { id: 'month', label: 'Last 30 days' }, { id: null, label: 'All' },
];
const BASE = `${POLICE_REPORTS_PATH}/activity`;

/** Reports as officers file them, newest first: when, who, which call, which forms, and where each stands. */
export default async function RecentActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { t } = await requestT();
  const { records } = await loadReportCentre();
  const params = await searchParams;
  const query = readReportQuery(params);
  // The last seven days unless another period, or All, is chosen.
  const f: ReportFilters = { period: params.period === 'all' ? null : (query.period ?? 'week'), form: query.form };
  const period = { period: f.period ?? 'all' };
  const shown = filterReports(records, f);

  const chip = (on: boolean, tone = '#06b6d4') => ({
    className: 'frost-pill rounded-full border px-3 py-1 text-xs font-semibold',
    style: on ? { borderColor: tone, backgroundColor: `${tone}22`, color: tone } : { borderColor: `${tone}44` },
  });

  return (
    <div className="space-y-5">
      <CentreHeader title={t('Recent activity')} subtitle={t('Reports as officers file them, newest first. Open one to read it in full.')} active="activity" />

      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {PERIODS.map((p) => (
            <Link key={p.label} href={`${BASE}${reportQueryString({ form: f.form }, { period: p.id ?? 'all' })}`} {...chip(f.period === p.id)}>
              {p.label}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`${BASE}${reportQueryString({}, period)}`} {...chip(!f.form, '#94a3b8')}>{t('Every form')}</Link>
          {REPORT_KINDS.map((k) => (
            <Link key={k.id} href={`${BASE}${reportQueryString({ form: k.id }, period)}`} {...chip(f.form === k.id, k.tone)}>
              <span className="font-mono">{k.code}</span> {k.label}
            </Link>
          ))}
        </div>
      </div>

      {records.length === 0 ? <NoReports /> : shown.length === 0 ? (
        <p className="frost rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{t('No reports in this view.')}</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {t('{length} report{value}{value2}.', { length: shown.length, value: shown.length === 1 ? '' : 's', value2: shown.length > SHOWN ? `, the latest ${SHOWN} shown` : '' })}</p>
          <ul className="space-y-2">{shown.slice(0, SHOWN).map((r) => <ActivityRow key={r.id} r={r} />)}</ul>
          {shown.length > SHOWN ? (
            <Link href={`${POLICE_REPORTS_PATH}/records${reportQueryString(f)}`} className="inline-block text-sm font-semibold text-accent hover:underline">
              {t('See them all in Records')}</Link>
          ) : null}
        </>
      )}
    </div>
  );
}
