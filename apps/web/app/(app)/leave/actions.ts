'use server';

import { revalidatePath } from 'next/cache';
import { createLeaveEntry, setLeaveStatus } from '@criticom/api';
import { ADMIN_ROLES } from '@criticom/db';
import { getSession } from '@/lib/session';

export async function applyLeaveAction(formData: FormData) {
  const { supabase, silo, userId } = await getSession();
  await createLeaveEntry(supabase, {
    silo: silo === 'Ethekwini' ? 'MetroPolice' : silo,
    user_id: userId,
    rank: String(formData.get('rank') ?? '') || null,
    service_no: String(formData.get('service_no') ?? '') || null,
    eff_from: String(formData.get('eff_from')),
    eff_to: String(formData.get('eff_to')),
    absence: String(formData.get('absence')),
    status: 'Pending',
  });
  revalidatePath('/leave');
}

export async function setLeaveStatusAction(formData: FormData) {
  const { supabase, role } = await getSession();
  if (!ADMIN_ROLES.includes(role) && role !== 'Supervisor') return;
  await setLeaveStatus(supabase, {
    id: String(formData.get('id')),
    status: String(formData.get('status')) as 'Approved' | 'Rejected',
  });
  revalidatePath('/leave');
}
