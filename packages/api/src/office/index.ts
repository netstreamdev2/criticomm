import type { CriticomClient, Database, ModuleCode, ModuleLevel, Silo } from '@criticom/db';
import { tx } from '@criticom/db/i18n';

/**
 * The duty office (migration 0085), eThekwini's Oracle screens: staff
 * maintenance, call signs, sections, endorsements, absence codes, duty
 * allocation, duty maintenance, duties for operation and maintain leave.
 *
 * Every write goes through a database function that checks the person's
 * access to that screen (View or Edit, granted per person); these wrappers
 * only shape the calls.
 */

type Tables = Database['public']['Tables'];
export type Station = Tables['stations']['Row'];
export type SectionRow = Tables['sections']['Row'];
export type CallSign = Tables['duty_posts']['Row'];
export type StaffPrivate = Tables['staff_private']['Row'];
export type LeoRecord = Tables['leo_records']['Row'];
export type EndorsementRow = Tables['endorsements']['Row'];
export type LeaveRow = Tables['leave_entries']['Row'];
export type AbsenceCode = Tables['command_records']['Row'];
export type MyModules = Partial<Record<ModuleCode, ModuleLevel>>;

const fail = (error: { message: string } | null) => {
  if (error) throw new Error(error.message);
};

/* ── The screens ──────────────────────────────────────────────────────── */

export type OfficeModule = {
  code: ModuleCode;
  label: string;
  href: string;
  group: 'staff' | 'duty';
  /** What the screen is for, in a line: the (i) beside its title. */
  info: string;
};

/** The duty office screens, in the order the old system lists them. */
export const OFFICE_MODULES: OfficeModule[] = [
  { code: 'STFM', label: tx('Staff Maintenance'), href: '/modules/staff', group: 'staff',
    info: tx('Each member’s record: numbers, rank, station, section, weekend group, contacts and access.') },
  { code: 'CSNM', label: tx('Call Signs'), href: '/modules/call-signs', group: 'staff',
    info: tx('Each call sign with its patrol area, hours, break and the rank it needs.') },
  { code: 'SECM', label: tx('Sections'), href: '/modules/sections', group: 'staff',
    info: tx('The units duty is allocated to, and the stations they work from.') },
  { code: 'ENTM', label: tx('Endorsements'), href: '/modules/endorsements', group: 'staff',
    info: tx('Instructions for a member, such as court. They print on the duty sheet.') },
  { code: 'DUTA', label: tx('Duty Allocation'), href: '/modules/duty-allocation', group: 'duty',
    info: tx('Pick a section and dates, then pair call signs with staff.') },
  { code: 'DUTM', label: tx('Duty Maintenance'), href: '/modules/duty-maintenance', group: 'duty',
    info: tx('Look up who worked a call sign, and change a duty.') },
  { code: 'DUTR', label: tx('Duty Operations'), href: '/modules/duty-operations', group: 'duty',
    info: tx('The daily duty sheet for parade: sign on, sign off and overtime.') },
  { code: 'ABSM', label: tx('Absence'), href: '/modules/absence', group: 'duty',
    info: tx('The absence codes: AL, SL, AWOL and the rest.') },
  { code: 'LEAM', label: tx('Leave'), href: '/modules/leave', group: 'duty',
    info: tx('Approve leave and capture leave or absence for a member.') },
];

export const MODULE_BY_CODE = Object.fromEntries(OFFICE_MODULES.map((m) => [m.code, m])) as Record<ModuleCode, OfficeModule>;

/** The signed-in person's screens and level on each. */
export async function getMyModules(client: CriticomClient): Promise<MyModules> {
  const { data, error } = await client.rpc('my_modules');
  fail(error);
  const out: MyModules = {};
  for (const r of (data ?? []) as Array<{ module: ModuleCode; level: ModuleLevel }>) out[r.module] = r.level;
  return out;
}

export async function setModuleAccess(client: CriticomClient, args: { userId: string; module: ModuleCode; level: ModuleLevel | null }) {
  const { error } = await client.rpc('set_module_access', { p_user: args.userId, p_module: args.module, p_level: args.level });
  fail(error);
}

export async function listModuleAccess(client: CriticomClient, userId: string) {
  const { data, error } = await client.from('module_access').select('*').eq('user_id', userId);
  fail(error);
  return (data ?? []) as Tables['module_access']['Row'][];
}

