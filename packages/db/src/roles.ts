/**
 * Central role/permission matrix — the single source of truth for
 * route-level authorization on web + mobile.
 *
 * Mirrors every `[Authorize(Roles = …)]` attribute in V4 controllers:
 *   ControlRoom/Dispatch  → "SystemAdmin, Dispatcher, ControlRoom, IncidentLogger, Operator"
 *   Incidents/Reports     → "Dispatcher, Viewer, ControlRoom" (+ admin tier)
 *   CaseManager           → the wide dispatcher/admin/viewer list
 *   Metro (police)        → "Captain, SuperAdmin, SystemAdmin, Admin" + field roles
 *   Fire                  → "Chief, FireChief, Firefighter"
 *   Disaster              → "SystemAdmin, SuperAdmin, Dispatcher, ControlRoom, IncidentLogger, Disaster, Viewer"
 *   Roster                → "System, SystemAdmin, SuperAdmin, Admin, Supervisor, Captain, FireChief, Chief"
 *   Performance           → "Supervisor, SystemAdmin, SuperAdmin, System"
 *   Leave/HR              → "Staff, Admin, SuperAdmin, SystemAdmin"
 *   DevAdmin/Super        → "SystemAdmin, SuperAdmin" (+ Admin for sub-areas)
 *
 * V4 also used Operator, Officer, Metro, Security, Chief, Responder and
 * Citizen. Those are retired (migration 0045) and appear in no list below.
 */

import type { Silo, UserRole } from './types.generated';

/**
 * Roles the platform no longer uses. Postgres cannot drop an enum value, so
 * they stay in `user_role`, but 0045 moved every holder to a replacement and a
 * CHECK constraint refuses them. No list or route rule may name them again.
 *
 *   Officer, Metro → Police       Chief → FireChief       Operator → ControlRoom
 *   Responder → the department's field role       Security, Citizen → Staff
 */
export const RETIRED_ROLES: readonly UserRole[] = [
  'Officer', 'Metro', 'Chief', 'Operator', 'Responder', 'Security', 'Citizen',
];

/**
 * Every role a person can be given, in the order the admin pickers list them.
 * `System` is absent: it is the automation account, never a person.
 */
export const ASSIGNABLE_ROLES: UserRole[] = [
  'SuperAdmin', 'SystemAdmin', 'Admin', 'SystemController', 'Supervisor',
  'Dispatcher', 'ControlRoom', 'IncidentLogger', 'CaseManager', 'Viewer',
  'Captain', 'Police', 'FireChief', 'Firefighter', 'Paramedic', 'Doctor', 'Disaster',
  'Staff',
];

/**
 * Roles that reach past one department. A department Admin never grants or
 * removes them. Mirrors `c_tenant_wide` in vet_account_change() (0048).
 */
export const TENANT_WIDE_ROLES: UserRole[] = [
  'SuperAdmin', 'SystemAdmin', 'Admin', 'SystemController', 'System',
  'Dispatcher', 'ControlRoom', 'IncidentLogger', 'Viewer',
];

type Account = { id: string; role: UserRole; silo: Silo };

/**
 * The roles `actor` may give `target` — empty when they may not change it at
 * all. Mirrors vet_account_change() (0048), which has the final word:
 * SuperAdmin grants anything; SystemAdmin anything but SuperAdmin; a
 * department Admin only department roles, inside their own department; and
 * nobody changes their own.
 */
export function rolesAssignableBy(actor: Account, target: Account): UserRole[] {
  if (actor.id === target.id) return [];
  if (actor.role === 'SuperAdmin') return ASSIGNABLE_ROLES;
  if (actor.role === 'SystemAdmin') {
    return target.role === 'SuperAdmin' ? [] : ASSIGNABLE_ROLES.filter((r) => r !== 'SuperAdmin');
  }
  if (actor.role === 'Admin') {
    if (target.silo !== actor.silo || TENANT_WIDE_ROLES.includes(target.role)) return [];
    return ASSIGNABLE_ROLES.filter((r) => !TENANT_WIDE_ROLES.includes(r));
  }
  return [];
}

/* ── Account safety rules (0048) ──────────────────────────────────────── */

/** A tenant always keeps at least this many active SystemAdmins. */
export const MIN_SYSTEM_ADMINS = 2;

/** Roles whose grant, removal or change waits for a second SystemAdmin. */
export const POWERFUL_ROLES: UserRole[] = ['SuperAdmin', 'SystemAdmin', 'Admin', 'SystemController'];

/**
 * Whether a change waits for a second SystemAdmin: anything that touches a
 * powerful role, unless the SuperAdmin makes it. For a deactivation, `from`
 * and `to` are both the account's role. Mirrors change_account_role() and
 * set_account_active().
 */
export function needsSecondApproval(actor: UserRole, from: UserRole, to: UserRole): boolean {
  return actor !== 'SuperAdmin' && (POWERFUL_ROLES.includes(from) || POWERFUL_ROLES.includes(to));
}

