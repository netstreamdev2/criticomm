import type { ApparatusStatus, CriticomClient, Database, Silo } from '@criticom/db';
import type { FirearmEntry, FirearmItem, VehicleEntry, VehicleItem } from '@criticom/db/assets';
import { selectAll } from './paging.ts';

/**
 * The armoury and fleet registers and today's shift board (migration 0051).
 * Custody and status change only through database functions, which check
 * who may and keep the record; these carry the request across.
 */

type Tables = Database['public']['Tables'];
type FirearmRow = Tables['firearms']['Row'];
type ApparatusRow = Tables['apparatus']['Row'];
export type AssetImport = Tables['asset_imports']['Row'];

// ── The armoury ─────────────────────────────────────────────────────────

export type ArmouryFirearm = FirearmRow & {
  /** Who has it now, for a booked-out firearm. */
  holder: { name: string; since: string | null; rounds: number | null } | null;
};

async function namesOf(client: CriticomClient, userIds: string[]) {
  const names = new Map<string, string>();
  for (let i = 0; i < userIds.length; i += 100) {
    const ids = userIds.slice(i, i + 100);
    const [people, profiles] = await Promise.all([
      client.from('personnel').select('user_id, rank, first_name, last_name').in('user_id', ids),
      client.from('profiles').select('id, full_name').in('id', ids),
    ]);
    for (const p of profiles.data ?? []) if (p.full_name) names.set(p.id, p.full_name);
    for (const p of people.data ?? []) {
      if (p.user_id) names.set(p.user_id, [p.rank, p.first_name, p.last_name].filter(Boolean).join(' '));
    }
  }
  return names;
}

export async function listArmoury(client: CriticomClient, opts: { silo?: Silo } = {}): Promise<ArmouryFirearm[]> {
  const firearms = await selectAll<FirearmRow>((from, to) => {
    let q = client.from('firearms').select('*');
    if (opts.silo) q = q.eq('silo', opts.silo);
    return q.order('id').range(from, to);
  });
  const out = firearms.filter((f) => f.status === 'Issued' && f.issued_to);
  const names = await namesOf(client, [...new Set(out.map((f) => f.issued_to!))]);
  const rounds = new Map<string, number>();
  for (let i = 0; i < out.length; i += 100) {
    const { data } = await client.from('firearm_checklists').select('firearm_id, user_id, rounds_issued, created_at')
      .in('firearm_id', out.slice(i, i + 100).map((f) => f.id)).eq('kind', 'Issue').order('created_at', { ascending: true });
    for (const c of data ?? []) if (c.firearm_id) rounds.set(`${c.firearm_id}|${c.user_id}`, c.rounds_issued);
  }
  return firearms
    .map((f) => ({
      ...f,
      holder: f.status === 'Issued' && f.issued_to
        ? { name: names.get(f.issued_to) ?? 'An officer', since: f.issued_at, rounds: rounds.get(`${f.id}|${f.issued_to}`) ?? null }
        : null,
    }))
    .sort((a, b) => a.serial_number.localeCompare(b.serial_number));
}

/** The armoury as the import check needs it. */
export async function armourySnapshot(client: CriticomClient): Promise<FirearmEntry[]> {
  return selectAll<FirearmEntry>((from, to) =>
    client.from('firearms').select('id, serial_number, make, model, calibre, firearm_type, silo, station, notes, status')
      .order('id').range(from, to) as unknown as PromiseLike<{ data: FirearmEntry[] | null; error: unknown }>);
}

export async function setFirearmStatus(client: CriticomClient, firearmId: string, status: 'Available' | 'Maintenance' | 'Retired', reason: string) {
  const { data, error } = await client.rpc('set_firearm_status', { p_firearm: firearmId, p_status: status, p_reason: reason });
  if (error) throw error;
  return data;
}

export async function receiveFirearm(
  client: CriticomClient,
  args: { firearmId: string; roundsReturned: number; magazines: number; checksOk: boolean; condition: 'clean' | 'requires_cleaning' | 'damaged'; notes: string },
) {
  const { data, error } = await client.rpc('receive_firearm', {
    p_firearm_id: args.firearmId, p_rounds_returned: args.roundsReturned, p_magazines: args.magazines,
    p_checks_ok: args.checksOk, p_condition: args.condition, p_notes: args.notes,
  });
  if (error) throw error;
  return data as { status: 'Available' | 'Maintenance'; short: number };
}

