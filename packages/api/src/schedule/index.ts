import type { CriticomClient, Database, ShiftOutcome, Silo } from '@criticom/db';
import { addDays, lineActive, monthRange, saDay } from './rules.ts';

export * from './rules.ts';

/**
 * Schedules (migration 0072): shift types, rotations, the roster, check-in and
 * attendance, leave decisions and swaps.
 *
 * Every write goes through a database function that checks who is asking —
 * these wrappers only shape the calls. Reads rely on the row rules: a person
 * reads their own issued shifts and their department's; those who roster the
 * department also read drafts, attendance and leave.
 */

type Tables = Database['public']['Tables'];
export type ShiftTemplate = Tables['shift_templates']['Row'];
export type Rotation = Tables['rotations']['Row'];
export type ScheduleSettings = { grace: number; noshow: number };
export type PublicHoliday = Tables['public_holidays']['Row'];
export type RosterRow = Tables['rosters']['Row'];
export type Attendance = Tables['shift_attendance']['Row'];
export type ShiftSwap = Tables['shift_swaps']['Row'];
export type RosterChange = Tables['roster_changes']['Row'];

/** A roster line with what the screens show beside it. */
export type ScheduleLine = RosterRow & { attendance: Attendance | null };

const fail = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};

const LINE_COLUMNS = '*, attendance:shift_attendance(*)';

function withAttendance(rows: unknown[]): ScheduleLine[] {
  return (rows as Array<RosterRow & { attendance: Attendance | Attendance[] | null }>).map((r) => ({
    ...r,
    attendance: Array.isArray(r.attendance) ? (r.attendance[0] ?? null) : (r.attendance ?? null),
  }));
}

/* ── Set-up ───────────────────────────────────────────────────────────── */

export async function listShiftTemplates(client: CriticomClient, silo: Silo, opts: { includeInactive?: boolean } = {}) {
  let q = client.from('shift_templates').select('*').eq('silo', silo);
  if (!opts.includeInactive) q = q.eq('active', true);
  const { data, error } = await q.order('sort_order').order('name');
  fail(error);
  return (data ?? []) as ShiftTemplate[];
}

export async function saveShiftTemplate(
  client: CriticomClient,
  input: Pick<ShiftTemplate, 'silo' | 'name' | 'code' | 'start_time' | 'minutes' | 'colour'> & { id?: string; active?: boolean; sort_order?: number },
) {
  const { data, error } = await client.from('shift_templates').upsert(input, { onConflict: 'id' }).select('*').single();
  fail(error);
  return data as ShiftTemplate;
}

export async function listRotations(client: CriticomClient, silo: Silo, opts: { includeInactive?: boolean } = {}) {
  let q = client.from('rotations').select('*').eq('silo', silo);
  if (!opts.includeInactive) q = q.eq('active', true);
  const { data, error } = await q.order('name');
  fail(error);
  return (data ?? []) as Rotation[];
}

export async function saveRotation(
  client: CriticomClient,
  input: Pick<Rotation, 'silo' | 'name' | 'cycle' | 'teams' | 'offsets' | 'anchor' | 'skip_public_holidays'> & { id?: string; active?: boolean },
) {
  const { data, error } = await client.from('rotations').upsert(input, { onConflict: 'id' }).select('*').single();
  fail(error);
  return data as Rotation;
}

/** The department's late and no-show minutes; 10 and 60 until set. */
export async function getScheduleSettings(client: CriticomClient, silo: Silo): Promise<ScheduleSettings> {
  const { data } = await client.from('schedule_settings').select('grace_minutes, noshow_minutes').eq('silo', silo).maybeSingle();
  return { grace: data?.grace_minutes ?? 10, noshow: data?.noshow_minutes ?? 60 };
}

export async function saveScheduleSettings(
  client: CriticomClient,
  args: { silo: Silo; grace: number; noshow: number; byId?: string; byName?: string },
) {
  const { error } = await client.from('schedule_settings').upsert({
    silo: args.silo, grace_minutes: args.grace, noshow_minutes: args.noshow,
    updated_by: args.byId ?? null, updated_by_name: args.byName ?? null, updated_at: new Date().toISOString(),
  }, { onConflict: 'tenant_id,silo' });
  fail(error);
}

