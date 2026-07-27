'use server';

import { revalidatePath } from 'next/cache';
import { createShift, createRosterEntry, addEndorsement, deactivateEndorsement, logAudit } from '@criticom/api';
import type { Silo } from '@criticom/db';
import { getSession } from '@/lib/session';

export async function createShiftAction(formData: FormData) {
  const { supabase, silo, fullName } = await getSession();
  await createShift(supabase, {
    silo: silo === 'Ethekwini' ? 'MetroPolice' : silo,
    shift_name: String(formData.get('shift_name')),
    activity_type: String(formData.get('activity_type') ?? '') || null,
    start_time: String(formData.get('start_time')),
    end_time: String(formData.get('end_time')),
    description: String(formData.get('description') ?? '') || null,
    department: String(formData.get('department') ?? '') || null,
    created_by_supervisor_name: fullName,
  });
  revalidatePath('/roster');
}

export async function createRosterEntryAction(formData: FormData) {
  const { supabase, silo, userId, fullName } = await getSession();
  await createRosterEntry(supabase, {
    silo: silo === 'Ethekwini' ? 'MetroPolice' : silo,
    user_id: String(formData.get('user_id') ?? '') || userId,
    user_name: String(formData.get('user_name')),
    badge_number: String(formData.get('badge_number') ?? '') || null,
    shift_id: String(formData.get('shift_id') ?? '') || null,
    station: String(formData.get('station')),
    activity_type: String(formData.get('activity_type')),
    description: String(formData.get('description') ?? '') || null,
    call_sign: String(formData.get('call_sign') ?? '') || null,
    vehicle: String(formData.get('vehicle') ?? '') || null,
    sector: String(formData.get('sector') ?? '') || null,
    special_instructions: String(formData.get('special_instructions') ?? '') || null,
    created_by_supervisor_name: fullName,
  });
  revalidatePath('/roster');
}

export async function addEndorsementAction(formData: FormData) {
  const { supabase, silo, fullName } = await getSession();
  const rec = await addEndorsement(supabase, {
    silo: (silo === 'Ethekwini' ? 'MetroPolice' : silo) as Silo,
    user_id: String(formData.get('user_id') ?? '') || null,
    employee_name: String(formData.get('employee_name') ?? '') || null,
    badge_number: String(formData.get('badge_number') ?? '') || null,
    type: String(formData.get('type')),
    details: String(formData.get('details') ?? '') || null,
    start_date: String(formData.get('start_date')),
    end_date: String(formData.get('end_date') ?? '') || null,
    is_active: true,
    created_by: fullName,
  });
  await logAudit(supabase, {
    silo: rec.silo, action_type: 'EndorsementAdded', entity_type: 'endorsement',
    entity_id: rec.id, user_name: fullName, details: `${rec.type}: ${rec.employee_name ?? ''}`,
  });
  revalidatePath('/roster');
}

export async function deactivateEndorsementAction(formData: FormData) {
  const { supabase } = await getSession();
  await deactivateEndorsement(supabase, String(formData.get('id')));
  revalidatePath('/roster');
}
