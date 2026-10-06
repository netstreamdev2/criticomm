import type { CriticomClient, Database } from '@criticom/db';
import { fireChecklistError, type FireCheckKey, type FireFuelLevel } from '@criticom/db/fire-shift';
import { getMyPersonnel } from '../personnel';

export type FireAppliance = Database['public']['Tables']['apparatus']['Row'];
export type FireInspection = Database['public']['Tables']['vehicle_checklists']['Row'];

function todayStart() {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  return new Date(`${date}T00:00:00+02:00`).toISOString();
}

function checkError(error: { code?: string; message: string } | null) {
  if (!error) return;
  if (error.code === '42703' || error.code === 'PGRST204') {
    throw new Error('Fire shift checks are not available yet. Ask your administrator to apply migration 0056_fire_start_of_shift.sql, then retry.');
  }
  throw error;
}

/** Kept separate from Police's loadout so Fire does not depend on armoury/bodycam queries. */
export async function getFireShiftState(client: CriticomClient) {
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('Sign in to start your shift.');
  const [personnel, readiness, vehicle, mental, inspection] = await Promise.all([
    getMyPersonnel(client, user.id),
    client.rpc('shift_readiness_passed_today'),
    client.rpc('shift_vehicle_passed_today'),
    client.from('mental_checks').select('*').eq('user_id', user.id).eq('silo', 'MetroFire')
      .gte('timestamp', todayStart()).order('timestamp', { ascending: false }).order('id', { ascending: false }).limit(1).maybeSingle(),
    // Naming one new column also detects an unapplied migration, even for an empty register.
    client.from('vehicle_checklists').select('*, scba_checked').eq('user_id', user.id).eq('silo', 'MetroFire')
      .eq('form_version', 'fire-v1').gte('checked_at', todayStart())
      .order('checked_at', { ascending: false }).order('id', { ascending: false }).limit(1).maybeSingle(),
  ]);
  checkError(inspection.error);
  for (const res of [readiness, vehicle, mental]) if (res.error) throw res.error;
  if (!personnel || personnel.silo !== 'MetroFire') throw new Error('A Fire & Rescue personnel record must be linked to your account. Contact your administrator.');
  let appliance: FireAppliance | null = null;
  if (personnel.assigned_apparatus_id) {
    const res = await client.from('apparatus').select('*').eq('id', personnel.assigned_apparatus_id).eq('silo', 'MetroFire').single();
    if (res.error) throw res.error;
    appliance = res.data;
  }
  return { personnel, appliance, readiness: Boolean(readiness.data), vehicle: Boolean(vehicle.data), mental: mental.data, inspection: inspection.data };
}

export type FireInspectionInput = Record<FireCheckKey, boolean> & {
  apparatus_id: string;
  fuel_level: FireFuelLevel;
  fault_remarks: string;
  declaration_accepted: boolean;
  signature_svg: string;
};

export async function submitFireInspection(client: CriticomClient, input: FireInspectionInput) {
  const validation = fireChecklistError(input, input.fuel_level, input.fault_remarks);
  if (validation) throw new Error(validation);
  if (!input.declaration_accepted || !input.signature_svg) throw new Error('Confirm the declaration and sign the inspection.');
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('Sign in to file an inspection.');
  const { data, error } = await client.from('vehicle_checklists').insert({
    ...input, user_id: user.id, silo: 'MetroFire', form_version: 'fire-v1', officer_submitted: true,
  }).select().single();
  checkError(error);
  if (!data) throw new Error('The inspection could not be confirmed. Retry when connected.');
  return data;
}
