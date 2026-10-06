import type { CriticomClient, Database, Silo } from '@criticom/db';
import type { MentalCheckInput, VehicleChecklistInput } from '@criticom/db/schemas';

export * from './fire';

/** ShiftController.HasCompletedShiftStartTodayAsync */
export async function hasCompletedShiftStartToday(client: CriticomClient) {
  const { data, error } = await client.rpc('has_completed_shift_start_today');
  if (error) throw error;
  return Boolean(data);
}

/** ShiftController.SubmitMentalCheck */
export async function submitMentalCheck(
  client: CriticomClient,
  args: MentalCheckInput & { silo: Silo },
) {
  // user_id is NOT NULL and the RLS check is `user_id = auth.uid()`. Omitting
  // it sent NULL, which failed the policy — the error surfaced as "new row
  // violates row level security policy", which reads like a permissions
  // problem but was a missing column all along.
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('You must be signed in to submit a readiness check.');

  const { data, error } = await client
    .from('mental_checks')
    .insert({
      user_id: user.id,
      silo: args.silo,
      memory_recall: args.memory_recall,
      judgment: args.judgment,
      situational_awareness: args.situational_awareness,
      not_under_influence: args.not_under_influence,
      anger_check: args.anger_check,
      reflexes: args.reflexes,
      comments: args.comments ?? '',
    })
    .select()
    .single();
  if (error) throw error;

  const passed =
    args.memory_recall &&
    args.judgment &&
    args.situational_awareness &&
    args.not_under_influence &&
    args.anger_check &&
    args.reflexes;
  return { check: data, passed };
}

/** ShiftController.VehicleSelection — list of available vehicles in my silo */
export async function listAvailableVehicles(client: CriticomClient, silo: Silo) {
  const { data, error } = await client
    .from('apparatus')
    .select('*')
    .eq('silo', silo)
    .eq('status', 'Available')
    .order('unit_number');
  if (error) throw error;
  return data ?? [];
}

/** ShiftController.AssignVehicle */
export async function assignVehicle(client: CriticomClient, apparatusId: string) {
  const { data, error } = await client.rpc('assign_vehicle', { p_apparatus_id: apparatusId });
  if (error) throw error;
  return data;
}

/** ShiftController.UnitCompliance — today's mental checks + vehicle checklists */
export async function getUnitCompliance(client: CriticomClient, silo?: Silo) {
  const saDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const iso = new Date(`${saDate}T00:00:00+02:00`).toISOString();

  let mc = client.from('mental_checks').select('*').gte('timestamp', iso)
    .order('timestamp', { ascending: false });
  let vc = client.from('vehicle_checklists')
    .select('*, apparatus:apparatus_id (unit_number, name)')
    .gte('checked_at', iso)
    .order('checked_at', { ascending: false });
  if (silo) {
    mc = mc.eq('silo', silo);
    vc = vc.eq('silo', silo);
  }
  const [mcRes, vcRes] = await Promise.all([mc, vc]);
  if (mcRes.error) throw mcRes.error;
  if (vcRes.error) throw vcRes.error;
  return { mentalChecks: mcRes.data ?? [], vehicleChecklists: vcRes.data ?? [] };
}