export async function listPublicHolidays(client: CriticomClient, args: { from: string; to: string }) {
  const { data, error } = await client.from('public_holidays').select('*')
    .gte('day', args.from).lte('day', args.to).order('day');
  fail(error);
  return (data ?? []) as PublicHoliday[];
}

export async function savePublicHoliday(client: CriticomClient, args: { day: string; name: string }) {
  const { error } = await client.from('public_holidays').upsert(args, { onConflict: 'tenant_id,day' });
  fail(error);
}

export async function removePublicHoliday(client: CriticomClient, day: string) {
  const { error } = await client.from('public_holidays').delete().eq('day', day);
  fail(error);
}

/* ── People ───────────────────────────────────────────────────────────── */

export type TeamMember = {
  userId: string;
  name: string;
  badge: string | null;
  rank: string | null;
  station: string | null;
  team: string | null;
  role: string;
};

/** The department's people with an account, and the team each is in. */
export async function listTeamMembers(client: CriticomClient, silo: Silo): Promise<TeamMember[]> {
  const [{ data: people, error }, { data: profiles }] = await Promise.all([
    client.from('personnel')
      .select('user_id, first_name, last_name, rank, badge_number, station, platoon, left_at')
      .eq('silo', silo).not('user_id', 'is', null),
    client.from('profiles').select('id, full_name, role, deactivated_at').eq('silo', silo),
  ]);
  fail(error);
  const byId = new Map((profiles ?? []).map((p) => [p.id as string, p as { id: string; full_name: string | null; role: string; deactivated_at: string | null }]));
  return ((people ?? []) as Array<{ user_id: string; first_name: string; last_name: string; rank: string | null; badge_number: string | null; station: string | null; platoon: string | null; left_at: string | null }>)
    .filter((p) => !p.left_at && byId.has(p.user_id) && !byId.get(p.user_id)!.deactivated_at)
    .map((p) => {
      const pr = byId.get(p.user_id)!;
      return {
        userId: p.user_id,
        name: pr.full_name || `${p.first_name} ${p.last_name}`.trim(),
        badge: p.badge_number,
        rank: p.rank,
        station: p.station,
        team: p.platoon,
        role: pr.role,
      };
    })
    .sort((a, b) => (a.team ?? '~').localeCompare(b.team ?? '~') || a.name.localeCompare(b.name));
}

export async function setMemberTeam(client: CriticomClient, userId: string, team: string | null) {
  const { error } = await client.rpc('set_member_team', { p_user: userId, p_team: team });
  fail(error);
}

/* ── The roster ───────────────────────────────────────────────────────── */

/** A department's lines over a period (drafts too, for those who roster it). */
export async function getRosterRange(
  client: CriticomClient,
  args: { silo: Silo; from: string; to: string },
): Promise<ScheduleLine[]> {
  const { data, error } = await client.from('rosters').select(LINE_COLUMNS)
    .eq('silo', args.silo).gte('duty_date', args.from).lte('duty_date', args.to)
    .not('start_at', 'is', null)
    .order('start_at');
  fail(error);
  return withAttendance(data ?? []);
}

export async function addShift(
  client: CriticomClient,
  args: { userId: string; day: string; templateId: string; publish?: boolean; note?: string | null },
) {
  const { data, error } = await client.rpc('add_shift', {
    p_user: args.userId, p_day: args.day, p_template: args.templateId,
    p_publish: args.publish ?? false, p_note: args.note ?? null,
  });
  fail(error);
  return data as string;
}

export type GenerateResult = Database['public']['Functions']['generate_roster']['Returns'];

export async function generateRoster(
  client: CriticomClient,
  args: { rotationId: string; from: string; to: string; teams?: string[] | null },
): Promise<GenerateResult> {
  const { data, error } = await client.rpc('generate_roster', {
    p_rotation: args.rotationId, p_from: args.from, p_to: args.to, p_teams: args.teams?.length ? args.teams : null,
  });
  fail(error);
  return data as GenerateResult;
}

export async function publishRoster(client: CriticomClient, args: { silo: Silo; from: string; to: string }) {
  const { data, error } = await client.rpc('publish_roster', { p_silo: args.silo, p_from: args.from, p_to: args.to });
  fail(error);
  return Number(data ?? 0);
}

export async function cancelShift(client: CriticomClient, rosterId: string, reason: string) {
  const { error } = await client.rpc('cancel_shift', { p_roster: rosterId, p_reason: reason });
  fail(error);
}