export async function importFirearms(
  client: CriticomClient, rows: Array<FirearmItem & { line: number }>, meta: { fileName: string; fileSha256: string; reason: string },
) {
  const { data, error } = await client.rpc('import_firearms', {
    p_rows: rows as unknown as Array<Record<string, unknown>>, p_file_name: meta.fileName, p_file_sha256: meta.fileSha256, p_reason: meta.reason,
  });
  if (error) throw error;
  return data as { added: number; updated: number; unchanged: number };
}

// ── The fleet ───────────────────────────────────────────────────────────

export type FleetVehicle = ApparatusRow & {
  /** The officer holding it now. */
  driver: string | null;
};

export async function listFleet(client: CriticomClient, opts: { silo?: Silo } = {}): Promise<FleetVehicle[]> {
  const [vehicles, drivers] = await Promise.all([
    selectAll<ApparatusRow>((from, to) => {
      let q = client.from('apparatus').select('*');
      if (opts.silo) q = q.eq('silo', opts.silo);
      return q.order('id').range(from, to);
    }),
    selectAll<{ assigned_apparatus_id: string | null; rank: string; first_name: string; last_name: string }>((from, to) =>
      client.from('personnel').select('assigned_apparatus_id, rank, first_name, last_name')
        .not('assigned_apparatus_id', 'is', null).order('id').range(from, to)),
  ]);
  const byVehicle = new Map(drivers.map((d) => [d.assigned_apparatus_id, `${d.rank} ${d.first_name} ${d.last_name}`.trim()]));
  return vehicles
    .map((v) => ({ ...v, driver: byVehicle.get(v.id) ?? null }))
    .sort((a, b) => a.silo.localeCompare(b.silo) || a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true }));
}

export async function fleetSnapshot(client: CriticomClient): Promise<VehicleEntry[]> {
  return selectAll<VehicleEntry>((from, to) =>
    client.from('apparatus')
      .select('id, unit_number, name, type, silo, make, model, year, license_plate, vin, station_number, fuel_type, disc_expiry, status')
      .order('id').range(from, to) as unknown as PromiseLike<{ data: VehicleEntry[] | null; error: unknown }>);
}

export async function setVehicleStatus(client: CriticomClient, apparatusId: string, status: ApparatusStatus, reason: string) {
  const { data, error } = await client.rpc('set_vehicle_status', { p_apparatus: apparatusId, p_status: status, p_reason: reason });
  if (error) throw error;
  return data;
}

export async function importVehicles(
  client: CriticomClient, rows: Array<VehicleItem & { line: number }>, meta: { fileName: string; fileSha256: string; reason: string },
) {
  const { data, error } = await client.rpc('import_vehicles', {
    p_rows: rows as unknown as Array<Record<string, unknown>>, p_file_name: meta.fileName, p_file_sha256: meta.fileSha256, p_reason: meta.reason,
  });
  if (error) throw error;
  return data as { added: number; updated: number; unchanged: number };
}