/** Compare a typed confirmation the way the database does: trimmed, spaces collapsed, any case. */
export function normaliseConfirm(text: string | null | undefined): string {
  return (text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * What an administrator types back to confirm a change to an account: its
 * badge number (on the profile, else on the linked personnel record), else
 * its full name. Mirrors account_confirm_word() (0048).
 */
export function confirmWordFor(
  account: { id: string; badge_number: string | null; full_name: string | null },
  personnelBadge?: string | null,
): { word: string; kind: 'badge number' | 'full name' | 'account id' } {
  const badge = account.badge_number?.trim() || personnelBadge?.trim();
  if (badge) return { word: badge, kind: 'badge number' };
  const name = account.full_name?.trim();
  if (name) return { word: name, kind: 'full name' };
  return { word: account.id, kind: 'account id' };
}

/**
 * The parts of the platform a role can open, in words an administrator reads
 * before confirming a change. Screens every account has (dashboard, leave,
 * search, profile) are left out: they never change.
 */
const AREAS: Array<{ label: string; path: string }> = [
  { label: 'Log incoming calls', path: '/dispatch/log-call' },
  { label: 'Dispatch queue', path: '/dispatch/pending' },
  { label: 'Assign incidents to officers', path: '/dispatch/assign/x' },
  { label: 'Radio (push-to-talk)', path: '/dispatch/ptt' },
  { label: 'Incidents', path: '/incidents' },
  { label: 'Responder screens', path: '/responder' },
  { label: 'Start of shift', path: '/shift' },
  { label: 'Readiness review', path: '/shift/readiness-review' },
  { label: 'Metro Police section', path: '/police' },
  { label: 'Fire & Rescue section', path: '/fire' },
  { label: 'EMS / Medical section', path: '/medical' },
  { label: 'Disaster Management section', path: '/disaster' },
  { label: 'Command dashboard', path: '/command' },
  { label: 'Build rosters', path: '/roster' },
  { label: 'Duty allocation', path: '/roster/allocation' },
  { label: 'HR centre', path: '/hr' },
  { label: 'Training records', path: '/training' },
  { label: 'Performance management', path: '/performance' },
  { label: 'Analytics', path: '/analytics' },
  { label: 'Report hub', path: '/report-hub' },
  { label: 'Case manager', path: '/case-manager' },
  { label: 'Body cams (live)', path: '/cameras' },
  { label: 'Body cam footage', path: '/cameras/footage' },
  { label: 'SANRAL freeway cameras', path: '/sanral' },
  { label: 'Bodycam register', path: '/police/bodycams' },
  { label: 'Reporting lines', path: '/hierarchy' },
  { label: 'Administration', path: '/admin' },
];

/** Powers that are not a screen. */
function powersOf(role: UserRole): string[] {
  switch (role) {
    case 'SuperAdmin':
      return ['Run the platform: organisations, features, access rules, automations', 'Grant and remove SuperAdmin',
        'Manage every account in the organisation'];
    case 'SystemAdmin':
      return ['Manage every account in the organisation', 'Approve other administrators\' account changes'];
    case 'Admin':
      return ['Manage accounts in their own department'];
    default:
      return [];
  }
}

/** Everything a role opens or may do, as an administrator would read it. */
export function describeAccess(role: UserRole, silo: Silo): string[] {
  return [...AREAS.filter((a) => canAccess(a.path, role, silo)).map((a) => a.label), ...powersOf(role)];
}

/** What a change of role (and department) adds and takes away. */
export function accessChanges(
  from: { role: UserRole; silo: Silo },
  to: { role: UserRole; silo: Silo },
): { gains: string[]; losses: string[] } {
  const before = describeAccess(from.role, from.silo);
  const after = describeAccess(to.role, to.silo);
  return {
    gains: after.filter((x) => !before.includes(x)),
    losses: before.filter((x) => !after.includes(x)),
  };
}

/**
 * Whether live operations reach this role: SOS sirens, new-incident and
 * status toasts, department-wide escalations. The SuperAdmin owns the
 * platform and does not work the floor, so none of it interrupts them. They
 * can still open any incident, queue or map; they just are not paged by it.
 */
export function receivesLiveOperations(role: UserRole): boolean {
  return role !== 'SuperAdmin';
}

export const ADMIN_ROLES: UserRole[] = ['SystemAdmin', 'SuperAdmin', 'Admin'];

/**
 * Who may open the operational admin consoles (integrations, automations,
 * operations settings, status, departments…): the admin tier plus the
 * SystemController seat. Account administration (Users & Roles writes) and
 * platform administration (tenants, features, access rules) deliberately
 * stay on ADMIN_ROLES / SuperAdmin — the controller runs the platform's
 * modules, it does not reshape accounts or tenants.
 */
export const ADMIN_CONSOLE_ROLES: UserRole[] = [...ADMIN_ROLES, 'SystemController'];

export const SUPERVISORY_ROLES: UserRole[] = [
  ...ADMIN_ROLES, 'Supervisor', 'Captain', 'FireChief', 'System',
];

export const DISPATCH_ROLES: UserRole[] = [
  ...ADMIN_ROLES, 'Dispatcher', 'ControlRoom', 'IncidentLogger', 'Supervisor', 'System',
];

/**
 * Who may CAPTURE a new call. Deliberately excludes Dispatcher: call-takers
 * log, dispatchers assign — mirroring the V4 control-room split where the
 * intake desk and the dispatch desk are different chairs.
 */
export const CALL_TAKER_ROLES: UserRole[] = [
  ...ADMIN_ROLES, 'ControlRoom', 'IncidentLogger', 'System',
];

/**
 * Who works the DISPATCH desk (queue, assign, KPI, PTT). Deliberately
 * excludes IncidentLogger — the intake desk only logs. ControlRoom is the
 * flexible chair that sits on both sides.
 */
export const DISPATCH_DESK_ROLES: UserRole[] = [
  ...ADMIN_ROLES, 'Dispatcher', 'ControlRoom', 'Supervisor', 'System',
];

/** Field roles that respond to incidents and run the start-of-shift workflow. */
export const RESPONDER_ROLES: UserRole[] = [
  'Police', 'Captain', 'Firefighter', 'FireChief', 'Paramedic', 'Doctor', 'Disaster',
];

/**
 * The department each field role belongs to: a Firefighter exists only in
 * Fire & Rescue, a Disaster officer only in Disaster Management. Desk and
 * administration roles fit any department. Mirrors role_fits_department()
 * (migration 0067), which refuses anything else.
 */
export const FIELD_ROLE_DEPARTMENT: Partial<Record<UserRole, Silo>> = {
  Police: 'MetroPolice', Captain: 'MetroPolice',
  Firefighter: 'MetroFire', FireChief: 'MetroFire',
  Paramedic: 'Medical', Doctor: 'Medical',
  Disaster: 'EthekwiniDisaster',
};

/** Whether `role` may be held in `silo`. */
export function roleFitsDepartment(role: UserRole, silo: Silo): boolean {
  const home = FIELD_ROLE_DEPARTMENT[role];
  return !home || home === silo;
}

/** The roles from `roles` that can be held in `silo`, in the same order. */
export function rolesForDepartment(roles: readonly UserRole[], silo: Silo): UserRole[] {
  return roles.filter((r) => roleFitsDepartment(r, silo));
}

/** Roles that can see any silo's routes/data (V4 GLOBAL list + auth.is_global()). */
export const GLOBAL_ROLES: UserRole[] = [
  'SystemAdmin', 'SuperAdmin', 'Dispatcher', 'ControlRoom',
  'IncidentLogger', 'Viewer', 'System', 'SystemController',
];

export const POLICE_ROLES: UserRole[] = ['Captain', 'Police'];
export const FIRE_ROLES: UserRole[] = ['FireChief', 'Firefighter'];
export const MEDICAL_ROLES: UserRole[] = ['Paramedic', 'Doctor'];
export const DISASTER_ROLES: UserRole[] = ['Disaster'];

/**
 * Who opens Case Management (the review queue, registers and case audit):
 * CaseManagerController's wide authorize list, plus department command, who
 * review their own officers' reports. Opening it is reading; closing is
 * narrower (CASE_CLOSE_ROLES). Not the call logger: they log calls and watch
 * them unfold on the incident pages, and never review or close a case.
 */
export const CASE_MANAGER_ROLES: UserRole[] = [
  ...ADMIN_ROLES, 'CaseManager', 'Dispatcher', 'ControlRoom',
  'Supervisor', 'System', 'Viewer', 'Captain', 'FireChief',
];

/* ── Police reports: management, records, activity, specialised (V4 Reports) ── */

/** The roles that open the police reporting pages; the department each must be on is in mayViewPoliceReports(). */
export const POLICE_REPORT_VIEW_ROLES: UserRole[] = ['SuperAdmin', 'SystemAdmin', 'Admin', 'Captain', 'Dispatcher', 'CaseManager', 'SystemController'];

/**
 * Who opens the police reporting pages: police dispatch, the captain, the case
 * manager, the police administrator and the system administrators. A
 * department's own people only for police: a Fire dispatcher or the EMS
 * administrator does not. What each page shows is still what the database
 * lets that person read (metro_reports, 0081).
 */
export function mayViewPoliceReports(role: UserRole | string, silo: Silo | string): boolean {
  if (role === 'SuperAdmin' || role === 'SystemAdmin' || role === 'SystemController') return true;
  if (role === 'CaseManager') return silo === 'MetroPolice' || silo === 'Ethekwini';
  return (role === 'Admin' || role === 'Captain' || role === 'Dispatcher') && silo === 'MetroPolice';
}

/* ── Active Responders (V4 Responder → Monitor) ── */

/**
 * Who opens the Active Responders terminal: V4's Monitor list (Dispatcher,
 * Viewer, ControlRoom, and the SuperAdmin it meant to let in), mapped to
 * HikTech's dispatch desk, command seat and administrators. Which calls each
 * sees is the database's rule: a department's administrator or desk sees
 * its own department's, the organisation-wide roles every department's.
 * Not the call logger (they watch calls on the incident pages, 0081), and
 * not field officers (their own calls are on My calls).
 */
export const RESPONDER_MONITOR_ROLES: UserRole[] = [
  'SuperAdmin', 'SystemAdmin', 'Admin', 'SystemController', 'System',
  'Dispatcher', 'ControlRoom', 'Supervisor', 'Viewer',
];

/** Who may act from it (talk to a crew, export the log): everyone above but the Viewer, as V4 hid its buttons. */
export const RESPONDER_MONITOR_ACT_ROLES: UserRole[] = RESPONDER_MONITOR_ROLES.filter((r) => r !== 'Viewer');

export const RESPONDER_MONITOR_PATH = '/responder/monitor';

/** Where the police reporting pages live. */
export const POLICE_REPORTS_PATH = '/police/report-centre';

/**
 * Who follows the routes crews drove, offline stretches included, on the map
 * (0071's duty_tracks_read): the desks and command who oversee crews. The
 * database still decides whose routes come back — only people the viewer can
 * already see, and a department's desk only its own crews.
 */
export const ROUTE_VIEW_ROLES: UserRole[] = [
  'SuperAdmin', 'SystemAdmin', 'Admin', 'SystemController', 'Supervisor', 'Captain', 'FireChief',
  'Dispatcher', 'ControlRoom', 'System',
];

export function canSeeRoutes(role: UserRole): boolean {
  return ROUTE_VIEW_ROLES.includes(role);
}

/* ── Schedules (0072) ──────────────────────────────────────────────────── */
// Mirrors schedule_rank() and the checks built on it. The database decides;
// these only choose what a screen offers.

/**
 * 5 the platform, 4 organisation HR (SystemAdmin, SystemController), 3 the
 * department admin, 2 Captain and Fire Chief, 1 Supervisor, 0 everyone else.
 */
export function scheduleRank(role: UserRole): number {
  switch (role) {
    case 'SuperAdmin': return 5;
    case 'SystemAdmin': case 'SystemController': return 4;
    case 'Admin': return 3;
    case 'Captain': case 'FireChief': return 2;
    case 'Supervisor': return 1;
    default: return 0;
  }
}

/** Builds and changes this department's roster (can_manage_roster). */
export function canManageRoster(role: UserRole, ownSilo: Silo, silo: Silo = ownSilo): boolean {
  const rank = scheduleRank(role);
  return rank >= 1 && (rank >= 4 || ownSilo === silo);
}

/** Sets up shift types, rotations and the late minutes (can_admin_schedule). */
export function canAdminSchedule(role: UserRole, ownSilo: Silo, silo: Silo = ownSilo): boolean {
  const rank = scheduleRank(role);
  return rank >= 4 || (rank === 3 && ownSilo === silo);
}

/** Organisation HR: public holidays, every department. */
export function isScheduleHr(role: UserRole): boolean {
  return scheduleRank(role) >= 4;
}

/**
 * Whether one person may decide about another (their leave, their lateness, a
 * shift of theirs that has started): senior to them, in their department
 * (organisation HR anywhere, and for one another), never themselves.
 */
export function outranksForSchedule(
  me: { id: string; role: UserRole; silo: Silo },
  them: { id: string; role: UserRole; silo: Silo },
): boolean {
  if (me.id === them.id) return false;
  const mine = scheduleRank(me.role);
  const theirs = scheduleRank(them.role);
  if (mine < 1) return false;
  if (!(mine > theirs || (mine >= 4 && theirs >= 4))) return false;
  return mine >= 4 || me.silo === them.silo;
}

/* ── Closing a case (0061) ─────────────────────────────────────────────── */

/**
 * Who may close a Resolved case after reading it. Mirrors the
 * require_role() list in close_case(). IncidentLogger and Viewer read cases
 * but never close them.
 */
export const CASE_CLOSE_ROLES: UserRole[] = [
  'SuperAdmin', 'SystemAdmin', 'Admin', 'SystemController', 'Supervisor', 'Captain', 'FireChief',
  'Dispatcher', 'ControlRoom', 'CaseManager', 'System',
];

/**
 * Who may close a call that is still live, without a report and with a
 * reason (hoax, duplicate, caller cancelled): the dispatch desk and command.
 * Not the case manager, who reviews finished work. close_case() refuses them.
 */
export const CALL_CANCEL_ROLES: UserRole[] = CASE_CLOSE_ROLES.filter((r) => r !== 'CaseManager');

/** A live call is closed without a report only with a reason this long. Mirrors close_case(). */
export const CANCEL_REASON_MIN = 10;

/**
 * Who may correct a crew's status from the console, when an officer radios
 * it in instead of pressing it on the phone. The desk only: never Resolved
 * (the report does that) and never Closed (close_case() does).
 * Mirrors the non-field callers update_responder_status() accepts.
 */
export const STATUS_OVERRIDE_ROLES: UserRole[] = [
  'SuperAdmin', 'SystemAdmin', 'Admin', 'Supervisor', 'Dispatcher', 'ControlRoom',
];

/**
 * Who marks one department's crew on a shared call (0073's set_department_status),
 * which the controller may too: the departments card's buttons.
 */
export const PART_STATUS_ROLES: UserRole[] = [...STATUS_OVERRIDE_ROLES, 'SystemController'];

/**
 * Who may file a crew's report from the console as the crew radioed it in,
 * and close it on scene for them (0075): the department's desk and command,
 * the control room and the organisation. Mirrors radio_filer().
 */
export const RADIO_FILING_ROLES: UserRole[] = [
  'Dispatcher', 'ControlRoom', 'SystemController', 'System', 'Supervisor',
  'Captain', 'FireChief', 'Admin', 'SystemAdmin', 'SuperAdmin',
];

/** Whether this console user files and closes by radio for a department's crew. */
export function canFileByRadio(role: UserRole, ownSilo: Silo, silo: Silo): boolean {
  return RADIO_FILING_ROLES.includes(role) && canDirectDepartment(role, ownSilo, silo);
}

/** The statuses the desk may set on a crew's behalf. */
export const STATUS_OVERRIDE_STEPS = ['En Route', 'Arrived', 'On Scene', 'Transporting'] as const;

/**
 * Where a case stands, from its status: a live call, a resolved call
 * awaiting review, or closed.
 */
export function caseStage(status: string): 'live' | 'review' | 'closed' {
  if (status === 'Closed') return 'closed';
  if (status === 'Resolved') return 'review';
  return 'live';
}

/**
 * How `role` may close a case in `status`: review it (Resolved), cancel it
 * (still live, with a reason), or not at all. The database has the final word.
 */
export function closeActionFor(role: UserRole, status: string): 'review' | 'cancel' | null {
  const stage = caseStage(status);
  if (stage === 'closed') return null;
  if (stage === 'review') return CASE_CLOSE_ROLES.includes(role) ? 'review' : null;
  return CALL_CANCEL_ROLES.includes(role) ? 'cancel' : null;
}

/* ── Live-map perimeters and zones (0053) ──────────────────────────────── */

/**
 * Who may draw a perimeter or zone on the live map: the control room and
 * dispatch desks, command staff, and each department's commanders. Field
 * officers (Police, Firefighter, Paramedic, Doctor) see them; they do not
 * draw. Mirrors the require_role() list in save_map_zone().
 */
export const MAP_ZONE_DRAW_ROLES: UserRole[] = [
  'SuperAdmin', 'SystemAdmin', 'Admin', 'SystemController', 'Supervisor',
  'Dispatcher', 'ControlRoom', 'IncidentLogger', 'Captain', 'FireChief', 'Disaster',
];

/** May change or stand down any zone they can see. Mirrors can_manage_map_zone(). */
export const MAP_ZONE_MANAGE_ROLES: UserRole[] = [
  'SuperAdmin', 'SystemAdmin', 'Admin', 'SystemController', 'Supervisor', 'ControlRoom', 'Dispatcher',
];

/** Department commanders: may change or stand down their own department's zones. */
export const MAP_ZONE_COMMANDER_ROLES: UserRole[] = ['Captain', 'FireChief', 'Disaster'];

export function canDrawMapZones(role: UserRole): boolean {
  return MAP_ZONE_DRAW_ROLES.includes(role);
}

/** Whether `me` may change or stand down `zone` — the database has the final word. */
export function canManageMapZone(
  zone: { created_by: string | null; silo: Silo },
  me: { id: string; role: UserRole; silo: Silo },
): boolean {
  return zone.created_by === me.id
    || MAP_ZONE_MANAGE_ROLES.includes(me.role)
    || (MAP_ZONE_COMMANDER_ROLES.includes(me.role) && zone.silo === me.silo);
}

/**
 * Whose console announces a zone shared with them. Field officers are left
 * out on purpose: perimeters reach the officer app in a later phase, and the
 * SuperAdmin is not paged by live operations (receivesLiveOperations).
 */
export function receivesZoneNotices(role: UserRole): boolean {
  return receivesLiveOperations(role)
    && !['Police', 'Firefighter', 'Paramedic', 'Doctor', 'Staff'].includes(role);
}

/* ── Bodycams (0054) ───────────────────────────────────────────────────── */

/**
 * Who may watch a bodycam live: the control room, dispatch and command tier,
 * and a department's supervisors and captains. Mirrors can_watch_bodycam().
 */
export const BODYCAM_LIVE_ROLES: UserRole[] = [
  'SuperAdmin', 'SystemAdmin', 'SystemController', 'ControlRoom', 'Dispatcher', 'Supervisor', 'Captain',
];

/** Who may pull recorded footage: the same, and case managers. */
export const BODYCAM_FOOTAGE_ROLES: UserRole[] = [...BODYCAM_LIVE_ROLES, 'CaseManager'];

/** These watch their own department's bodycams only. */
const BODYCAM_DEPARTMENT_ROLES: UserRole[] = ['Supervisor', 'Captain', 'CaseManager'];

/** Whether `me` may watch (or pull footage from) a bodycam of `camSilo` — the database has the final word. */
export function canWatchBodycam(
  me: { role: UserRole; silo: Silo },
  camSilo: Silo,
  kind: 'live' | 'footage',
): boolean {
  const roles = kind === 'live' ? BODYCAM_LIVE_ROLES : BODYCAM_FOOTAGE_ROLES;
  if (!roles.includes(me.role)) return false;
  if (!BODYCAM_DEPARTMENT_ROLES.includes(me.role)) return true;
  return camSilo === me.silo || (me.silo === 'Ethekwini' && camSilo === 'MetroPolice');
}

/* ── Fines (0057) ──────────────────────────────────────────────────── */

/** Who serves notices: Metro Police officers, supervisors and captains. Mirrors can_issue_fines(). */
export const FINE_ISSUER_ROLES: UserRole[] = ['Police', 'Captain', 'Supervisor'];

/** Who sees every fine and runs the register (cancel, representations, payments). Mirrors can_view_all_fines(). */
export const FINE_COMMAND_ROLES: UserRole[] = [
  'Captain', 'Supervisor', 'Admin', 'SystemAdmin', 'SuperAdmin', 'SystemController',
];

/** These see their own department's fines; the rest see the tenant's. */
const FINE_DEPARTMENT_ROLES: UserRole[] = ['Captain', 'Supervisor', 'Admin'];

const policeSide = (silo: Silo) => silo === 'MetroPolice' || silo === 'Ethekwini';

export function canIssueFines(me: { role: UserRole; silo: Silo }): boolean {
  return FINE_ISSUER_ROLES.includes(me.role) && policeSide(me.silo);
}

/** Whether `me` sees every Metro Police fine (not just their own). The database has the final word. */
export function canViewAllFines(me: { role: UserRole; silo: Silo }): boolean {
  if (!FINE_COMMAND_ROLES.includes(me.role)) return false;
  return !FINE_DEPARTMENT_ROLES.includes(me.role) || policeSide(me.silo);
}

/** Who keeps the charge book (codes, amounts, verification). Mirrors can_manage_fine_offences(). */
export function canManageFineOffences(me: { role: UserRole; silo: Silo }): boolean {
  if (['SystemAdmin', 'SuperAdmin', 'SystemController'].includes(me.role)) return true;
  return me.role === 'Admin' && policeSide(me.silo);
}

type RouteRule = {
  /** Route prefix, longest match wins. */
  prefix: string;
  /** Allowed roles. Omit for "any authenticated user". */
  roles?: UserRole[];
  /** Silo the route belongs to; GLOBAL_ROLES bypass this. */
  silo?: Silo;
};

/** Ordered longest-prefix-first at lookup time; keep entries readable here. */
export const ROUTE_RULES: RouteRule[] = [
  // Longest-prefix wins: intake is call-taker-only; the rest of /dispatch
  // (pending queue, assign, KPI, PTT) belongs to the dispatch desk. An
  // IncidentLogger logs, a Dispatcher dispatches — never each other's job.
  { prefix: '/dispatch/log-call', roles: CALL_TAKER_ROLES },
  { prefix: '/dispatch',     roles: DISPATCH_DESK_ROLES },
  // Responders must be able to open the calls they are sent to: every dispatch
  // alert links at /incidents/{id}. RLS still scopes the rows to their silo.
  { prefix: '/incidents',    roles: [...DISPATCH_ROLES, ...RESPONDER_ROLES, 'Viewer', 'CaseManager'] },
  // The builder is open to everyone who can read reports — running one is
  // reading. Which datasets they may touch is decided by the reporting
  // registry, and saving/exporting is gated in the actions themselves.
  { prefix: '/reports/builder', roles: [...DISPATCH_ROLES, ...RESPONDER_ROLES, ...SUPERVISORY_ROLES, 'Viewer', 'CaseManager', 'Staff'] },
  { prefix: '/reports',      roles: [...DISPATCH_ROLES, ...RESPONDER_ROLES, 'Viewer', 'CaseManager'] },
  { prefix: '/report-hub',   roles: [...DISPATCH_ROLES, 'Viewer', 'CaseManager', 'Supervisor'] },
  { prefix: '/case-manager', roles: CASE_MANAGER_ROLES },
  { prefix: '/hierarchy',    roles: [...SUPERVISORY_ROLES, ...DISPATCH_ROLES, 'CaseManager', 'Viewer'] },
  // The terminal (V4 Monitor) is the desks'; My calls is the field's.
  { prefix: '/responder/monitor', roles: RESPONDER_MONITOR_ROLES },
  { prefix: '/responder',    roles: [...RESPONDER_ROLES, ...ADMIN_ROLES] },
  { prefix: '/shift/readiness-review', roles: [...SUPERVISORY_ROLES, 'SystemController'] },
  // Today's shift board (0051): who has started, with what kit. Command staff.
  { prefix: '/shift/today',  roles: [...SUPERVISORY_ROLES, 'SystemController'] },
  { prefix: '/shift',        roles: [...RESPONDER_ROLES, ...ADMIN_ROLES, 'Supervisor'] },
  // The armoury register (0051) is kept by command staff; officers book out in the app.
  { prefix: '/police/armoury', roles: ['Captain', 'Supervisor', ...ADMIN_ROLES], silo: 'MetroPolice' },
  // So is the bodycam register (0054).
  { prefix: '/police/bodycams', roles: ['Captain', 'Supervisor', ...ADMIN_ROLES], silo: 'MetroPolice' },
  // Fines (0057): officers see their own, command staff the register; the
  // charge book is read by command staff and kept by the admin tier.
  { prefix: '/police/fines/offences', roles: ['Captain', 'Supervisor', ...ADMIN_ROLES], silo: 'MetroPolice' },
  // A person's account and the payments import (0058): command staff.
  { prefix: '/police/fines/account', roles: ['Captain', 'Supervisor', ...ADMIN_ROLES], silo: 'MetroPolice' },
  { prefix: '/police/fines/payments', roles: ['Captain', 'Supervisor', ...ADMIN_ROLES], silo: 'MetroPolice' },
  { prefix: '/police/fines', roles: [...FINE_ISSUER_ROLES, ...ADMIN_ROLES], silo: 'MetroPolice' },
  { prefix: '/police',       roles: [...POLICE_ROLES, ...ADMIN_ROLES], silo: 'MetroPolice' },
  { prefix: '/fire',         roles: [...FIRE_ROLES, ...ADMIN_ROLES], silo: 'MetroFire' },
  // The receiving doctor reads reports and handovers; the crew writes them (0064).
  { prefix: '/medical/pcr/new', roles: ['Paramedic', ...ADMIN_ROLES], silo: 'Medical' },
  { prefix: '/medical/restock', roles: ['Paramedic', ...ADMIN_ROLES], silo: 'Medical' },
  { prefix: '/medical',      roles: [...MEDICAL_ROLES, ...ADMIN_ROLES], silo: 'Medical' },
  { prefix: '/disaster',     roles: [...DISASTER_ROLES, ...DISPATCH_ROLES, 'Viewer'], silo: 'EthekwiniDisaster' },
  // Everyone sees their own schedule; only supervisors build the roster.
  { prefix: '/roster/allocation', roles: [...SUPERVISORY_ROLES, ...RESPONDER_ROLES, ...DISPATCH_ROLES, 'Staff', 'CaseManager'] },
  { prefix: '/roster/mine',  roles: undefined },
  // The duty office (0085): open to everyone; each screen checks the person's
  // own access (View or Edit, given per person by the systems controller).
  { prefix: '/modules',      roles: undefined },
  // Shift setup (0072): the department admin sets it up; those who roster
  // see it and put people in teams. The database holds the same line.
  { prefix: '/roster/setup', roles: [...SUPERVISORY_ROLES, 'SystemController'] },
  { prefix: '/roster',       roles: [...SUPERVISORY_ROLES, 'SystemController'] },
  // The command dashboard: one screen with duty state, approvals, tasks and
  // the module launcher. Command staff and the controller seat.
  { prefix: '/command',      roles: [...SUPERVISORY_ROLES, 'SystemController'] },
  // Duty Maintenance: supervisors run the board; assignees advance their own.
  { prefix: '/duty-tasks',   roles: [...SUPERVISORY_ROLES, ...RESPONDER_ROLES, ...DISPATCH_ROLES, 'Staff'] },
  // Time & Attendance and internal mail are for everyone who works here.
  { prefix: '/attendance' },
  { prefix: '/mail' },
  // HR command centre: supervisors and the admin tier run people-readiness.
  { prefix: '/hr',           roles: [...SUPERVISORY_ROLES, 'SystemController'] },
  // Everyone who works here files leave — the desk (dispatch tier) included.
  { prefix: '/leave',        roles: [...ADMIN_ROLES, 'Staff', 'Supervisor', ...RESPONDER_ROLES, ...DISPATCH_ROLES, 'CaseManager', 'SystemController'] },
  { prefix: '/training',     roles: [...SUPERVISORY_ROLES, ...RESPONDER_ROLES] },
  // Self-service performance views are open to field members; management views stay restricted.
  { prefix: '/performance/mine', roles: [...RESPONDER_ROLES, ...SUPERVISORY_ROLES, ...DISPATCH_ROLES, 'Viewer'] },
  // The three-axis reports centre: command staff, dispatch leadership and viewers.
  { prefix: '/performance/rollup', roles: [...SUPERVISORY_ROLES, ...DISPATCH_ROLES, 'Viewer', 'CaseManager'] },
  { prefix: '/performance/reports', roles: [...SUPERVISORY_ROLES, ...DISPATCH_ROLES, 'Viewer', 'CaseManager'] },
  { prefix: '/performance',  roles: ['Supervisor', 'SystemAdmin', 'SuperAdmin', 'System', 'Admin'] },
  { prefix: '/analytics',    roles: ['System', 'SystemAdmin', 'SuperAdmin', 'Admin', 'Viewer', 'Supervisor'] },
  // Deciding account changes is the SystemAdmins' second pair of eyes (0048).
  { prefix: '/admin/approvals', roles: ['SystemAdmin', 'SuperAdmin'] },
  // Importing HR's staff list is a SystemAdmin's job (0050); Admins review roles afterwards.
  { prefix: '/admin/personnel/import', roles: ['SystemAdmin', 'SuperAdmin'] },
  { prefix: '/admin',        roles: ADMIN_ROLES },
  // Body cams (0054): watching live is narrower than the old camera wall;
  // recorded footage adds case managers. The database checks each view again.
  { prefix: '/cameras/footage', roles: BODYCAM_FOOTAGE_ROLES },
  { prefix: '/cameras',      roles: BODYCAM_LIVE_ROLES },
  // The SANRAL freeway camera wall keeps the camera wall's old rule.
  { prefix: '/sanral',       roles: [...DISPATCH_ROLES, 'Viewer'] },
  { prefix: '/notifications' },
  { prefix: '/profile' },
  { prefix: '/dashboard' },
  // Open to every role: the search itself is SECURITY INVOKER, so RLS decides
  // what each person's results contain. Gating the page by role would restrict
  // who may look without changing what anyone can find.
  { prefix: '/search' },
];

/**
 * Route-level authorization check used by Next.js middleware and the sidebar.
 * Returns true when `role`/`silo` may open `pathname`.
 */
export function canAccess(pathname: string, role: UserRole, silo: Silo): boolean {
  // The police reporting pages are for named roles on the police side, wider
  // than /police in roles (dispatch, the case manager) and narrower in reach.
  if (pathname === POLICE_REPORTS_PATH || pathname.startsWith(`${POLICE_REPORTS_PATH}/`)) {
    return mayViewPoliceReports(role, silo);
  }
  // The SystemController is a command-and-reporting seat over every module in
  // every silo. The only doors it does not hold keys to are tenant, feature
  // and access administration — those belong to the SuperAdmin desk.
  if (role === 'SystemController') {
    return !pathname.startsWith('/admin/tenants')
      && !pathname.startsWith('/admin/features')
      && !pathname.startsWith('/admin/access')
      && !pathname.startsWith('/admin/approvals')
      && !pathname.startsWith('/admin/invitations')
      && !pathname.startsWith('/admin/personnel/import')
      && !pathname.startsWith('/admin/rollout')
      && !pathname.startsWith('/admin/handbook');
  }
  const rule = ROUTE_RULES
    .filter((r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  if (!rule) return true; // unmapped route → authenticated-only
  if (rule.silo && silo !== rule.silo && silo !== 'Ethekwini' && !GLOBAL_ROLES.includes(role)) {
    return false;
  }
  if (rule.roles && !rule.roles.includes(role)) return false;
  return true;
}

/**
 * May this person direct a department's part of a call (0073): dispatch it,
 * mark its crew's steps, stand it down? Its own desk and command, the control
 * room, and organisation administrators. Mirrors can_direct_department().
 */
export function canDirectDepartment(role: UserRole, ownSilo: Silo, silo: Silo): boolean {
  if (role === 'SystemAdmin' || role === 'SuperAdmin' || role === 'SystemController' || role === 'System') return true;
  return (['Dispatcher', 'ControlRoom', 'Operator', 'Supervisor', 'Captain', 'FireChief', 'Chief', 'Admin'] as UserRole[]).includes(role)
    && (ownSilo === 'Ethekwini' || ownSilo === silo);
}

/** Command of a department: may stand down a crew already on scene. Mirrors commands_department(). */
export function commandsDepartment(role: UserRole, ownSilo: Silo, silo: Silo): boolean {
  if (role === 'SystemAdmin' || role === 'SuperAdmin' || role === 'SystemController' || role === 'System') return true;
  return (['Supervisor', 'Captain', 'FireChief', 'Chief', 'Admin'] as UserRole[]).includes(role)
    && (ownSilo === 'Ethekwini' || ownSilo === silo);
}
