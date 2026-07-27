'use server';

import { revalidatePath } from 'next/cache';
import { addTrainingRecord, addCertification } from '@criticom/api';
import { getSession } from '@/lib/session';

export async function addTrainingAction(formData: FormData) {
  const { supabase, silo } = await getSession();
  await addTrainingRecord(supabase, {
    silo: silo === 'Ethekwini' ? 'MetroPolice' : silo,
    personnel_id: String(formData.get('personnel_id')),
    training_name: String(formData.get('training_name')),
    date_completed: String(formData.get('date_completed')),
    notes_learned: String(formData.get('notes_learned') ?? '') || null,
  });
  revalidatePath('/training');
}

export async function addCertificationAction(formData: FormData) {
  const { supabase, silo } = await getSession();
  await addCertification(supabase, {
    silo: silo === 'Ethekwini' ? 'MetroPolice' : silo,
    personnel_id: String(formData.get('personnel_id')),
    name: String(formData.get('name')),
    expiry_date: String(formData.get('expiry_date')),
    issued_by: String(formData.get('issued_by') ?? '') || null,
    date_achieved: String(formData.get('date_achieved') ?? '') || null,
    remarks: String(formData.get('remarks') ?? '') || null,
  });
  revalidatePath('/training');
}
