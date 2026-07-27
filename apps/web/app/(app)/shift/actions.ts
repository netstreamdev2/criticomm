'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  submitMentalCheck, assignVehicle, submitVehicleChecklist, toggleDuty, logAudit,
} from '@criticom/api';
import { getSession } from '@/lib/session';

const BOOL = (fd: FormData, k: string) => fd.get(k) === 'on';

export async function mentalCheckAction(formData: FormData) {
  const { supabase, silo, fullName } = await getSession();
  const { passed } = await submitMentalCheck(supabase, {
    silo,
    memory_recall: BOOL(formData, 'memory_recall'),
    judgment: BOOL(formData, 'judgment'),
    situational_awareness: BOOL(formData, 'situational_awareness'),
    not_under_influence: BOOL(formData, 'not_under_influence'),
    anger_check: BOOL(formData, 'anger_check'),
    reflexes: BOOL(formData, 'reflexes'),
    comments: String(formData.get('comments') ?? ''),
  });
  await logAudit(supabase, {
    silo, action_type: 'MentalCheck', user_name: fullName,
    details: passed ? 'Passed' : 'Failed — flagged to supervisor',
  });
  // V4 ShiftController: failure → Reason page; pass → vehicle selection
  redirect(passed ? '/shift/vehicle-selection' : '/shift/reason');
}

export async function assignVehicleAction(formData: FormData) {
  const { supabase, silo, fullName } = await getSession();
  const apparatusId = String(formData.get('apparatus_id'));
  await assignVehicle(supabase, apparatusId);
  await logAudit(supabase, {
    silo, action_type: 'VehicleAssigned', entity_type: 'apparatus', entity_id: apparatusId,
    user_name: fullName,
  });
  redirect(`/shift/vehicle-checklist?apparatus=${apparatusId}`);
}

export async function vehicleChecklistAction(formData: FormData) {
  const { supabase, silo, fullName } = await getSession();
  const apparatusId = String(formData.get('apparatus_id'));
  await submitVehicleChecklist(supabase, {
    silo,
    apparatus_id: apparatusId,
    fuel_level: String(formData.get('fuel_level')) as '1/4' | '1/2' | '3/4' | 'Full',
    lights_functional: BOOL(formData, 'lights_functional'),
    tires_condition_ok: BOOL(formData, 'tires_condition_ok'),
    equipment_stocked: BOOL(formData, 'equipment_stocked'),
    comms_working: BOOL(formData, 'comms_working'),
    brakes_responsive: BOOL(formData, 'brakes_responsive'),
  });
  await toggleDuty(supabase, { onDuty: true });
  await logAudit(supabase, {
    silo, action_type: 'ShiftStarted', entity_type: 'apparatus', entity_id: apparatusId,
    user_name: fullName, details: 'Vehicle checklist complete — on duty',
  });
  revalidatePath('/responder');
  redirect('/responder');
}
