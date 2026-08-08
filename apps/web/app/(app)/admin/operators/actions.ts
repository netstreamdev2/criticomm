'use server';

import { revalidatePath } from 'next/cache';
import { createSystemProfile, generateCallSign, logAudit } from '@criticom/api';
import { ADMIN_CONSOLE_ROLES } from '@criticom/db';
import { getSession } from '@/lib/session';

export async function createOperatorAction(formData: FormData) {
  const session = await getSession();
  if (!ADMIN_CONSOLE_ROLES.includes(session.role)) throw new Error('Forbidden');
  const S = (k: string) => String(formData.get(k) ?? '').trim() || null;

  const first = String(formData.get('first_name'));
  const last = String(formData.get('last_name'));

  const op = await createSystemProfile(session.supabase, {
    first_name: first,
    last_name: last,
    badge_number: S('badge_number'),
    rank: S('rank'),
    role: S('role'),
    call_sign: generateCallSign(first, last),
    station: S('station'),
    platoon: S('platoon'),
    contact_number: S('contact_number'),
    email: S('email'),
    emergency_contact: S('emergency_contact'),
  });
  await logAudit(session.supabase, {
    silo: 'Ethekwini', action_type: 'OperatorProfileCreated', entity_type: 'system_profile',
    entity_id: op.id, user_name: session.fullName, details: `${first} ${last} — ${op.call_sign}`,
  });
  revalidatePath('/admin/operators');
}
