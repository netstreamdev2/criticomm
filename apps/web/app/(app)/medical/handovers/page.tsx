/* eslint-disable @next/next/no-img-element */
import Link from 'next/link';
import { Search } from 'lucide-react';
import { listHandovers } from '@criticom/api';
import { HOSPITALS } from '@criticom/db/pcr';
import { Card, CardContent } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession } from '@/lib/session';
import { signatureSrc } from '@/lib/pcr-record';
import { formatSaTime } from '@/lib/utils';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Hospital Handovers · HikTech' };

type Params = { q?: string; hospital?: string; from?: string; to?: string };
const field = 'h-9 rounded-md border border-border bg-bg-soft px-2.5 text-sm';

/** Patients EMS handed over at the hospital, with the receiving doctor's sign-off. */
export default async function HandoversPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { t } = await requestT();
  const { supabase } = await getSession();
  const params = await searchParams;
  // Empty until migration 0064 is run.
  const rows = await listHandovers(supabase, params).catch(() => []);
  const filtered = Boolean(params.q || params.hospital || params.from || params.to);

  return (
    <div className="space-y-3">
      <header>
        <h1 className="text-2xl font-bold">{t('Hospital Handovers')}</h1>
        <p className="text-muted-foreground">{t('Patients handed over by EMS crews, newest first.')}</p>
      </header>

      <form method="get" className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-bg-card px-3 py-2.5">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input name="q" defaultValue={params.q} placeholder={t('Search doctor, hospital or condition')} aria-label={t('Search handovers')} className={`${field} w-full pl-8`} />
        </div>
        <select name="hospital" defaultValue={params.hospital ?? ''} aria-label={t('Hospital')} className={field}>
          <option value="">{t('All hospitals')}</option>
          {HOSPITALS.map((h) => <option key={h} value={h}>{h}</option>)}
        </select>
        <label className="flex flex-col text-xs text-muted-foreground">
          {t('From')}<input type="date" name="from" defaultValue={params.from} className={field} />
        </label>
        <label className="flex flex-col text-xs text-muted-foreground">
          {t('To')}<input type="date" name="to" defaultValue={params.to} className={field} />
        </label>
        <button type="submit" className="h-9 rounded-md bg-accent px-4 text-sm font-semibold">{t('Apply')}</button>
        {filtered ? <Link href="/medical/handovers" className="self-center text-sm text-accent hover:underline">{t('Clear')}</Link> : null}
      </form>

      <Card>
        <CardContent className="p-0">
          <SimpleTable
            headers={['Handed over', 'Patient', 'Hospital', 'Receiving Doctor', 'Patient Status at Handover', 'Signed', '']}
            empty={filtered ? 'No handovers match these filters.' : 'No handovers yet.'}
          >
            {rows.map((h) => {
              const sig = signatureSrc(h.signature_base64);
              return (
                <Tr key={h.id}>
                  <Td className="whitespace-nowrap text-xs">{formatSaTime(h.time_of_handover)}</Td>
                  <Td className="font-semibold">{h.pcr?.patient_name || 'Unknown Patient'}</Td>
                  <Td>{h.receiving_hosp}</Td>
                  <Td>{h.doctor_name}</Td>
                  <Td className="max-w-[280px] whitespace-pre-wrap text-xs">{h.patient_status_at_handover ?? '—'}</Td>
                  <Td>{sig ? <img src={sig} alt={t('Doctor\'s signature')} className="h-8 w-24 rounded border border-border bg-white object-contain" /> : '—'}</Td>
                  <Td>{h.pcr ? <Link href={`/medical/pcr/${h.pcr.id}`} className="text-accent hover:underline">{h.pcr.report_number ?? 'Report'}</Link> : null}</Td>
                </Tr>
              );
            })}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