/* ── How far a department's duty office is set up ─────────────────────── */

export type OfficeSetup = {
  /** Sections in use. */
  sections: number;
  /** Call signs in use that belong to a section. */
  callSigns: number;
  /** Staff who can be booked: a login, a section, duty allocation Y, not left. */
  ready: number;
  /** Duties booked from today on. */
  booked: number;
};

/** The setup path's ticks, from the data itself: nobody ticks anything by hand. */
export async function getOfficeSetup(client: CriticomClient, silo: Silo): Promise<OfficeSetup> {
  const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;
  const today = new Date(Date.now() + 2 * 3_600_000).toISOString().slice(0, 10);
  const [sections, callSigns, ready, booked] = await Promise.all([
    count(client.from('sections').select('id', { count: 'exact', head: true }).eq('silo', silo).eq('active', true)),
    count(client.from('duty_posts').select('id', { count: 'exact', head: true }).eq('silo', silo).eq('active', true)
      .not('call_sign', 'is', null).not('section_id', 'is', null)),
    count(client.from('personnel').select('id', { count: 'exact', head: true }).eq('silo', silo)
      .not('user_id', 'is', null).not('section_id', 'is', null).is('left_at', null).eq('duty_allocation', true)),
    count(client.from('rosters').select('id', { count: 'exact', head: true }).eq('silo', silo)
      .not('post_id', 'is', null).is('cancelled_at', null).gte('duty_date', today)),
  ]);
  return { sections, callSigns, ready, booked };
}

/* ── Stations and sections ────────────────────────────────────────────── */

export async function listStations(client: CriticomClient, silo: Silo, opts: { includeInactive?: boolean } = {}) {
  let q = client.from('stations').select('*').eq('silo', silo);
  if (!opts.includeInactive) q = q.eq('active', true);
  const { data, error } = await q.order('code');
  fail(error);
  return (data ?? []) as Station[];
}

export async function saveStation(
  client: CriticomClient,
  a: { id?: string | null; silo: Silo; code: string; name: string; zone?: string | null; active?: boolean },
) {
  const { data, error } = await client.rpc('save_station', {
    p_id: a.id ?? null, p_silo: a.silo, p_code: a.code, p_name: a.name, p_zone: a.zone ?? null, p_active: a.active ?? true,
  });
  fail(error);
  return data as string;
}

export async function listSectionDetails(client: CriticomClient, silo: Silo, opts: { includeInactive?: boolean } = {}) {
  let q = client.from('sections').select('*').eq('silo', silo);
  if (!opts.includeInactive) q = q.eq('active', true);
  const { data, error } = await q.order('name');
  fail(error);
  return (data ?? []) as SectionRow[];
}

export async function saveSection(
  client: CriticomClient,
  a: {
    id?: string | null; silo: Silo; code: string; name: string; short?: string | null; station?: string | null;
    zone?: string | null; division?: string | null; overtime?: string | null; active?: boolean;
  },
) {
  const { data, error } = await client.rpc('save_section', {
    p_id: a.id ?? null, p_silo: a.silo, p_code: a.code, p_name: a.name, p_short: a.short ?? null,
    p_station: a.station ?? null, p_zone: a.zone ?? null, p_division: a.division ?? null,
    p_overtime: a.overtime ?? null, p_active: a.active ?? true,
  });
  fail(error);
  return data as string;
}

/* ── Call signs ───────────────────────────────────────────────────────── */

export async function listCallSigns(
  client: CriticomClient,
  args: { silo: Silo; sectionId?: string | null; includeInactive?: boolean },
) {
  let q = client.from('duty_posts').select('*').eq('silo', args.silo).not('call_sign', 'is', null);
  if (args.sectionId) q = q.eq('section_id', args.sectionId);
  if (!args.includeInactive) q = q.eq('active', true);
  const { data, error } = await q.order('call_sign');
  fail(error);
  return (data ?? []) as CallSign[];
}

export async function saveCallSign(
  client: CriticomClient,
  a: {
    id?: string | null; silo: Silo; callSign: string; station?: string | null; sectionId?: string | null;
    start: string; stop: string; breakAt?: string | null; rank?: string | null; description?: string | null; active?: boolean;
  },
) {
  const { data, error } = await client.rpc('save_call_sign', {
    p_id: a.id ?? null, p_silo: a.silo, p_call_sign: a.callSign, p_station: a.station ?? null,
    p_section: a.sectionId ?? null, p_start: a.start, p_stop: a.stop, p_break: a.breakAt ?? null,
    p_rank: a.rank ?? null, p_description: a.description ?? null, p_active: a.active ?? true,
  });
  fail(error);
  return data as string;
}

