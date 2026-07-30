'use server';

import { revalidatePath } from 'next/cache';
import {
  createLeaveEntry, inclusiveDays, logAudit, raiseAlert, setLeaveStatusWithTrail,
} from '@criticom/api';
import { ADMIN_ROLES } from '@criticom/db';
import { getSession } from '@/lib/session';

export async function applyLeaveAction(formData: FormData) {
  const { supabase, silo, userId, fullName } = await getSession();
  const from = String(formData.get('eff_from'));
  const to = String(formData.get('eff_to'));
  if (!from || !to || inclusiveDays(from, to) === 0) return;

  await createLeaveEntry(supabase, {
    silo: silo === 'Ethekwini' ? 'MetroPolice' : silo,
    user_id: userId,
    rank: String(formData.get('rank') ?? '') || null,
    service_no: String(formData.get('service_no') ?? '') || null,
    eff_from: from,
    eff_to: to,
    absence: String(formData.get('absence')),
    reason: String(formData.get('reason') ?? '').trim() || null,
    status: 'Pending',
  });
  await logAudit(supabase, {
    silo: silo === 'Ethekwini' ? 'MetroPolice' : silo,
    action_type: 'LeaveRequested', entity_type: 'leave_entry',
    user_name: fullName, details: `${formData.get('absence')} ${from} → ${to}`,
  }).catch(() => {});
  revalidatePath('/leave');
  revalidatePath('/hr');
}

export async function setLeaveStatusAction(formData: FormData) {
  const { supabase, role, fullName } = await getSession();
  if (!ADMIN_ROLES.includes(role) && role !== 'Supervisor') return;

  const entry = await setLeaveStatusWithTrail(supabase, {
    id: String(formData.get('id')),
    status: String(formData.get('status')) as 'Approved' | 'Rejected',
    byName: fullName,
  });

  await logAudit(supabase, {
    silo: entry.silo, action_type: `Leave${entry.status}`, entity_type: 'leave_entry',
    entity_id: entry.id, user_name: fullName,
    details: `${entry.absence ?? 'Leave'} ${entry.eff_from} → ${entry.eff_to}`,
  }).catch(() => {});

  // Tell the member the moment the decision lands.
  if (entry.user_id) {
    await raiseAlert(supabase, {
      silo: entry.silo,
      targetUserId: entry.user_id,
      kind: 'info',
      severity: 'Low',
      title: `Leave ${entry.status.toLowerCase()}`,
      body: `${entry.absence ?? 'Leave'} ${entry.eff_from} → ${entry.eff_to} · by ${fullName}`,
      link: '/leave',
      createdByName: fullName,
    }).catch(() => {});
  }

  revalidatePath('/leave');
  revalidatePath('/hr');
}
