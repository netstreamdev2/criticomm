import type { CriticomClient, Database } from '@criticom/db';
import {
  EMS_STOCK, emsChecklistError, type EmsFuelLevel, type EmsStockKey, type EmsVehicleKey,
} from '@criticom/db/ems-shift';
import { getMyPersonnel } from '../personnel';

export type EmsAmbulance = Database['public']['Tables']['apparatus']['Row'];
export type EmsShiftCheck = Database['public']['Tables']['vehicle_checklists']['Row'];

function todayStart() {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  return new Date(`${date}T00:00:00+02:00`).toISOString();
}

function checkError(error: { code?: string; message: string } | null) {
  if (!error) return;
  if (error.code === '42703' || error.code === 'PGRST204') {
    throw new Error('EMS shift checks are not available yet. Ask your administrator to apply migration 0060_ems_start_of_shift.sql, then retry.');
  }
  throw error;
}

/** Kept separate from Police's loadout and Fire's appliance checks. */
export async function getEmsShiftState(client: CriticomClient) {
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('Sign in to start your shift.');
  const [personnel, readiness, vehicle, mental, check] = await Promise.all([
    getMyPersonnel(client, user.id),
    client.rpc('shift_readiness_passed_today'),
    client.rpc('shift_vehicle_passed_today'),
    client.from('mental_checks').select('*').eq('user_id', user.id).eq('silo', 'Medical')
      .gte('timestamp', todayStart()).order('timestamp', { ascending: false }).order('id', { ascending: false }).limit(1).maybeSingle(),
    // Naming one new column also detects an unapplied migration, even for an empty register.
    client.from('vehicle_checklists').select('*, oxygen_full').eq('user_id', user.id).eq('silo', 'Medical')
      .eq('form_version', 'ems-v1').gte('checked_at', todayStart())
      .order('checked_at', { ascending: false }).order('id', { ascending: false }).limit(1).maybeSingle(),
  ]);
  checkError(check.error);
  for (const res of [readiness, vehicle, mental]) if (res.error) throw res.error;
  if (!personnel || personnel.silo !== 'Medical') throw new Error('An EMS personnel record must be linked to your account. Contact your administrator.');
  let ambulance: EmsAmbulance | null = null;
  if (personnel.assigned_apparatus_id) {
    const res = await client.from('apparatus').select('*').eq('id', personnel.assigned_apparatus_id).eq('silo', 'Medical').single();
    if (res.error) throw res.error;
    ambulance = res.data;
  }
  return {
    personnel, ambulance, readiness: Boolean(readiness.data), vehicle: Boolean(vehicle.data),
    mental: mental.data, check: check.data as EmsShiftCheck | null,
  };
}

export type EmsShiftCheckInput = Record<EmsVehicleKey, boolean> & Record<EmsStockKey, boolean> & {
  /** Chosen by the phone, so a retry after a lost response finds the record it already filed. */
  id?: string;
  apparatus_id: string;
  fuel_level: EmsFuelLevel;
  requires_cleaning: boolean;
  fault_remarks: string;
  declaration_accepted: boolean;
};

export async function submitEmsShiftCheck(client: CriticomClient, input: EmsShiftCheckInput) {
  const validation = emsChecklistError(input, input.fuel_level, input, input.fault_remarks, input.declaration_accepted);
  if (validation) throw new Error(validation);
  if (EMS_STOCK.some(([key]) => typeof input[key] !== 'boolean') || typeof input.requires_cleaning !== 'boolean') {
    throw new Error('Record every inventory item and whether the ambulance requires cleaning.');
  }
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('Sign in to file your shift check.');
  const { data, error } = await client.from('vehicle_checklists').insert({
    ...input, user_id: user.id, silo: 'Medical', form_version: 'ems-v1', officer_submitted: true,
  }).select().single();
  checkError(error);
  if (!data) throw new Error('The check could not be confirmed. Retry when connected.');
  return data;
}
