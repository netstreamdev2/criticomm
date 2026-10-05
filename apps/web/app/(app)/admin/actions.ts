'use server';

import { revalidatePath } from 'next/cache';
import { createApparatus, updateApparatus, createDevice, logAudit } from '@criticom/api';
import { ADMIN_ROLES, type ApparatusStatus, type Silo } from '@criticom/db';
import { getSession } from '@/lib/session';

async function requireAdmin() {
  const session = await getSession();
  if (!ADMIN_ROLES.includes(session.role)) throw new Error('Forbidden');
  return session;
}

export async function createApparatusAction(formData: FormData) {
  const { supabase, fullName } = await requireAdmin();
  const v = await createApparatus(supabase, {
    silo: String(formData.get('silo')) as Silo,
    unit_number: String(formData.get('unit_number')),
    name: String(formData.get('name')),
    type: String(formData.get('type')),
    make: String(formData.get('make') ?? '') || null,
    model: String(formData.get('model') ?? '') || null,
    license_plate: String(formData.get('license_plate') ?? '') || null,
    station_number: String(formData.get('station_number') ?? '') || null,
  });
  await logAudit(supabase, {
    silo: v.silo, action_type: 'VehicleAdded', entity_type: 'apparatus', entity_id: v.id,
    user_name: fullName, details: v.unit_number,
  });
  revalidatePath('/admin/vehicles');
}

export async function setApparatusStatusAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  await updateApparatus(supabase, String(formData.get('id')), {
    status: String(formData.get('status')) as ApparatusStatus,
  });
  revalidatePath('/admin/vehicles');
}

export async function createDeviceAction(formData: FormData) {
  const { supabase } = await requireAdmin();
  await createDevice(supabase, {
    silo: String(formData.get('silo')) as Silo,
    device_id: String(formData.get('device_id')),
    device_type: String(formData.get('device_type') ?? '') || null,
    model: String(formData.get('model') ?? '') || null,
    assigned_station: String(formData.get('assigned_station') ?? '') || null,
  });
  revalidatePath('/admin/devices');
}
