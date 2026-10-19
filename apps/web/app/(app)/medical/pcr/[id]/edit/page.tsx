import { notFound } from 'next/navigation';
import { getPcr } from '@criticom/api';
import { getSession } from '@/lib/session';
import { defaultsFrom } from '@/lib/pcr-record';
import { formatSaTime } from '@/lib/utils';
import { PcrFormSections } from '../../pcr-form';
import { PcrFormShell } from '../../pcr-form-shell';
import { updatePcrAction } from '../../../actions';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Edit PCR · HikTech' };

export default async function EditPcrPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await requestT();
  const { id } = await params;
  const { supabase, role } = await getSession();
  // The receiving doctor reads reports; the crew corrects them.
  if (role === 'Doctor') notFound();
  const pcr = await getPcr(supabase, id).catch(() => null);
  if (!pcr) notFound();

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">{t('Edit {value} · {value2}', { value: pcr.report_number ?? 'PCR', value2: pcr.patient_name ?? 'Unknown patient' })}</h1>
      </header>
      <PcrFormShell action={updatePcrAction} submitLabel="Save changes">
        <input type="hidden" name="pcr_id" value={pcr.id} />
        <PcrFormSections
          d={defaultsFrom(pcr as unknown as Parameters<typeof defaultsFrom>[0])}
          timeOnScene={pcr.time_of_arrival ? formatSaTime(pcr.time_of_arrival) : null}
        />
      </PcrFormShell>
    </div>
  );
}
