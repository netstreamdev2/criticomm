import type { CriticomClient, Database } from '@criticom/db';

/**
 * The end of a shift (migrations 0051 and 0054), from the officer's side:
 * what they are holding, handing the firearm and bodycam back, and ending
 * the shift.
 */

type FirearmRow = Database['public']['Tables']['firearms']['Row'];
type ApparatusRow = Database['public']['Tables']['apparatus']['Row'];
type BodycamRow = Database['public']['Tables']['bodycams']['Row'];

export type MyShiftKit = {
  /** The firearm booked out to them, with what was issued with it. */
  firearm: (FirearmRow & { rounds_issued: number | null; magazines: number | null; issued_on: string | null }) | null;
  /** The bodycam booked out to them (0054). */
  bodycam: BodycamRow | null;
  vehicle: Pick<ApparatusRow, 'id' | 'unit_number' | 'name' | 'mileage' | 'status'> | null;
  onDuty: boolean;
};

export async function getMyShiftKit(client: CriticomClient): Promise<MyShiftKit> {
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('Sign in first.');
  const [firearmRes, meRes, bodycamRes] = await Promise.all([
    client.from('firearms').select('*').eq('status', 'Issued').eq('issued_to', user.id).limit(1).maybeSingle(),
    client.from('personnel').select('assigned_apparatus_id, is_on_duty').eq('user_id', user.id).limit(1).maybeSingle(),
    client.from('bodycams').select('*').eq('status', 'Booked out').eq('booked_to', user.id).limit(1).maybeSingle(),
  ]);
  if (firearmRes.error) throw firearmRes.error;
  if (meRes.error) throw meRes.error;

  let firearm: MyShiftKit['firearm'] = null;
  if (firearmRes.data) {
    const { data: issue } = await client.from('firearm_checklists')
      .select('rounds_issued, magazines, created_at')
      .eq('firearm_id', firearmRes.data.id).eq('user_id', user.id).eq('kind', 'Issue')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    firearm = {
      ...firearmRes.data,
      rounds_issued: issue?.rounds_issued ?? null, magazines: issue?.magazines ?? null, issued_on: issue?.created_at ?? firearmRes.data.issued_at,
    };
  }

  let vehicle: MyShiftKit['vehicle'] = null;
  const vehicleId = meRes.data?.assigned_apparatus_id;
  if (vehicleId) {
    const { data } = await client.from('apparatus').select('id, unit_number, name, mileage, status').eq('id', vehicleId).maybeSingle();
    vehicle = data ?? null;
  }
  // Before 0054 is run there is no bodycam table: nothing to hand back.
  const bodycam = bodycamRes.error ? null : ((bodycamRes.data as BodycamRow | null) ?? null);
  return { firearm, bodycam, vehicle, onDuty: !!meRes.data?.is_on_duty };
}

export type FirearmReturnInput = {
  firearmId: string;
  roundsReturned: number;
  magazines: number;
  /** Unloaded, chamber cleared: required. */
  unloaded: boolean;
  /** Serial verified; action, safety and sights working. */
  checksOk: boolean;
  condition: 'clean' | 'requires_cleaning' | 'damaged';
  notes?: string | null;
};

export async function returnShiftFirearm(client: CriticomClient, args: FirearmReturnInput) {
  const { data, error } = await client.rpc('return_shift_firearm', {
    p_firearm_id: args.firearmId, p_rounds_returned: args.roundsReturned, p_magazines: args.magazines,
    p_unloaded: args.unloaded, p_checks_ok: args.checksOk, p_condition: args.condition, p_notes: args.notes ?? null,
  });
  if (error) throw error;
  return data as { status: 'Available' | 'Maintenance'; short: number };
}

export async function endShift(client: CriticomClient, args: { mileageKm?: number | null; vehicleNote?: string | null } = {}) {
  const { data, error } = await client.rpc('end_shift', {
    p_mileage_km: args.mileageKm ?? null, p_vehicle_note: args.vehicleNote ?? null,
  });
  if (error) throw error;
  return data as { status: 'ended'; vehicle: string | null; vehicle_status: 'Available' | 'Maintenance' | null };
}

/** Rounds that did not come back, and what that asks of the officer. */
export function roundsShort(issued: number | null, returned: number): number {
  return issued === null ? 0 : Math.max(0, issued - returned);
}
