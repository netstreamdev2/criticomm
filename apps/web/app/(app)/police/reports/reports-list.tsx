import Link from 'next/link';
import { Search } from 'lucide-react';
import { listPoliceReports, POLICE_REPORT_FORMS, type PoliceReportFilters } from '@criticom/api';
import { FormCodes } from '@/components/report-form-chips';
import { Card, CardContent } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession } from '@/lib/session';
import { chatTime } from '@/lib/when';
import { requestT } from '@/lib/i18n';

export type ReportsParams = { q?: string; form?: string; from?: string; to?: string; officer?: string; arrest?: string };

const field = 'h-9 rounded-md border border-border bg-bg-soft px-2.5 text-sm';

/** The police records, one kind at a time, with their filters. */
export async function ReportsList({ kind, params, basePath }: {
  kind: PoliceReportFilters['kind'];
  params: ReportsParams;
  basePath: string;
}) {
  const { t } = await requestT();
  const { supabase } = await getSession();
  const arrest = params.arrest === 'Yes' || params.arrest === 'No' ? params.arrest : null;
  const reports = await listPoliceReports(supabase, {
    kind, q: params.q, form: params.form, from: params.from, to: params.to, officer: params.officer, arrest,
  });
  const filtered = Boolean(params.q || params.form || params.from || params.to || params.officer || arrest);
  const now = new Date();

  return (
    <>
      <form method="get" className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-bg-card px-3 py-2.5">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <label htmlFor="q" className="sr-only">{t('Search reports')}</label>
          <input id="q" name="q" defaultValue={params.q} placeholder={t('Search case #, location, suspect, charges')}
            className={`${field} w-full pl-8`} />
        </div>
        <label className="text-xs text-muted-foreground">
          <span className="sr-only">{t('Form')}</span>
          <select name="form" defaultValue={params.form ?? ''} className={field} aria-label={t('Form')}>
            <option value="">{t('All forms')}</option>
            {POLICE_REPORT_FORMS.map((f) => <option key={f.id} value={f.id}>{f.code} · {f.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col text-xs text-muted-foreground">
          {t('From')}<input type="date" name="from" defaultValue={params.from} className={field} />
        </label>
        <label className="flex flex-col text-xs text-muted-foreground">
          {t('To')}<input type="date" name="to" defaultValue={params.to} className={field} />
        </label>
        <label className="text-xs text-muted-foreground">
          <span className="sr-only">{t('Officer')}</span>
          <input name="officer" defaultValue={params.officer} placeholder={t('Officer')} className={`${field} w-36`} aria-label={t('Officer')} />
        </label>
        <label className="text-xs text-muted-foreground">
          <span className="sr-only">{t('Arrest')}</span>
          <select name="arrest" defaultValue={arrest ?? ''} className={field} aria-label={t('Arrest')}>
            <option value="">{t('Arrest: any')}</option>
            <option value="Yes">{t('Arrest made')}</option>
            <option value="No">{t('No arrest')}</option>
          </select>
        </label>
        <button type="submit" className="h-9 rounded-md bg-accent px-4 text-sm font-semibold">{t('Apply')}</button>
        {filtered ? <Link href={basePath} className="self-center text-sm text-accent hover:underline">{t('Clear')}</Link> : null}
      </form>

      <Card>
        <CardContent className="p-0">
          <div className="border-b border-border px-4 py-2.5 text-sm text-muted-foreground">
            {t('{length} report{value}{value2}, newest first', { length: reports.length, value: reports.length === 1 ? '' : 's', value2: filtered ? ' match' : '' })}</div>
          <SimpleTable
            headers={kind === 'incident'
              ? ['Incident #', 'Forms', 'Type', 'Officer', 'Location', 'Arrest', 'Filed', '']
              : ['Case #', 'Forms', 'Date', 'Officer', 'Location', 'Arrest', 'Filed', '']}
            empty={filtered ? 'No reports match these filters.' : 'No reports filed yet.'}
          >
            {reports.map((r) => (
              <Tr key={r.id}>
                <Td className="font-mono">
                  {kind === 'incident' && r.incident_id
                    ? <Link href={`/incidents/${r.incident_id}`} className="text-accent hover:underline">{r.case_number}</Link>
                    : r.case_number}
                </Td>
                <Td><FormCodes reportType={r.report_type} fallback={r.incident_category} /></Td>
                <Td>{kind === 'incident' ? (r.incident_category ?? '—') : r.date_of_offense}</Td>
                <Td>{r.officer_name ?? '—'}</Td>
                <Td className="max-w-[220px] truncate">{r.location ?? '—'}</Td>
                <Td>{r.arrest_made === 'Yes' ? 'Yes' : 'No'}</Td>
                <Td className="whitespace-nowrap text-muted-foreground">{chatTime(r.filed_at ?? r.created_at, now)}</Td>
                <Td><Link href={`/police/reports/${r.id}`} className="text-accent hover:underline">{t('Open')}</Link></Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </>
  );
}