export async function listAssetImports(client: CriticomClient, kind: AssetImport['kind'], limit = 5): Promise<AssetImport[]> {
  const { data, error } = await client.from('asset_imports').select('*').eq('kind', kind).order('imported_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

/** Whether a vehicle's licence disc has expired, or expires within `days`. */
export function discState(expiry: string | null, now = new Date(), days = 30): 'expired' | 'soon' | 'ok' | null {
  if (!expiry) return null;
  const end = new Date(`${expiry}T23:59:59+02:00`).getTime();
  if (end < now.getTime()) return 'expired';
  return end - now.getTime() < days * 86_400_000 ? 'soon' : 'ok';
}

// ── Today's shift ───────────────────────────────────────────────────────

/**
 * A firearm out longer than a shift: twelve hours and one of grace. Measured
 * from when it was booked out, not from midnight, so a night shift that runs
 * past 00:00 is not flagged half-way through.
 */
export const FIREARM_OUT_LIMIT_HOURS = 13;

/** Booked out before this moment means out longer than a shift. */
export function firearmOverdueBefore(now = new Date(), hours = FIREARM_OUT_LIMIT_HOURS): Date {
  return new Date(now.getTime() - hours * 3_600_000);
}

/** Midnight in South Africa (UTC+2, no daylight saving), as the start of "today". */
export function saDayStart(now = new Date()): Date {
  const sa = new Date(now.getTime() + 2 * 3_600_000);
  return new Date(Date.UTC(sa.getUTCFullYear(), sa.getUTCMonth(), sa.getUTCDate()) - 2 * 3_600_000);
}

export type ShiftBoardInput = {
  dayStart: Date;
  /** Now, for how long a firearm has been out. */
  now: Date;
  people: Array<{
    user_id: string | null; first_name: string; last_name: string; rank: string; badge_number: string; station: string | null;
    silo: Silo; is_on_duty: boolean; duty_started_at: string | null; assigned_apparatus_id: string | null;
  }>;
  readiness: Array<{ user_id: string; timestamp: string; passed: boolean }>;
  inspections: Array<{ user_id: string; apparatus_id: string; checked_at: string; passed: boolean; items_fault: number }>;
  noFirearm: Array<{ user_id: string; reason: string | null; created_at: string }>;
  firearmsOut: Array<{ id: string; serial_number: string; make: string; model: string; issued_to: string | null; issued_at: string | null }>;
  ends: Array<{ user_id: string; ended_at: string; source: 'app' | 'sign_out' | 'firearm_out'; unit_number: string | null }>;
  vehicles: Array<{ id: string; unit_number: string; name: string; status: ApparatusStatus; status_note: string | null; station_number: string | null; silo: Silo }>;
  /** Bodycams out with someone (0054); absent before that migration runs. */
  bodycamsOut?: Array<{ id: string; serial_number: string; booked_to: string | null; booked_at: string | null }>;
  noBodycam?: Array<{ user_id: string; reason: string; created_at: string }>;
};

export type ShiftBoardRow = {
  userId: string; name: string; badge: string; station: string | null; silo: Silo;
  readiness: 'passed' | 'failed' | 'none';
  vehicle: { unit: string; result: 'pass' | 'faults' | 'fail' | null } | null;
  firearm: { serial: string; label: string; since: string | null } | null;
  noFirearm: string | null | undefined;
  bodycam: { serial: string; since: string | null } | null;
  /** The reason given for no bodycam today, when one was. */
  noBodycam: string | undefined;
  onDuty: boolean; dutySince: string | null;
  ended: { at: string; source: 'app' | 'sign_out' | 'firearm_out' } | null;
  flags: Array<'firearm-out-after-end' | 'firearm-overdue' | 'bodycam-out-after-end' | 'bodycam-overdue' | 'failed-readiness' | 'vehicle-failed'>;
};

export type ShiftBoard = {
  rows: ShiftBoardRow[];
  totals: {
    started: number; onDuty: number; ended: number; firearmsOut: number; overdue: number; bodycamsOut: number;
    vehiclesInUse: number; offRoad: number;
  };
  offRoad: ShiftBoardInput['vehicles'];
};

const latestBy = <T extends { user_id: string }>(items: T[], at: (t: T) => string) => {
  const m = new Map<string, T>();
  for (const it of items) { const seen = m.get(it.user_id); if (!seen || at(seen) < at(it)) m.set(it.user_id, it); }
  return m;
};

/**
 * Who is working today, with what: readiness, vehicle and inspection, firearm,
 * bodycam, duty, and whether the shift has ended. Anyone holding kit is on
 * the board, whatever day they took it.
 */
export function buildShiftBoard(input: ShiftBoardInput): ShiftBoard {
  const overdueBefore = firearmOverdueBefore(input.now).toISOString();
  const readiness = latestBy(input.readiness, (r) => r.timestamp);
  const inspections = latestBy(input.inspections, (i) => i.checked_at);
  const noFirearm = latestBy(input.noFirearm, (n) => n.created_at);
  const ends = latestBy(input.ends, (e) => e.ended_at);
  const firearms = new Map(input.firearmsOut.filter((f) => f.issued_to).map((f) => [f.issued_to!, f]));
  const bodycamsOut = input.bodycamsOut ?? [];
  const bodycams = new Map(bodycamsOut.filter((c) => c.booked_to).map((c) => [c.booked_to!, c]));
  const noBodycam = latestBy(input.noBodycam ?? [], (n) => n.created_at);
  const vehicles = new Map(input.vehicles.map((v) => [v.id, v]));

  const rows: ShiftBoardRow[] = [];
  for (const p of input.people) {
    if (!p.user_id) continue;
    const r = readiness.get(p.user_id);
    const insp = inspections.get(p.user_id);
    const fa = firearms.get(p.user_id);
    const cam = bodycams.get(p.user_id);
    const end = ends.get(p.user_id);
    const active = r || insp || fa || cam || end || p.is_on_duty || p.assigned_apparatus_id
      || noFirearm.has(p.user_id) || noBodycam.has(p.user_id);
    if (!active) continue;
    const vehicleId = p.assigned_apparatus_id ?? insp?.apparatus_id ?? null;
    const v = vehicleId ? vehicles.get(vehicleId) : undefined;
    const flags: ShiftBoardRow['flags'] = [];
    // An end of shift only counts if it came after the latest start.
    const endedNow = end && (!r || end.ended_at > r.timestamp) && !p.is_on_duty ? end : null;
    if (fa && endedNow) flags.push('firearm-out-after-end');
    if (fa && fa.issued_at && fa.issued_at < overdueBefore) flags.push('firearm-overdue');
    if (cam && endedNow) flags.push('bodycam-out-after-end');
    if (cam && cam.booked_at && cam.booked_at < overdueBefore) flags.push('bodycam-overdue');
    if (r && !r.passed) flags.push('failed-readiness');
    if (insp && !insp.passed) flags.push('vehicle-failed');
    rows.push({
      userId: p.user_id, name: `${p.rank} ${p.first_name} ${p.last_name}`.trim(), badge: p.badge_number, station: p.station, silo: p.silo,
      readiness: r ? (r.passed ? 'passed' : 'failed') : 'none',
      vehicle: v ? { unit: v.unit_number, result: insp && insp.apparatus_id === v.id ? (insp.passed ? (insp.items_fault > 0 ? 'faults' : 'pass') : 'fail') : null } : null,
      firearm: fa ? { serial: fa.serial_number, label: `${fa.make} ${fa.model}`, since: fa.issued_at } : null,
      noFirearm: noFirearm.get(p.user_id) ? (noFirearm.get(p.user_id)!.reason ?? null) : undefined,
      bodycam: cam ? { serial: cam.serial_number, since: cam.booked_at } : null,
      noBodycam: noBodycam.get(p.user_id)?.reason,
      onDuty: p.is_on_duty, dutySince: p.duty_started_at,
      ended: endedNow ? { at: endedNow.ended_at, source: endedNow.source } : null,
      flags,
    });
  }
  const rank = (r: ShiftBoardRow) => (r.flags.length ? 0 : r.onDuty ? 1 : r.ended ? 3 : 2);
  rows.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const offRoad = input.vehicles.filter((v) => v.status === 'Out of Service' || v.status === 'Maintenance');
  return {
    rows,
    totals: {
      started: rows.filter((r) => r.readiness !== 'none').length,
      onDuty: rows.filter((r) => r.onDuty).length,
      ended: rows.filter((r) => r.ended).length,
      firearmsOut: input.firearmsOut.length,
      overdue: input.firearmsOut.filter((f) => f.issued_at && f.issued_at < overdueBefore).length,
      bodycamsOut: bodycamsOut.length,
      vehiclesInUse: input.vehicles.filter((v) => v.status === 'In Use').length,
      offRoad: offRoad.length,
    },
    offRoad,
  };
}

/** Today's shift for this supervisor's department (or everyone, for the global roles). */
export async function getShiftBoard(client: CriticomClient, opts: { silo?: Silo; now?: Date } = {}): Promise<ShiftBoard> {
  const now = opts.now ?? new Date();
  const dayStart = saDayStart(now);
  const since = dayStart.toISOString();
  const bySilo = <Q extends { eq: (c: string, v: string) => Q }>(q: Q) => (opts.silo ? q.eq('silo', opts.silo) : q);
  const [people, mental, inspections, noFirearm, firearmsOut, ends, vehicles] = await Promise.all([
    selectAll<ShiftBoardInput['people'][number]>((from, to) => bySilo(client.from('personnel')
      .select('user_id, first_name, last_name, rank, badge_number, station, silo, is_on_duty, duty_started_at, assigned_apparatus_id'))
      .order('id').range(from, to) as unknown as PromiseLike<{ data: ShiftBoardInput['people'] | null; error: unknown }>),
    selectAll<Tables['mental_checks']['Row']>((from, to) => bySilo(client.from('mental_checks').select('*')).gte('timestamp', since).order('id').range(from, to)),
    selectAll<Tables['vehicle_checklists']['Row']>((from, to) => client.from('vehicle_checklists').select('*').gte('checked_at', since).order('id').range(from, to)),
    selectAll<Tables['shift_no_firearm_declarations']['Row']>((from, to) => client.from('shift_no_firearm_declarations').select('*').gte('created_at', since).order('id').range(from, to)),
    selectAll<FirearmRow>((from, to) => client.from('firearms').select('*').eq('status', 'Issued').order('id').range(from, to)),
    selectAll<Tables['shift_ends']['Row']>((from, to) => client.from('shift_ends').select('*').gte('ended_at', since).order('id').range(from, to)),
    selectAll<ApparatusRow>((from, to) => bySilo(client.from('apparatus').select('*')).order('id').range(from, to)),
  ]);
  // Bodycams arrive with 0054; until it is run the board simply has none.
  const [bodycamsOut, noBodycam] = await Promise.all([
    selectAll<Tables['bodycams']['Row']>((from, to) => client.from('bodycams').select('*').eq('status', 'Booked out').order('id').range(from, to))
      .catch(() => []),
    selectAll<Tables['shift_no_bodycam_declarations']['Row']>((from, to) => client.from('shift_no_bodycam_declarations').select('*')
      .gte('created_at', since).order('id').range(from, to)).catch(() => []),
  ]);
  return buildShiftBoard({
    dayStart,
    now,
    people,
    readiness: mental.map((m) => ({
      user_id: m.user_id, timestamp: m.timestamp,
      passed: m.memory_recall && m.judgment && m.situational_awareness && m.not_under_influence && m.anger_check && m.reflexes,
    })),
    inspections: inspections.map((v) => ({
      user_id: v.user_id, apparatus_id: v.apparatus_id, checked_at: v.checked_at, items_fault: v.items_fault ?? 0,
      passed: !!(v.lights_functional && v.tires_condition_ok && v.equipment_stocked && v.comms_working && v.brakes_responsive
        && (v.silo !== 'MetroFire' || (v.form_version === 'fire-v1' && v.declaration_accepted
          && v.scba_checked && v.water_tank_full && v.pump_operational
          && v.hoses_and_nozzles_stocked && v.ladders_secured && v.turnout_gear_complete))
        && (v.silo !== 'Medical' || (v.form_version === 'ems-v1' && v.declaration_accepted && v.requires_cleaning === false
          && v.oxygen_full && v.aed_battery_ok && v.suction_functional && v.bvm_masks_ok
          && v.jump_bag_stocked && v.iv_fluids_stocked && v.drug_box_sealed && v.gloves_ppe_stocked))),
    })),
    noFirearm: noFirearm.map((n) => ({ user_id: n.user_id, reason: n.reason, created_at: n.created_at })),
    firearmsOut: firearmsOut.map((f) => ({ id: f.id, serial_number: f.serial_number, make: f.make, model: f.model, issued_to: f.issued_to, issued_at: f.issued_at })),
    ends: ends.map((e) => ({ user_id: e.user_id, ended_at: e.ended_at, source: e.source, unit_number: e.unit_number })),
    vehicles: vehicles.map((v) => ({ id: v.id, unit_number: v.unit_number, name: v.name, status: v.status, status_note: v.status_note, station_number: v.station_number, silo: v.silo })),
    bodycamsOut: bodycamsOut.map((c) => ({ id: c.id, serial_number: c.serial_number, booked_to: c.booked_to, booked_at: c.booked_at })),
    noBodycam: noBodycam.map((n) => ({ user_id: n.user_id, reason: n.reason, created_at: n.created_at })),
  });
}
