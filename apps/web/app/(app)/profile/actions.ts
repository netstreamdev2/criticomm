'use server';

import { revalidatePath } from 'next/cache';
import { updateProfile, generateCallSign } from '@criticom/api';
import { getSession } from '@/lib/session';

export async function updateProfileAction(formData: FormData) {
  const { supabase, userId } = await getSession();
  const S = (k: string) => String(formData.get(k) ?? '').trim() || null;

  await updateProfile(supabase, userId, {
    full_name: S('full_name'),
    badge_number: S('badge_number'),
    rank: S('rank'),
    station: S('station'),
    platoon: S('platoon'),
    contact_number: S('contact_number'),
    emergency_contact: S('emergency_contact'),
    notes: S('notes'),
  });
  // Keep the auth display name in sync
  const fullName = S('full_name');
  if (fullName) await supabase.auth.updateUser({ data: { full_name: fullName } });
  revalidatePath('/profile');
}

export async function generateCallSignAction(formData: FormData) {
  const { supabase, userId } = await getSession();
  const first = String(formData.get('first_name') ?? 'X');
  const last = String(formData.get('last_name') ?? 'X');
  await updateProfile(supabase, userId, { call_sign: generateCallSign(first, last) });
  revalidatePath('/profile');
}