/* ── Staff ────────────────────────────────────────────────────────────── */

export type StaffRow = Pick<
  Tables['personnel']['Row'],
  | 'id' | 'user_id' | 'silo' | 'first_name' | 'last_name' | 'badge_number' | 'rank' | 'force_number' | 'service_number'
  | 'persal_number' | 'station' | 'section_id' | 'platoon' | 'weekend_group' | 'duty_allocation' | 'left_at'
>;
const STAFF_COLUMNS =
  'id, user_id, silo, first_name, last_name, badge_number, rank, force_number, service_number, persal_number, station, section_id, platoon, weekend_group, duty_allocation, left_at';

/** The department's staff, newest names first, filtered as the Oracle screen does. */
export async function listStaff(
  client: CriticomClient,
  args: { silo: Silo; station?: string | null; rank?: string | null; search?: string | null; includeLeft?: boolean },
) {
  let q = client.from('personnel').select(STAFF_COLUMNS).eq('silo', args.silo);
  if (args.station) q = q.eq('station', args.station);
  if (args.rank) q = q.eq('rank', args.rank);
  if (!args.includeLeft) q = q.is('left_at', null);
  const s = args.search?.trim().replace(/[%,()]/g, ' ');
  if (s) {
    q = q.or(`first_name.ilike.%${s}%,last_name.ilike.%${s}%,badge_number.ilike.%${s}%,service_number.ilike.%${s}%,force_number.ilike.%${s}%,persal_number.ilike.%${s}%`);
  }
  const { data, error } = await q.order('last_name').order('first_name').limit(500);
  fail(error);
  return (data ?? []) as StaffRow[];
}

export type StaffRecord = {
  person: Tables['personnel']['Row'];
  /** Null when you may not read it, or nothing is captured yet. */
  private: StaffPrivate | null;
  leo: LeoRecord[];
  access: Tables['module_access']['Row'][];
  account: { email: string | null; role: string | null } | null;
};

