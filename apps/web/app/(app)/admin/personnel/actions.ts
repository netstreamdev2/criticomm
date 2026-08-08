'use server';

import { revalidatePath } from 'next/cache';
import { createPersonnel, logAudit } from '@criticom/api';
import { ADMIN_CONSOLE_ROLES, type Silo } from '@criticom/db';
import { getSession } from '@/lib/session';

export async function createPersonnelAction(formData: FormData) {
  const session = await getSession();
  if (!ADMIN_CONSOLE_ROLES.includes(session.role) && session.role !== 'Supervisor') throw new Error('Forbidden');
  const S = (k: string) => String(formData.get(k) ?? '').trim() || null;

  const p = await createPersonnel(session.supabase, {
    silo: String(formData.get('silo')) as Silo,
    first_name: String(formData.get('first_name')),
    last_name: String(formData.get('last_name')),
    badge_number: String(formData.get('badge_number')),
    rank: String(formData.get('rank')),
    unit: S('unit'),
    station: S('station'),
    platoon: S('platoon'),
    emergency_contact: S('emergency_contact'),
  });
  await logAudit(session.supabase, {
    silo: p.silo, action_type: 'PersonnelCreated', entity_type: 'personnel', entity_id: p.id,
    user_name: session.fullName, details: `${p.first_name} ${p.last_name} (${p.badge_number})`,
  });
  revalidatePath('/admin/personnel');
}
