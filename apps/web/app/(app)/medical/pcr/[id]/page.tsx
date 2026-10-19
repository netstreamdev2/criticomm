import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPcr } from '@criticom/api';
import { PcrCard } from '@/components/pcr-card';
import { getSession } from '@/lib/session';
import { PrintButton } from '@/app/(app)/roster/duty-sheet/print-button';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'PCR · HikTech' };

export default async function PcrDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await requestT();
  const { id } = await params;
  const { supabase, role } = await getSession();
  const p = await getPcr(supabase, id).catch(() => null);
  if (!p) notFound();
  // A closed case's report is locked (0063).
  const closed = p.incident_id
    ? (await supabase.from('incidents').select('status').eq('id', p.incident_id).maybeSingle()).data?.status === 'Closed'
    : false;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-bold">{p.patient_name ?? 'Unknown patient'}</h1>
          {p.incident_id ? (
            <Link href={`/incidents/${p.incident_id}`} className="text-sm text-accent hover:underline">{t('Open the incident')}</Link>
          ) : <p className="text-sm text-muted-foreground">{t('Manual entry')}</p>}
        </div>
        <div className="flex items-center gap-2">
          <PrintButton />
          {closed || role === 'Doctor' ? null : (
            <Link href={`/medical/pcr/${p.id}/edit`} className="inline-flex h-10 items-center rounded-md bg-accent px-4 text-sm font-semibold">
              {t('Edit PCR')}</Link>
          )}
        </div>
      </header>
      <PcrCard pcr={p as unknown as Parameters<typeof PcrCard>[0]['pcr']} />
    </div>
  );
}
