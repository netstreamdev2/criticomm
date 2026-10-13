import type { CriticomClient, Database, Silo } from '@criticom/db';

export * from './analytics';
export * from './schedule';

type Tables = Database['public']['Tables'];

// ── Roster (RosterViewController) ────────────────────────────────────

export async function listShifts(client: CriticomClient, silo?: Silo) {
  let q = client.from('shifts').select('*').order('start_time', { ascending: false });
  if (silo) q = q.eq('silo', silo);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function createShift(client: CriticomClient, input: Tables['shifts']['Insert']) {
  const { data, error } = await client.from('shifts').insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function listRosterEntries(client: CriticomClient, shiftId?: string) {
  let q = client
    .from('rosters')
    .select('*, shift:shift_id (shift_name, start_time, end_time)')
    .order('created_at', { ascending: false });
  if (shiftId) q = q.eq('shift_id', shiftId);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/**
 * RosterViewController.DutySheet — build the DCP-format daily parade sheet.
 * Groups roster rows by shift block, attaches approved leave for the date and
 * active endorsements as special events.
 */
export async function getDutySheet(
  client: CriticomClient,
  args: { silo: Silo; date: string },
) {
  // The day's issued shifts (0072: every line carries its own times), with
  // the shift type or week-board shift each came from.
  const { data: rosterRows, error } = await client
    .from('rosters')
    .select('*, shift:shift_id (shift_name, activity_type, start_time, end_time), template:template_id (name)')
    .eq('silo', args.silo)
    .eq('duty_date', args.date)
    .eq('published', true)
    .is('cancelled_at', null)
    .order('start_at', { ascending: true });
  if (error) throw error;

  type Row = (typeof rosterRows)[number] & {
    shift?: { shift_name?: string; activity_type?: string; start_time?: string; end_time?: string } | null;
    template?: { name?: string } | null;
  };
  const onDate = (rosterRows ?? []) as Row[];

  // Group into shift blocks.
  const blocks = new Map<string, { shiftName: string; activityType: string; start: string | null; end: string | null; members: Row[] }>();
  for (const r of onDate) {
    const key = r.template?.name ?? r.shift?.shift_name ?? r.activity_type ?? 'General duty';
    const block = blocks.get(key) ?? {
      shiftName: key,
      activityType: r.shift?.activity_type ?? r.activity_type ?? '',
      start: r.start_at ?? r.shift?.start_time ?? null,
      end: r.end_at ?? r.shift?.end_time ?? null,
      members: [],
    };
    block.members.push(r);
    blocks.set(key, block);
  }

  // Approved leave for the date.
  const { data: leave } = await client
    .from('leave_entries')
    .select('*')
    .eq('silo', args.silo)
    .eq('status', 'Approved')
    .lte('eff_from', args.date)
    .gte('eff_to', args.date);

  // Active endorsements overlapping the date → special events.
  const { data: endorsements } = await client
    .from('endorsements')
    .select('*')
    .eq('silo', args.silo)
    .eq('is_active', true)
    .lte('start_date', args.date)
    .or(`end_date.is.null,end_date.gte.${args.date}`);

  return {
    date: args.date,
    silo: args.silo,
    shifts: [...blocks.values()],
    onLeave: leave ?? [],
    specialEvents: (endorsements ?? [])
      .filter((e) => e.type === 'Special Event' || e.type === 'Special Instruction')
      .map((e) => `${e.type}: ${e.employee_name ?? ''} — ${e.details ?? ''}`.trim()),
    endorsements: endorsements ?? [],
    totalMembers: onDate.length,
  };
}

export async function createRosterEntry(client: CriticomClient, input: Tables['rosters']['Insert']) {
  const { data, error } = await client.from('rosters').insert(input).select().single();
  if (error) throw error;
  return data;
}

/**
 * RosterViewController platoon-rotation generators.
 * '224'  = 2 days on, 2 nights on, 4 off (6-day cycle, 4 platoons)
 * '24-48'= 24h on, 48h off (3-day cycle, 3 platoons)
 */
export function generatePlatoonRotation(
  pattern: '224' | '24-48',
  startDate: Date,
  days: number,
): Array<{ date: string; platoon: string; shift: string }> {
  const out: Array<{ date: string; platoon: string; shift: string }> = [];
  for (let d = 0; d < days; d++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + d);
    const iso = date.toISOString().slice(0, 10);
    if (pattern === '224') {
      // 4 platoons A–D staggered over a 6-day cycle: 2 days, 2 nights, 4 off
      const platoons = ['A', 'B', 'C', 'D'];
      for (let p = 0; p < 4; p++) {
        const phase = ((d + p * 2) % 8 + 8) % 8;
        const shift = phase < 2 ? 'Day' : phase < 4 ? 'Night' : 'Off';
        if (shift !== 'Off') out.push({ date: iso, platoon: platoons[p]!, shift });
      }
    } else {
      // 3 platoons on a 24-on / 48-off cycle
      const platoons = ['A', 'B', 'C'];
      const onPlatoon = platoons[d % 3]!;
      out.push({ date: iso, platoon: onPlatoon, shift: '24h' });
    }
  }
  return out;
}

// ── Leave (LeaveController — real table replaces V4 mock data) ───────

export async function listLeaveEntries(client: CriticomClient, userId?: string) {
  let q = client.from('leave_entries').select('*').order('eff_from', { ascending: false });
  if (userId) q = q.eq('user_id', userId);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function createLeaveEntry(
  client: CriticomClient,
  input: Tables['leave_entries']['Insert'],
) {
  const { data, error } = await client.from('leave_entries').insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function setLeaveStatus(
  client: CriticomClient,
  args: { id: string; status: 'Approved' | 'Rejected'; comment?: string | null },
) {
  const { data, error } = await client.rpc('decide_leave', {
    p_id: args.id, p_approve: args.status === 'Approved', p_comment: args.comment ?? null,
  });
  if (error) throw error;
  return data;
}

// ── Training (TrainingController + PoliceTrainingController) ────────

export async function listTrainingRecords(client: CriticomClient, personnelId?: string) {
  let q = client
    .from('training_records')
    .select('*, personnel:personnel_id (first_name, last_name, badge_number)')
    .order('date_completed', { ascending: false });
  if (personnelId) q = q.eq('personnel_id', personnelId);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function addTrainingRecord(
  client: CriticomClient,
  input: Tables['training_records']['Insert'],
) {
  const { data, error } = await client.from('training_records').insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function listCertifications(client: CriticomClient, personnelId?: string) {
  let q = client
    .from('certifications')
    .select('*, personnel:personnel_id (first_name, last_name, badge_number)')
    .order('expiry_date');
  if (personnelId) q = q.eq('personnel_id', personnelId);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function addCertification(
  client: CriticomClient,
  input: Tables['certifications']['Insert'],
) {
  const { data, error } = await client.from('certifications').insert(input).select().single();
  if (error) throw error;
  return data;
}

/** List operational personnel — used by roster/training pickers */
export async function listPersonnel(client: CriticomClient, silo?: Silo) {
  let q = client.from('personnel').select('*').order('last_name');
  if (silo) q = q.eq('silo', silo);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/** HRController / StaffController — create an operational personnel record */
export async function createPersonnel(
  client: CriticomClient,
  input: Tables['personnel']['Insert'],
) {
  const { data, error } = await client.from('personnel').insert(input).select().single();
  if (error) throw error;
  return data;
}

/** SystemProfileController.Create — operator profile record */
export async function createSystemProfile(
  client: CriticomClient,
  input: Tables['system_profiles']['Insert'],
) {
  const { data, error } = await client.from('system_profiles').insert(input).select().single();
  if (error) throw error;
  return data;
}