export async function listRosterChanges(client: CriticomClient, rosterId: string) {
  const { data, error } = await client.from('roster_changes').select('*').eq('roster_id', rosterId).order('at');
  fail(error);
  return (data ?? []) as RosterChange[];
}

/* ── Attendance ───────────────────────────────────────────────────────── */

/** Start shift at the console (desk staff): a clock-in that checks you in. */
export async function startMyShift(client: CriticomClient) {
  const { data, error } = await client.rpc('start_my_shift');
  fail(error);
  return data as Database['public']['Functions']['start_my_shift']['Returns'];
}

export async function recordShiftOutcome(client: CriticomClient, args: { rosterId: string; outcome: ShiftOutcome; reason: string }) {
  const { error } = await client.rpc('record_shift_outcome', { p_roster: args.rosterId, p_outcome: args.outcome, p_reason: args.reason });
  fail(error);
}

export type PunctualityRow = Database['public']['Functions']['attendance_summary']['Returns'][number];

export async function punctualitySummary(client: CriticomClient, args: { silo: Silo; from: string; to: string }) {
  const { data, error } = await client.rpc('attendance_summary', { p_silo: args.silo, p_from: args.from, p_to: args.to });
  fail(error);
  return (data ?? []) as PunctualityRow[];
}

/* ── My schedule ──────────────────────────────────────────────────────── */

/** My issued shifts over a period, with my attendance. */
export async function getMyLines(
  client: CriticomClient,
  args: { userId: string; from: string; to: string },
): Promise<ScheduleLine[]> {
  const { data, error } = await client.from('rosters').select(LINE_COLUMNS)
    .eq('user_id', args.userId).eq('published', true)
    .gte('duty_date', args.from).lte('duty_date', args.to)
    .not('start_at', 'is', null)
    .order('start_at');
  fail(error);
  return withAttendance(data ?? []);
}

export type MyMonth = {
  month: string;
  lines: ScheduleLine[];
  leave: Tables['leave_entries']['Row'][];
  holidays: PublicHoliday[];
  templates: ShiftTemplate[];
  settings: ScheduleSettings;
};

/** Everything the month calendar needs, for one person. */
export async function getMyMonth(
  client: CriticomClient,
  args: { userId: string; silo: Silo; month: string },
): Promise<MyMonth> {
  const { from, to } = monthRange(args.month);
  // The day before the month: a night shift that started then runs into it.
  const [lines, leaveRes, holidays, templates, settings] = await Promise.all([
    getMyLines(client, { userId: args.userId, from: addDays(from, -1), to }),
    client.from('leave_entries').select('*').eq('user_id', args.userId)
      .in('status', ['Pending', 'Approved']).lte('eff_from', to).gte('eff_to', from).order('eff_from'),
    listPublicHolidays(client, { from, to }).catch(() => [] as PublicHoliday[]),
    listShiftTemplates(client, args.silo, { includeInactive: true }).catch(() => [] as ShiftTemplate[]),
    getScheduleSettings(client, args.silo),
  ]);
  return { month: args.month, lines, leave: leaveRes.data ?? [], holidays, templates, settings };
}

/** My shift now, or the next one within the day ahead. */
export async function getMyShiftNow(client: CriticomClient, userId: string, now: number = Date.now()): Promise<ScheduleLine | null> {
  const today = saDay(now);
  const lines = await getMyLines(client, { userId, from: addDays(today, -1), to: addDays(today, 1) });
  const active = lines.filter((l) => lineActive(l.status, l.cancelled_at) && Date.parse(l.end_at!) > now);
  const current = active.find((l) => Date.parse(l.start_at!) - 3 * 3_600_000 <= now);
  return current ?? active.find((l) => Date.parse(l.start_at!) - now < 24 * 3_600_000) ?? null;
}

export type WhosOnRow = Pick<RosterRow,
  'id' | 'user_id' | 'user_name' | 'start_at' | 'end_at' | 'status' | 'post' | 'station' | 'template_id' | 'cancelled_at' | 'team' | 'vehicle' | 'call_sign'>;

/**
 * Who works a day in a department: issued shifts that start that day, or
 * started the day before and run into it. Never why someone is off.
 */