/** ShiftController.SubmitVehicleChecklist */
export async function submitVehicleChecklist(
  client: CriticomClient,
  args: VehicleChecklistInput & { silo: Silo },
) {
  // Same omission as submitMentalCheck: user_id is NOT NULL and RLS checks it
  // against auth.uid(), so leaving it out fails as an RLS violation.
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('You must be signed in to submit a vehicle check.');

  const { data, error } = await client
    .from('vehicle_checklists')
    .insert({
      user_id: user.id,
      silo: args.silo,
      apparatus_id: args.apparatus_id,
      officer_submitted: true,
      fuel_level: args.fuel_level,
      lights_functional: args.lights_functional,
      tires_condition_ok: args.tires_condition_ok,
      equipment_stocked: args.equipment_stocked,
      comms_working: args.comms_working,
      brakes_responsive: args.brakes_responsive,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/* ── Start of shift: DMPS 187(c) + armoury (migration 0037) ─────────────── */

type VehicleChecklistRow = Database['public']['Tables']['vehicle_checklists']['Row'];
type FirearmRow = Database['public']['Tables']['firearms']['Row'];
type FirearmChecklistRow = Database['public']['Tables']['firearm_checklists']['Row'];
type MentalCheckRow = Database['public']['Tables']['mental_checks']['Row'];
type ApparatusRow = Database['public']['Tables']['apparatus']['Row'];
type NoFirearmRow = Database['public']['Tables']['shift_no_firearm_declarations']['Row'];
type BodycamBookingRow = Database['public']['Tables']['bodycam_bookings']['Row'];
type NoBodycamRow = Database['public']['Tables']['shift_no_bodycam_declarations']['Row'];

export type InspectionItemStatus = 'ok' | 'fault' | 'nil';
export type ShiftType = NonNullable<VehicleChecklistRow['shift_type']>;
export type ChamberStatus = NonNullable<FirearmChecklistRow['chamber_status']>;
export type FirearmCondition = NonNullable<FirearmChecklistRow['condition']>;
export type ShiftFirearm = FirearmRow;

/** Start of the current day in South Africa, as an ISO instant. */
function saTodayStartIso() {
  const saDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  return new Date(`${saDate}T00:00:00+02:00`).toISOString();
}

/** A database function that does not exist yet: its migration has not been run. */
const notInstalled = (error: { code?: string } | null) => error?.code === 'PGRST202';

/** Which gate steps the server already counts as passed today. */
export async function getShiftGateProgress(client: CriticomClient) {
  const [readiness, vehicle, firearm, requiresFirearm, bodycam, requiresBodycam] = await Promise.all([
    client.rpc('shift_readiness_passed_today'),
    client.rpc('shift_vehicle_passed_today'),
    client.rpc('shift_firearm_resolved_today'),
    client.rpc('shift_requires_firearm'),
    client.rpc('shift_bodycam_resolved_today'),
    client.rpc('shift_requires_bodycam'),
  ]);
  for (const res of [readiness, vehicle, firearm, requiresFirearm]) {
    if (res.error) throw res.error;
  }
  // Bodycams arrive with 0054: until it is run there is no bodycam step.
  for (const res of [bodycam, requiresBodycam]) {
    if (res.error && !notInstalled(res.error)) throw res.error;
  }
  return {
    readiness: Boolean(readiness.data),
    vehicle: Boolean(vehicle.data),
    /** A firearm was booked out, or the officer declared they are not drawing one. */
    firearm: Boolean(firearm.data),
    /** Police services book out a firearm (or declare none) as the last step. */
    requiresFirearm: Boolean(requiresFirearm.data),
    /** A bodycam was booked out, or the officer said why there is none. */
    bodycam: Boolean(bodycam.data),
    /** Police services book out a bodycam (or say why not) after the firearm. */
    requiresBodycam: !requiresBodycam.error && Boolean(requiresBodycam.data),
  };
}

export type Vehicle187cInput = {
  silo: Silo;
  apparatus_id: string;
  fuel_level: '1/4' | '1/2' | '3/4' | 'Full';
  lights_functional: boolean;
  tires_condition_ok: boolean;
  equipment_stocked: boolean;
  comms_working: boolean;
  brakes_responsive: boolean;
  inspection_ref: string;
  ndm_number: string;
  mileage_km: number;
  shift_type: ShiftType;
  /** `group.item` → status; the server insists on all 67. */
  items: Record<string, InspectionItemStatus>;
  fault_remarks: string | null;
  inspector_name: string;
  signature_svg: string;
  photo_paths: string[];
  licence_disk_path: string | null;
  licence_photo_path: string | null;
  declaration_accepted: boolean;
};

/**
 * ShiftController.SubmitVehicleChecklist — the full 187(c) sheet.
 * The server re-validates the sheet, counts the items and stamps the
 * inspector and date, so the returned row is the official record.
 */
export async function submitVehicleInspection187c(client: CriticomClient, args: Vehicle187cInput) {
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('You must be signed in to submit a vehicle inspection.');

  const { data, error } = await client
    .from('vehicle_checklists')
    .insert({ ...args, user_id: user.id, officer_submitted: true, form_version: '187c' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** The latest signed 187(c) sheet for a vehicle — powers "same as last inspection". */
export async function getLastVehicleInspection(client: CriticomClient, apparatusId: string) {
  const { data, error } = await client
    .from('vehicle_checklists')
    .select('*')
    .eq('apparatus_id', apparatusId)
    .eq('form_version', '187c')
    .order('checked_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Firearms the officer may book out: Available, or already booked out to them. */
export async function listShiftFirearms(client: CriticomClient) {
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('You must be signed in to view the armoury.');

  const { data, error } = await client
    .from('firearms')
    .select('*')
    .or(`status.eq.Available,and(status.eq.Issued,issued_to.eq.${user.id})`)
    .order('make')
    .order('serial_number');
  if (error) throw error;
  return (data ?? []) as FirearmRow[];
}

export type ShiftFirearmInput = {
  firearm_id: string;
  rounds_issued: number;
  magazines: number;
  chamber_status: ChamberStatus;
  condition: FirearmCondition;
  serial_verified: boolean;
  barrel_clear: boolean;
  action_functional: boolean;
  safety_functional: boolean;
  sights_secure: boolean;
  notes: string | null;
};

/** Books the firearm out to the officer, or sends it to the armourer if it fails. */
export async function issueShiftFirearm(client: CriticomClient, args: ShiftFirearmInput) {
  const { data, error } = await client.rpc('issue_shift_firearm', {
    p_firearm_id: args.firearm_id,
    p_rounds_issued: args.rounds_issued,
    p_magazines: args.magazines,
    p_chamber_status: args.chamber_status,
    p_condition: args.condition,
    p_serial_verified: args.serial_verified,
    p_barrel_clear: args.barrel_clear,
    p_action_functional: args.action_functional,
    p_safety_functional: args.safety_functional,
    p_sights_secure: args.sights_secure,
    p_notes: args.notes,
  });
  if (error) throw error;
  return data as FirearmChecklistRow;
}

/** Completes the firearm step without drawing a firearm — recorded for command. */
export async function declareShiftNoFirearm(client: CriticomClient, reason: string | null) {
  const { data, error } = await client.rpc('declare_shift_no_firearm', { p_reason: reason });
  if (error) throw error;
  return data as NoFirearmRow;
}

/** The latest shift-start book-out, for "same loadout as last shift". */
export async function getLastShiftFirearm(client: CriticomClient) {
  const { data: { user } } = await client.auth.getUser();
  if (!user) return null;
  const { data, error } = await client
    .from('firearm_checklists')
    .select('*')
    .eq('user_id', user.id)
    .eq('shift_start', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as FirearmChecklistRow | null;
}

export type ShiftStartRecord = {
  readiness: MentalCheckRow | null;
  inspection: (VehicleChecklistRow & {
    apparatus: Pick<ApparatusRow, 'unit_number' | 'name' | 'make' | 'model' | 'license_plate'> | null;
  }) | null;
  firearm: FirearmChecklistRow | null;
  /** Set when the officer ticked "No firearm" instead of booking one out. */
  noFirearm: NoFirearmRow | null;
  /** Today's bodycam book-out (0054), still out with them. */
  bodycam: BodycamBookingRow | null;
  /** Set when the officer said why they have no bodycam today. */
  noBodycam: NoBodycamRow | null;
};

/** Today's start-of-shift record for the signed-in officer — what the PDF/CSV export holds. */
export async function getTodayShiftStartRecord(client: CriticomClient): Promise<ShiftStartRecord> {
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('You must be signed in to view your shift record.');
  const since = saTodayStartIso();

  const [mc, vc, fc, nf, bc, nb] = await Promise.all([
    client.from('mental_checks').select('*')
      .eq('user_id', user.id).gte('timestamp', since)
      .order('timestamp', { ascending: false }).limit(1).maybeSingle(),
    client.from('vehicle_checklists')
      .select('*, apparatus:apparatus_id (unit_number, name, make, model, license_plate)')
      .eq('user_id', user.id).eq('form_version', '187c').gte('checked_at', since)
      .order('checked_at', { ascending: false }).limit(1).maybeSingle(),
    client.from('firearm_checklists').select('*')
      .eq('user_id', user.id).eq('shift_start', true).gte('created_at', since)
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    client.from('shift_no_firearm_declarations').select('*')
      .eq('user_id', user.id).gte('created_at', since)
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    // A book-out that failed its check never went out, so it is not today's bodycam.
    client.from('bodycam_bookings').select('*')
      .eq('user_id', user.id).gte('booked_at', since).is('returned_at', null)
      .order('booked_at', { ascending: false }).limit(1).maybeSingle(),
    client.from('shift_no_bodycam_declarations').select('*')
      .eq('user_id', user.id).gte('created_at', since)
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (mc.error) throw mc.error;
  if (vc.error) throw vc.error;
  if (fc.error) throw fc.error;
  if (nf.error) throw nf.error;
  return {
    readiness: mc.data,
    inspection: vc.data as ShiftStartRecord['inspection'],
    firearm: fc.data as FirearmChecklistRow | null,
    noFirearm: nf.data as NoFirearmRow | null,
    // Before 0054 is run these tables do not exist: no bodycam on the record.
    bodycam: bc.error ? null : (bc.data as BodycamBookingRow | null),
    noBodycam: nb.error ? null : (nb.data as NoBodycamRow | null),
  };
}

/**
 * Storage folder for this officer's inspection photos:
 * `<tenant_id>/<user_id>/<inspection_ref>` — the bucket policy checks both.
 */
export async function getShiftInspectionFolder(client: CriticomClient, inspectionRef: string) {
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error('You must be signed in to attach photos.');
  const { data, error } = await client
    .from('personnel')
    .select('tenant_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data?.tenant_id) throw new Error('No personnel record is linked to this account.');
  return `${data.tenant_id}/${user.id}/${inspectionRef.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}
export * from './end';
