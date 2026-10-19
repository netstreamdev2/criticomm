import Link from 'next/link';
import { listAllIncidents, listReportTemplates, getIncidentCategoryTree } from '@criticom/api';
import type { IncidentStatus, Silo } from '@criticom/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession, siloFilter } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';
import { saveTemplateAction } from './actions';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Report Hub · HikTech' };

const STATUSES: IncidentStatus[] = [
  'New', 'Pending', 'Pending Dispatch', 'Dispatched', 'En Route', 'Arrived',
  'On Scene', 'Transporting', 'Active', 'Closed', 'Resolved',
];
const SILOS: Silo[] = ['MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster'];
const REGIONS = ['Central', 'North', 'South', 'West', 'Outer'];

type Search = {
  q?: string; status?: string; silo?: string; category?: string; region?: string; from?: string; to?: string;
};

export default async function ReportHubPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { t } = await requestT();
  const { supabase, silo, userId } = await getSession();
  const params = await searchParams;

  const [rows, templates, catTree] = await Promise.all([
    listAllIncidents(supabase, {
      silo: (params.silo as Silo) || siloFilter(silo),
      status: params.status as IncidentStatus | undefined,
      search: params.q,
      limit: 1000,
    }),
    listReportTemplates(supabase, userId).catch(() => []),
    getIncidentCategoryTree(supabase).catch(() => []),
  ]);

  // Client-unavailable filters (category/region/date) applied here.
  const filtered = rows.filter((r) => {
    if (params.category && r.incident_category !== params.category) return false;
    if (params.region && r.region !== params.region) return false;
    if (params.from && r.incident_created_at < params.from) return false;
    if (params.to && r.incident_created_at > `${params.to}T23:59:59`) return false;
    return true;
  });

  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v) as [string, string][],
  ).toString();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('Report hub')}</h1>
          <p className="text-muted-foreground">{t('Advanced incident reporting with filters, exports and saved templates.')}</p>
        </div>
        <a
          href={`/api/report-hub/export.csv${qs ? `?${qs}` : ''}`}
          className="rounded-md border border-border px-4 py-2 text-sm font-semibold hover:bg-muted"
        >
          {t('⬇ Export CSV')}</a>
      </header>

      {templates.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t('Saved templates:')}</span>
          {templates.map((t) => {
            const payload = JSON.parse(t.detail2 ?? '{}') as Record<string, string>;
            const tqs = new URLSearchParams(Object.entries(payload).filter(([, v]) => v) as [string, string][]).toString();
            return (
              <Link key={t.id} href={`/report-hub?${tqs}`} className="rounded-md border border-border bg-bg-soft px-3 py-1 hover:bg-muted">
                {t.name}
              </Link>
            );
          })}
        </div>
      )}

      <form method="get" className="grid gap-3 rounded-lg border border-border bg-bg-card p-4 sm:grid-cols-3 lg:grid-cols-4">
        <div>
          <label className="text-xs uppercase text-muted-foreground" htmlFor="q">{t('Search')}</label>
          <input id="q" name="q" defaultValue={params.q} placeholder={t('Incident #, caller, address')} className="mt-1 block h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm" />
        </div>
        <div>
          <label className="text-xs uppercase text-muted-foreground" htmlFor="status">{t('Status')}</label>
          <select id="status" name="status" defaultValue={params.status ?? ''} className="mt-1 block h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm">
            <option value="">{t('All')}</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        {silo === 'Ethekwini' && (
          <div>
            <label className="text-xs uppercase text-muted-foreground" htmlFor="silo">{t('Department')}</label>
            <select id="silo" name="silo" defaultValue={params.silo ?? ''} className="mt-1 block h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm">
              <option value="">{t('All')}</option>
              {SILOS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="text-xs uppercase text-muted-foreground" htmlFor="category">{t('Category')}</label>
          <select id="category" name="category" defaultValue={params.category ?? ''} className="mt-1 block h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm">
            <option value="">{t('All')}</option>
            {catTree.map((g) => <option key={g.id} value={g.name}>{g.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs uppercase text-muted-foreground" htmlFor="region">{t('Region')}</label>
          <select id="region" name="region" defaultValue={params.region ?? ''} className="mt-1 block h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm">
            <option value="">{t('All')}</option>
            {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs uppercase text-muted-foreground" htmlFor="from">{t('From')}</label>
          <input id="from" name="from" type="date" defaultValue={params.from} className="mt-1 block h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm" />
        </div>
        <div>
          <label className="text-xs uppercase text-muted-foreground" htmlFor="to">{t('To')}</label>
          <input id="to" name="to" type="date" defaultValue={params.to} className="mt-1 block h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm" />
        </div>
        <div className="flex items-end">
          <button type="submit" className="h-10 w-full rounded-md bg-primary text-sm font-semibold">{t('Run report')}</button>
        </div>
      </form>

      <form action={saveTemplateAction} className="flex flex-wrap items-end gap-2">
        {(['q', 'status', 'silo', 'category', 'region', 'from', 'to'] as const).map((k) => (
          <input key={k} type="hidden" name={k} value={params[k] ?? ''} />
        ))}
        <input name="name" placeholder={t('Save current filters as…')} className="h-9 w-56 rounded-md border border-border bg-bg-soft px-3 text-sm" />
        <button type="submit" className="h-9 rounded-md bg-accent px-3 text-sm font-semibold">{t('Save template')}</button>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>{t('{length} incidents', { length: filtered.length })}</CardTitle>
          <CardDescription>{t('Matching the current filters.')}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable
            headers={['Incident #', 'Date', 'Silo', 'Category', 'Type', 'Region', 'Severity', 'Status', 'Operator', '']}
            empty={t('No incidents match your filters.')}
          >
            {filtered.slice(0, 300).map((i) => (
              <Tr key={i.id}>
                <Td className="font-mono">{i.incident_number}</Td>
                <Td className="text-muted-foreground">{formatSaTime(i.incident_created_at)}</Td>
                <Td>{i.silo}</Td>
                <Td>{i.incident_category ?? '—'}</Td>
                <Td>{i.incident_type}</Td>
                <Td>{i.region ?? '—'}</Td>
                <Td><span className="severity-pill" data-sev={i.incident_severity}>{i.incident_severity}</span></Td>
                <Td>{i.status}</Td>
                <Td>{i.call_taken_by ?? '—'}</Td>
                <Td><Link href={`/incidents/${i.id}`} className="text-accent hover:underline">{t('Open')}</Link></Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
