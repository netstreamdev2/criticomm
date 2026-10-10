'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { addRestock, createPcr, getPcr, logAudit, updatePcr, updatePcrNested } from '@criticom/api';
import { validatePcr } from '@criticom/db/pcr';
import { answersFrom, recordFrom } from '@/lib/pcr-record';
import { getSession } from '@/lib/session';

const message = (e: unknown) => (e as { message?: string })?.message ?? 'The report was not saved.';

/** A PCR entered on the console (V4's "New Manual Entry"), not tied to a call. */
export async function createPcrAction(formData: FormData): Promise<{ error: string } | undefined> {
  const { supabase, fullName } = await getSession();
  const answers = answersFrom(formData);
  const problems = validatePcr(answers);
  if (problems.length) return { error: problems.join(' ') };
  const r = recordFrom(answers);
  let id: string;
  try {
    const pcr = await createPcr(supabase, r.row, { vitals: r.vitals, interventions: r.interventions, medical_history: r.medical_history });
    id = pcr.id;
    await logAudit(supabase, {
      silo: 'Medical', action_type: 'PCRCreated', entity_type: 'paramedic_report',
      entity_id: pcr.id, user_name: fullName, details: pcr.chief_complaint ?? undefined,
    });
  } catch (e) {
    return { error: message(e) };
  }
  revalidatePath('/medical/pcr');
  redirect(`/medical/pcr/${id}`);
}

/** Corrections to a PCR, until its case is closed (0063 holds that rule). */
export async function updatePcrAction(formData: FormData): Promise<{ error: string } | undefined> {
  const { supabase, fullName } = await getSession();
  const id = String(formData.get('pcr_id'));
  const answers = answersFrom(formData);
  const problems = validatePcr(answers);
  if (problems.length) return { error: problems.join(' ') };
  const r = recordFrom(answers);
  try {
    const current = await getPcr(supabase, id);
    await updatePcr(supabase, id, r.row);
    await updatePcrNested(supabase, {
      vitals_id: current.vitals_id, interventions_id: current.interventions_id, medical_history_id: current.medical_history_id,
    }, { vitals: r.vitals, interventions: r.interventions, medical_history: r.medical_history });
    await logAudit(supabase, {
      silo: 'Medical', action_type: 'PCRUpdated', entity_type: 'paramedic_report',
      entity_id: id, user_name: fullName,
    });
  } catch (e) {
    return { error: message(e) };
  }
  revalidatePath(`/medical/pcr/${id}`);
  redirect(`/medical/pcr/${id}`);
}

export async function addRestockAction(formData: FormData) {
  const { supabase, fullName } = await getSession();
  await addRestock(supabase, {
    unit_id: String(formData.get('unit_id')),
    drug_name: String(formData.get('drug_name')),
    qty_used: Number(formData.get('qty_used')) || 0,
    qty_remaining: Number(formData.get('qty_remaining')) || 0,
    last_checked_by: fullName,
  });
  revalidatePath('/medical/restock');
}
