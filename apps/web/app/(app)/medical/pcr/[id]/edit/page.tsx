import { notFound } from 'next/navigation';
import { getPcr } from '@criticom/api';
import { getSession } from '@/lib/session';
import { PcrFormSections, type PcrDefaults } from '../../pcr-form';
import { updatePcrAction } from '../../../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Edit PCR · Criticom' };

export default async function EditPcrPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await getSession();
  const pcr = await getPcr(supabase, id).catch(() => null);
  if (!pcr) notFound();

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Edit PCR — {pcr.patient_name ?? 'Unknown patient'}</h1>
        <p className="text-muted-foreground">PCRs are editable until the linked incident closes.</p>
      </header>

      <form action={updatePcrAction} className="space-y-4">
        <input type="hidden" name="pcr_id" value={pcr.id} />
        <PcrFormSections d={pcr as unknown as PcrDefaults} />
        <button type="submit" className="h-11 w-full rounded-md bg-primary text-sm font-semibold">
          Save changes
        </button>
      </form>
    </div>
  );
}