export async function getStaffRecord(client: CriticomClient, personnelId: string): Promise<StaffRecord | null> {
  const { data: person, error } = await client.from('personnel').select('*').eq('id', personnelId).maybeSingle();
  fail(error);
  if (!person) return null;
  const p = person as Tables['personnel']['Row'];
  const [priv, leo, access, account] = await Promise.all([
    client.from('staff_private').select('*').eq('personnel_id', p.id).maybeSingle(),
    client.from('leo_records').select('*').eq('personnel_id', p.id).order('eff_from', { ascending: false }),
    p.user_id ? client.from('module_access').select('*').eq('user_id', p.user_id) : Promise.resolve({ data: [] }),
    p.user_id ? client.from('profiles').select('email, role').eq('id', p.user_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return {
    person: p,
    private: (priv.data ?? null) as StaffPrivate | null,
    leo: (leo.data ?? []) as LeoRecord[],
    access: (access.data ?? []) as Tables['module_access']['Row'][],
    account: (account.data ?? null) as { email: string | null; role: string | null } | null,
  };
}

export async function saveStaffRecord(
  client: CriticomClient,
  a: { personnelId?: string | null; silo: Silo; fields: Record<string, unknown>; private?: Record<string, unknown> },
) {
  const { data, error } = await client.rpc('save_staff_record', {
    p_personnel: a.personnelId ?? null, p_silo: a.silo, p_fields: a.fields, p_private: a.private ?? {},
  });
  fail(error);
  return data as string;
}

export async function addLeoRecord(
  client: CriticomClient,
  a: { personnelId: string; radio?: string | null; from?: string | null; to?: string | null; area?: string | null; region?: string | null },
) {
  const { error } = await client.rpc('add_leo_record', {
    p_personnel: a.personnelId, p_radio: a.radio ?? null, p_from: a.from || null, p_to: a.to || null,
    p_area: a.area ?? null, p_region: a.region ?? null,
  });
  fail(error);
}

export async function removeLeoRecord(client: CriticomClient, id: string) {
  const { error } = await client.rpc('remove_leo_record', { p_id: id });
  fail(error);
}

/* ── Endorsements ─────────────────────────────────────────────────────── */

export async function listEndorsementRegister(
  client: CriticomClient,
  args: { silo: Silo; search?: string | null; issuer?: string | null; includeInactive?: boolean },
) {
  let q = client.from('endorsements').select('*').eq('silo', args.silo);
  if (!args.includeInactive) q = q.eq('is_active', true);
  if (args.issuer) q = q.eq('issued_by_name', args.issuer);
  const s = args.search?.trim().replace(/[%,()]/g, ' ');
  if (s) q = q.or(`details.ilike.%${s}%,employee_name.ilike.%${s}%,code.ilike.%${s}%,badge_number.ilike.%${s}%`);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(300);
  fail(error);
  return (data ?? []) as EndorsementRow[];
}

export async function issueEndorsement(
  client: CriticomClient,
  a: { userId: string; type: string; code?: string | null; details: string; start: string; end?: string | null },
) {
  const { error } = await client.rpc('issue_endorsement', {
    p_user: a.userId, p_type: a.type, p_code: a.code ?? null, p_details: a.details, p_start: a.start, p_end: a.end || null,
  });
  fail(error);
}

export async function withdrawEndorsement(client: CriticomClient, id: string) {
  const { error } = await client.rpc('withdraw_endorsement', { p_id: id });
  fail(error);
}

/* ── Absence codes ────────────────────────────────────────────────────── */

export async function listAbsenceCodes(client: CriticomClient, opts: { includeInactive?: boolean } = {}) {
  let q = client.from('command_records').select('*').eq('module', 'LeaveType');
  if (!opts.includeInactive) q = q.eq('status', 'Active');
  const { data, error } = await q.order('code');
  fail(error);
  return (data ?? []) as AbsenceCode[];
}

/** Office-only codes (AWOL, Suspended …) are captured by the office, never asked for. */
export const isOfficeOnly = (c: Pick<AbsenceCode, 'detail2'>) => c.detail2 === 'Office';

export async function saveAbsenceCode(
  client: CriticomClient,
  a: { id?: string | null; code: string; name: string; officeOnly: boolean; entitlement?: number | null; active?: boolean },
) {
  const { error } = await client.rpc('save_absence_code', {
    p_id: a.id ?? null, p_code: a.code, p_name: a.name, p_office_only: a.officeOnly,
    p_entitlement: a.entitlement ?? null, p_active: a.active ?? true,
  });
  fail(error);
}

/* ── Leave ────────────────────────────────────────────────────────────── */

export async function listLeaveRegister(
  client: CriticomClient,
  args: { silo: Silo; status?: string | null; code?: string | null; form?: boolean | null; search?: string | null; limit?: number },
) {
  let q = client.from('leave_entries').select('*').eq('silo', args.silo);
  if (args.status) q = q.eq('status', args.status);
  if (args.code) q = q.eq('absence_code', args.code);
  if (args.form != null) q = q.eq('form_submitted', args.form);
  const s = args.search?.trim().replace(/[%,()]/g, ' ');
  if (s) q = q.or(`applicant_name.ilike.%${s}%,leave_seq.ilike.%${s}%,absence.ilike.%${s}%`);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(args.limit ?? 200);
  fail(error);
  return (data ?? []) as LeaveRow[];
}

export async function captureLeave(
  client: CriticomClient,
  a: { userId: string; code: string; from: string; to: string; formSubmitted: boolean; notes?: string | null },
) {
  const { data, error } = await client.rpc('capture_leave', {
    p_user: a.userId, p_code: a.code, p_from: a.from, p_to: a.to, p_form_submitted: a.formSubmitted, p_notes: a.notes ?? null,
  });
  fail(error);
  return data as LeaveRow;
}

export async function setLeaveForm(client: CriticomClient, a: { id: string; submitted: boolean }) {
  const { error } = await client.rpc('set_leave_form', { p_id: a.id, p_submitted: a.submitted });
  fail(error);
}

/* ── Duty allocation ──────────────────────────────────────────────────── */

export type AvailableStaff = {
  userId: string;
  name: string;
  rank: string | null;
  force: string | null;
  weekend: string | null;
  badge: string;
  /** Why they cannot work some of the dates, when known: leave or court. */
  away: string | null;
};

/**
 * Staff who can be allocated in a department: an account, not left, and
 * marked Y for duty allocation. Leave and court in the dates are shown, so
 * the office sees why a day will be left out before allocating.
 */
export async function listAvailableStaff(
  client: CriticomClient,
  args: { silo: Silo; from: string; to: string },
): Promise<AvailableStaff[]> {
  const [{ data: people, error }, { data: leave }, { data: court }] = await Promise.all([
    client.from('personnel')
      .select('user_id, first_name, last_name, rank, force_number, weekend_group, badge_number, duty_allocation, left_at')
      .eq('silo', args.silo).not('user_id', 'is', null).is('left_at', null).eq('duty_allocation', true)
      .order('rank').order('last_name').limit(1000),
    client.from('leave_entries').select('user_id, absence, eff_from, eff_to')
      .eq('silo', args.silo).eq('status', 'Approved').lte('eff_from', args.to).gte('eff_to', args.from),
    client.from('endorsements').select('user_id, start_date, end_date')
      .eq('silo', args.silo).eq('is_active', true).eq('type', 'Court Attendance')
      .lte('start_date', args.to).or(`end_date.is.null,end_date.gte.${args.from}`),
  ]);
  fail(error);
  const away = new Map<string, string>();
  for (const l of leave ?? []) if (l.user_id) away.set(l.user_id, `${l.absence ?? 'Leave'} ${l.eff_from}–${l.eff_to}`);
  for (const c of court ?? []) if (c.user_id && !away.has(c.user_id)) away.set(c.user_id, `Court ${c.start_date}`);
  return (people ?? []).map((p) => ({
    userId: p.user_id as string,
    name: `${(p.last_name ?? '').toUpperCase()} ${p.first_name ?? ''}`.trim(),
    rank: p.rank || null,
    force: p.force_number,
    weekend: p.weekend_group,
    badge: p.badge_number,
    away: away.get(p.user_id as string) ?? null,
  }));
}

export type AllocationResult = { created: number; skipped: Array<{ name: string; call_sign: string; day: string; reason: string }> };

export async function allocateDuty(
  client: CriticomClient,
  a: {
    sectionId: string; from: string; to: string; lines: Array<{ post_id: string; user_id: string }>;
    start?: string | null; end?: string | null; note?: string | null;
  },
): Promise<AllocationResult> {
  const { data, error } = await client.rpc('allocate_duty', {
    p_section: a.sectionId, p_from: a.from, p_to: a.to, p_lines: a.lines,
    p_start: a.start || null, p_end: a.end || null, p_note: a.note || null,
  });
  fail(error);
  return data as AllocationResult;
}

/* ── Duty maintenance ─────────────────────────────────────────────────── */

export type DutyRecord = Tables['rosters']['Row'] & { rank: string | null; force: string | null };

/** Duty records: by call sign (its history), or the department's, newest first. */
export async function listDutyRecords(
  client: CriticomClient,
  args: { silo: Silo; postId?: string | null; sector?: string | null; search?: string | null; limit?: number },
): Promise<DutyRecord[]> {
  let q = client.from('rosters').select('*').eq('silo', args.silo).is('cancelled_at', null).not('post_id', 'is', null);
  if (args.postId) q = q.eq('post_id', args.postId);
  if (args.sector) q = q.eq('sector', args.sector);
  const s = args.search?.trim().replace(/[%,()]/g, ' ');
  if (s) q = q.or(`user_name.ilike.%${s}%,call_sign.ilike.%${s}%,badge_number.ilike.%${s}%`);
  const { data, error } = await q.order('start_at', { ascending: false }).limit(args.limit ?? 100);
  fail(error);
  const lines = (data ?? []) as Tables['rosters']['Row'][];
  const ids = [...new Set(lines.map((l) => l.user_id).filter(Boolean))] as string[];
  const { data: people } = ids.length
    ? await client.from('personnel').select('user_id, rank, force_number').in('user_id', ids)
    : { data: [] as Array<{ user_id: string | null; rank: string; force_number: string | null }> };
  const by = new Map((people ?? []).map((p) => [p.user_id, p]));
  return lines.map((l) => ({ ...l, rank: by.get(l.user_id)?.rank || null, force: by.get(l.user_id)?.force_number ?? null }));
}

export async function changeDuty(
  client: CriticomClient,
  a: { lineId: string; postId?: string | null; userId?: string | null; start?: string | null; end?: string | null },
) {
  const { error } = await client.rpc('change_duty', {
    p_line: a.lineId, p_post: a.postId || null, p_user: a.userId || null, p_start: a.start || null, p_end: a.end || null,
  });
  fail(error);
}

/* ── Duties for operation (the parade sheet) ──────────────────────────── */

export type SheetLine = {
  id: string;
  rank: string | null;
  force: string | null;
  weekend: string | null;
  serviceNo: string | null;
  name: string;
  callSign: string | null;
  start: string | null;
  end: string | null;
  duty: string;
  status: string;
  /** Signed on / off in the app, when they did. */
  signedOn: string | null;
  signedOff: string | null;
};

export type OperationsSheet = {
  lines: SheetLine[];
  onLeave: Array<{ name: string; absence: string; from: string; to: string }>;
  operations: AbsenceCode[];
};

/** Everyone on duty for a section (or the whole department) on a day, as the parade sheet prints them. */
export async function getOperationsSheet(
  client: CriticomClient,
  args: { silo: Silo; date: string; sector?: string | null },
): Promise<OperationsSheet> {
  let q = client.from('rosters').select('*').eq('silo', args.silo).eq('duty_date', args.date)
    .is('cancelled_at', null).eq('published', true);
  if (args.sector) q = q.eq('sector', args.sector);
  const [{ data: lines, error }, { data: leave }, { data: ops }, { data: endorse }] = await Promise.all([
    q.order('start_at').order('call_sign'),
    client.from('leave_entries').select('applicant_name, absence, eff_from, eff_to')
      .eq('silo', args.silo).eq('status', 'Approved').lte('eff_from', args.date).gte('eff_to', args.date),
    client.from('command_records').select('*').eq('module', 'DutyOperation').eq('status', 'Active').order('code'),
    client.from('endorsements').select('user_id, type, code, details')
      .eq('silo', args.silo).eq('is_active', true).lte('start_date', args.date).or(`end_date.is.null,end_date.gte.${args.date}`),
  ]);
  fail(error);
  const rs = (lines ?? []) as Tables['rosters']['Row'][];
  const ids = [...new Set(rs.map((l) => l.user_id).filter(Boolean))] as string[];
  const [{ data: people }, { data: att }] = await Promise.all([
    ids.length
      ? client.from('personnel').select('user_id, rank, force_number, weekend_group, service_number').in('user_id', ids)
      : Promise.resolve({ data: [] as Array<{ user_id: string | null; rank: string; force_number: string | null; weekend_group: string | null; service_number: string | null }> }),
    rs.length
      ? client.from('shift_attendance').select('roster_id, checked_in_at, ended_at').in('roster_id', rs.map((r) => r.id))
      : Promise.resolve({ data: [] as Array<{ roster_id: string; checked_in_at: string | null; ended_at: string | null }> }),
  ]);
  const person = new Map((people ?? []).map((p) => [p.user_id, p]));
  const signed = new Map((att ?? []).map((a) => [a.roster_id, a]));
  const notes = new Map<string, string[]>();
  for (const e of endorse ?? []) {
    if (!e.user_id) continue;
    const list = notes.get(e.user_id) ?? [];
    list.push([e.code, e.details ?? e.type].filter(Boolean).join(' '));
    notes.set(e.user_id, list);
  }
  return {
    lines: rs.map((l) => {
      const p = person.get(l.user_id);
      const a = signed.get(l.id);
      return {
        id: l.id,
        rank: p?.rank || null,
        force: p?.force_number ?? null,
        weekend: p?.weekend_group ?? null,
        serviceNo: p?.service_number ?? null,
        name: l.user_name,
        callSign: l.call_sign,
        start: l.start_at,
        end: l.end_at,
        duty: [l.call_sign, l.special_instructions, ...(l.user_id ? notes.get(l.user_id) ?? [] : [])].filter(Boolean).join(' · '),
        status: l.status,
        signedOn: a?.checked_in_at ?? null,
        signedOff: a?.ended_at ?? null,
      };
    }),
    onLeave: (leave ?? []).map((l) => ({ name: l.applicant_name ?? '', absence: l.absence ?? 'Leave', from: l.eff_from, to: l.eff_to })),
    operations: (ops ?? []) as AbsenceCode[],
  };
}
