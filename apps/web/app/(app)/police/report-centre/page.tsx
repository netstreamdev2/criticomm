import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { filterReports, reportStats } from '@criticom/api';
import { POLICE_REPORTS_PATH } from '@criticom/db';
import { loadReportCentre } from '@/lib/police-reports';
import { CENTRE_PAGES, CentreHeader } from './parts';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Police Reports · HikTech' };

/** Reports, from the sidebar: a tile for each page and each form, in its colour, with live counts. */
export default async function ReportCentrePage() {
  const { t } = await requestT();
  const { records } = await loadReportCentre();
  const stats = reportStats(records);
  const weekKinds = reportStats(filterReports(records, { period: 'week' })).byKind;
  const pageCount: Record<string, string> = {
    management: `${stats.total} reports`,
    activity: `${stats.thisWeek} this week`,
    records: `${stats.total} on record`,
    specialised: 'Build your own',
  };

  return (
    <div className="space-y-6">
      <CentreHeader title={t('Police reports')} subtitle={t('Every report officers file, colour-coded by form. Choose where to go.')} />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {CENTRE_PAGES.map((p) => (
          <Link
            key={p.id}
            href={p.href}
            className="group relative overflow-hidden frost rounded-xl border p-5 transition-transform hover:-translate-y-0.5"
            style={{ borderColor: `${p.tone}66`, backgroundImage: `linear-gradient(135deg, ${p.tone}2e, transparent 75%)` }}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-lg text-white" style={{ backgroundColor: p.tone }}>
              <p.icon className="h-5 w-5" aria-hidden />
            </span>
            <p className="mt-3 text-base font-bold">{p.label}</p>
            <p className="text-sm text-muted-foreground">{p.blurb}</p>
            <p className="mt-3 flex items-center justify-between text-sm font-semibold" style={{ color: p.tone }}>
              {pageCount[p.id]}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </p>
          </Link>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">{t('Reports by form')}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {stats.byKind.map((k) => {
            const week = weekKinds.find((w) => w.id === k.id)?.count ?? 0;
            return (
              <Link
                key={k.id}
                href={`${POLICE_REPORTS_PATH}/records?form=${k.id}`}
                className="frost group rounded-xl border p-4 transition-colors hover:bg-bg-soft/80"
                style={{ borderColor: `${k.tone}55`, borderTop: `4px solid ${k.tone}` }}
              >
                <div className="flex items-start justify-between gap-2">
                  <span
                    className="rounded px-2 py-0.5 font-mono text-xs font-bold"
                    style={{ backgroundColor: `${k.tone}22`, color: k.tone, boxShadow: `inset 0 0 0 1px ${k.tone}66` }}
                  >
                    {k.code}
                  </span>
                  <span className="text-2xl font-bold tabular-nums" style={{ color: k.tone }}>{k.count}</span>
                </div>
                <p className="mt-2 font-semibold">{k.label}</p>
                <p className="text-xs text-muted-foreground">
                  {t('{week} this week · {reviewed} reviewed · {awaiting} awaiting', { week, reviewed: k.reviewed, awaiting: k.awaiting })}</p>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
