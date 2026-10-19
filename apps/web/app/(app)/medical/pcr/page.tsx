import Link from 'next/link';
import { Search } from 'lucide-react';
import { listPcrs } from '@criticom/api';
import { CARE_LEVELS, HOSPITALS } from '@criticom/db/pcr';
import { Card, CardContent } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Clinical Archive · HikTech' };

type Params = { q?: string; care?: string; hospital?: string; from?: string; to?: string };
const field = 'h-9 rounded-md border border-border bg-bg-soft px-2.5 text-sm';

export default async function PcrListPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { t } = await requestT();
  const { supabase, role } = await getSession();
  const params = await searchParams;
  const pcrs = await listPcrs(supabase, params);
  const filtered = Boolean(params.q || params.care || params.hospital || params.from || params.to);

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('Clinical Archive')}</h1>
          <p className="text-muted-foreground">{t('Patient care reports, newest first.')}</p>
        </div>
        {role === 'Doctor' ? null : (
          <Link href="/medical/pcr/new" className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold">
            {t('+ New Manual Entry')}</Link>
        )}
      </header>

      <form method="get" className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-bg-card px-3 py-2.5">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input name="q" defaultValue={params.q} placeholder={t('Search patient, incident ref, complaint, crew')} aria-label={t('Search reports')} className={`${field} w-full pl-8`} />
        </div>
        <select name="care" defaultValue={params.care ?? ''} aria-label={t('Care level')} className={field}>
          <option value="">{t('All care levels')}</option>
          {CARE_LEVELS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select name="hospital" defaultValue={params.hospital ?? ''} aria-label={t('Destination')} className={field}>
          <option value="">{t('All destinations')}</option>
          {HOSPITALS.map((h) => <option key={h} value={h}>{h}</option>)}
        </select>
        <label className="flex flex-col text-xs text-muted-foreground">
          {t('From')}<input type="date" name="from" defaultValue={params.from} className={field} />
        </label>
        <label className="flex flex-col text-xs text-muted-foreground">
          {t('To')}<input type="date" name="to" defaultValue={params.to} className={field} />
        </label>
        <button type="submit" className="h-9 rounded-md bg-accent px-4 text-sm font-semibold">{t('Apply')}</button>
        {filtered ? <Link href="/medical/pcr" className="self-center text-sm text-accent hover:underline">{t('Clear')}</Link> : null}
      </form>

      <Card>
        <CardContent className="p-0">
          <SimpleTable
            headers={['Incident Ref', 'Patient Name', 'Arrival Time', 'Destination', 'Care Level', 'Paramedic(s)', '']}
            empty={filtered ? 'No reports match these filters.' : 'No clinical records found in the archive.'}
          >
            {pcrs.map((p) => (
              <Tr key={p.id}>
                <Td className="font-mono text-xs">
                  {p.incident_id
                    ? <Link href={`/incidents/${p.incident_id}`} className="text-accent hover:underline">{p.report_number ?? 'Incident'}</Link>
                    : 'Manual entry'}
                </Td>
                <Td className="font-semibold">{p.patient_name || 'Unknown Patient'}</Td>
                <Td className="text-xs">{p.time_of_arrival ? formatSaTime(p.time_of_arrival) : 'Time Not Logged'}</Td>
                <Td>{p.destination_hospital ?? <span className="text-xs text-muted-foreground">{t('Not Transported')}</span>}</Td>
                <Td>
                  <span className={p.level_of_care === 'ALS' ? 'font-semibold text-severity-critical-ink' : p.level_of_care === 'ILS' ? 'font-semibold text-severity-medium-ink' : 'font-semibold text-severity-low-ink'}>
                    {p.level_of_care ?? '—'}
                  </span>
                </Td>
                <Td className="text-xs">{p.paramedic_names ?? '—'}</Td>
                <Td><Link href={`/medical/pcr/${p.id}`} className="text-accent hover:underline">{t('Open')}</Link></Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