export async function getWhosOn(client: CriticomClient, args: { silo: Silo; day: string }): Promise<WhosOnRow[]> {
  const { data, error } = await client.from('rosters')
    .select('id, user_id, user_name, start_at, end_at, status, post, station, template_id, cancelled_at, team, vehicle, call_sign')
    .eq('silo', args.silo).eq('published', true)
    .gte('duty_date', addDays(args.day, -1)).lte('duty_date', args.day)
    .not('start_at', 'is', null)
    .order('start_at');
  fail(error);
  const dayStart = Date.parse(`${args.day}T00:00:00+02:00`);
  return ((data ?? []) as WhosOnRow[])
    .filter((r) => !r.cancelled_at && Date.parse(r.end_at!) > dayStart);
}

/** Colleagues' issued shifts ahead, to offer one of mine for (the database checks the swap). */
export async function listSwapOptions(
  client: CriticomClient,
  args: { silo: Silo; userId: string; from: string; to: string },
): Promise<WhosOnRow[]> {
  const { data, error } = await client.from('rosters')
    .select('id, user_id, user_name, start_at, end_at, status, post, station, template_id, cancelled_at, team, vehicle, call_sign')
    .eq('silo', args.silo).eq('published', true).is('cancelled_at', null).neq('user_id', args.userId)
    .gte('duty_date', args.from).lte('duty_date', args.to)
    .gt('start_at', new Date(Date.now() + 3_600_000).toISOString())
    .order('start_at')
    .limit(300);
  fail(error);
  return ((data ?? []) as WhosOnRow[]).filter((r) => lineActive(r.status, r.cancelled_at));
}

/* ── Leave ────────────────────────────────────────────────────────────── */

export async function decideLeave(client: CriticomClient, args: { id: string; approve: boolean; comment?: string | null }) {
  const { data, error } = await client.rpc('decide_leave', { p_id: args.id, p_approve: args.approve, p_comment: args.comment ?? null });
  fail(error);
  return data as Tables['leave_entries']['Row'];
}

export async function cancelLeave(client: CriticomClient, args: { id: string; reason?: string | null }) {
  const { data, error } = await client.rpc('cancel_leave', { p_id: args.id, p_reason: args.reason ?? null });
  fail(error);
  return data as Tables['leave_entries']['Row'];
}

/* ── Swaps ────────────────────────────────────────────────────────────── */

export async function requestSwap(
  client: CriticomClient,
  args: { id: string; myLine: string; theirLine: string; note?: string | null },
) {
  const { error } = await client.rpc('request_swap', { p_id: args.id, p_my_line: args.myLine, p_their_line: args.theirLine, p_note: args.note ?? null });
  fail(error);
}

export async function respondSwap(client: CriticomClient, args: { id: string; accept: boolean }) {
  const { error } = await client.rpc('respond_swap', { p_id: args.id, p_accept: args.accept });
  fail(error);
}

export async function decideSwap(client: CriticomClient, args: { id: string; approve: boolean; comment?: string | null }) {
  const { error } = await client.rpc('decide_swap', { p_id: args.id, p_approve: args.approve, p_comment: args.comment ?? null });
  fail(error);
}

export async function withdrawSwap(client: CriticomClient, id: string) {
  const { error } = await client.rpc('withdraw_swap', { p_id: id });
  fail(error);
}

export type SwapView = ShiftSwap & { mine: RosterRow | null; theirs: RosterRow | null };

/** Swaps I can see (mine, offered to me, or in a department I roster), open ones first. */
export async function listSwaps(client: CriticomClient, opts: { silo?: Silo; open?: boolean } = {}): Promise<SwapView[]> {
  let q = client.from('shift_swaps').select('*').order('created_at', { ascending: false }).limit(100);
  if (opts.silo) q = q.eq('silo', opts.silo);
  if (opts.open) q = q.in('status', ['Requested', 'Accepted']);
  const { data, error } = await q;
  fail(error);
  const swaps = (data ?? []) as ShiftSwap[];
  const ids = [...new Set(swaps.flatMap((s) => [s.requester_line, s.partner_line]))];
  const lines = new Map<string, RosterRow>();
  if (ids.length) {
    const { data: rows } = await client.from('rosters').select('*').in('id', ids);
    for (const r of (rows ?? []) as RosterRow[]) lines.set(r.id, r);
  }
  return swaps.map((s) => ({ ...s, mine: lines.get(s.requester_line) ?? null, theirs: lines.get(s.partner_line) ?? null }));
}
