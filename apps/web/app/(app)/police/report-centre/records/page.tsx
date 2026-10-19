import Link from 'next/link';
import { Download, Plus } from 'lucide-react';
import { REPORT_KINDS, REPORT_STANDINGS, filterReports } from '@criticom/api';
import { POLICE_REPORTS_PATH, canAccess } from '@criticom/db';
import { SimpleTable, Td, Tr } from '@/components/simple-table';
import { Card, CardContent } from '@/components/ui/card';
import { loadReportCentre, readReportQuery, reportQueryString } from '@/lib/police-reports';
import { formatSaTime } from '@/lib/utils';
import { CentreHeader, NoReports, RecordForms, StandingPill } from '../parts';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Records · Police Reports · HikTech' };

const PER_PAGE = 20;
const BASE = `${POLICE_REPORTS_PATH}/records`;
const field = 'mt-1 block h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm';
const label = 'text-xs font-semibold uppercase text-muted-foreground';

/** Every police report the person may read: search, filter, page through, export, open. */
export default async function ReportRecordsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { t } = await requestT();
  const { records, role, silo } = await loadReportCentre();
  const query = readReportQuery(await searchParams);
  const shown = filterReports(records, query);
  const pages = Math.max(1, Math.ceil(shown.length / PER_PAGE));
  const page = Math.min(query.page, pages);
  const rows = shown.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const canAdd = canAccess('/police/reports/new', role, silo);

  return (
    <div className="space-y-5">
      <CentreHeader
        title={t('Records')}
        subtitle={t('Every police report. Search, filter, export, or open one to read it in full.')}
        active="records"
        actions={(
          <>
            <a
              href={`${POLICE_REPORTS_PATH}/export${reportQueryString(query)}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-bg-soft px-3 text-sm font-semibold hover:bg-bg"
            >
              <Download className="h-4 w-4" /> {' '}{t('Export CSV')}</a>
            {canAdd ? (
              <Link href="/police/reports/new" className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-semibold">
                <Plus className="h-4 w-4" /> {' '}{t('Add record')}</Link>
            ) : null}
          </>
        )}
      />

      <form method="get" className="grid gap-3 frost rounded-xl border border-border p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <label className={label} htmlFor="q">{t('Search')}</label>
          <input id="q" name="q" defaultValue={query.q ?? ''} placeholder={t('Case number, officer, call, place, form code')} className={field} />
        </div>
        <div>
          <label className={label} htmlFor="form">{t('Form')}</label>
          <select id="form" name="form" defaultValue={query.form ?? ''} className={field}>
            <option value="">{t('Every form')}</option>
            {REPORT_KINDS.map((k) => <option key={k.id} value={k.id}>{k.code} · {k.label}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="standing">{t('Status')}</label>
          <select id="standing" name="standing" defaultValue={query.standing ?? ''} className={field}>
            <option value="">{t('Any')}</option>
            {REPORT_STANDINGS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="period">{t('Period')}</label>
          <select id="period" name="period" defaultValue={query.period ?? ''} className={field}>
            <option value="">{t('Any time')}</option>
            <option value="today">{t('Today')}</option>
            <option value="week">{t('Last 7 days')}</option>
            <option value="month">{t('Last 30 days')}</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="from">{t('From')}</label>
          <input id="from" name="from" type="date" defaultValue={query.from ?? ''} className={field} />
        </div>
        <div>
          <label className={label} htmlFor="to">{t('To')}</label>
          <input id="to" name="to" type="date" defaultValue={query.to ?? ''} className={field} />
        </div>
        <div className="flex items-end gap-2">
          <button type="submit" className="h-10 flex-1 rounded-md bg-primary text-sm font-semibold">{t('Search')}</button>
          <Link href={BASE} className="flex h-10 items-center rounded-md border border-border px-3 text-sm">{t('Clear')}</Link>
        </div>
      </form>

      {records.length === 0 ? <NoReports /> : (
        <Card className="frost">
          <CardContent className="p-0">
            <p className="border-b border-border px-4 py-3 text-sm text-muted-foreground">
              {t('{length} record{value}{value2}', { length: shown.length, value: shown.length === 1 ? '' : 's', value2: shown.length > PER_PAGE ? ` · page ${page} of ${pages}` : '' })}
            </p>
            <SimpleTable
              headers={['Case number', 'Forms', 'Officer', 'Station', 'Dispatcher', 'Call', 'Filed', 'Status', '']}
              empty={t('No records match your search.')}
            >
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td className="font-mono font-semibold">{r.caseNumber}</Td>
                  <Td><RecordForms record={r} /></Td>
                  <Td>{r.officer ?? '—'}{r.badge ? <span className="block text-xs text-muted-foreground">{r.badge}</span> : null}</Td>
                  <Td>{r.station ?? '—'}</Td>
                  <Td>{r.dispatcher ?? '—'}</Td>
                  <Td className="font-mono text-xs">{r.incidentNumber ?? '—'}</Td>
                  <Td className="whitespace-nowrap text-xs">{formatSaTime(r.at)}</Td>
                  <Td><StandingPill standing={r.standing} /></Td>
                  <Td><Link href={`${POLICE_REPORTS_PATH}/report/${r.id}`} className="font-semibold text-accent hover:underline">{t('View')}</Link></Td>
                </Tr>
              ))}
            </SimpleTable>
            {pages > 1 ? (
              <nav className="flex items-center justify-between border-t border-border px-4 py-3 text-sm" aria-label={t('Pages')}>
                {page > 1
                  ? <Link href={`${BASE}${reportQueryString(query, { page: page - 1 })}`} className="font-semibold text-accent hover:underline">{t('← Previous')}</Link>
                  : <span />}
                <span className="text-muted-foreground">{t('Page {page} of {pages}', { page, pages })}</span>
                {page < pages
                  ? <Link href={`${BASE}${reportQueryString(query, { page: page + 1 })}`} className="font-semibold text-accent hover:underline">{t('Next →')}</Link>
                  : <span />}
              </nav>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
