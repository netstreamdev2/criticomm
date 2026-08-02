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
 */

import type { Silo, UserRole } from './types.generated';

export const ADMIN_ROLES: UserRole[] = ['SystemAdmin', 'SuperAdmin', 'Admin'];

export const SUPERVISORY_ROLES: UserRole[] = [
  ...ADMIN_ROLES, 'Supervisor', 'Captain', 'Chief', 'FireChief', 'System',
];

export const DISPATCH_ROLES: UserRole[] = [
  ...ADMIN_ROLES, 'Dispatcher', 'Operator', 'ControlRoom', 'IncidentLogger', 'Supervisor', 'System',
];

/**
 * Who may CAPTURE a new call. Deliberately excludes Dispatcher: call-takers
 * log, dispatchers assign — mirroring the V4 control-room split where the
 * intake desk and the dispatch desk are different chairs.
 */
export const CALL_TAKER_ROLES: UserRole[] = [
  ...ADMIN_ROLES, 'Operator', 'ControlRoom', 'IncidentLogger', 'System',
];

/**
 * Who works the DISPATCH desk (queue, assign, KPI, PTT). Deliberately
 * excludes IncidentLogger — the intake desk only logs. Operator and
 * ControlRoom are the flexible chairs that sit on both sides.
 */
export const DISPATCH_DESK_ROLES: UserRole[] = [
  ...ADMIN_ROLES, 'Dispatcher', 'Operator', 'ControlRoom', 'Supervisor', 'System',
];

/** Field roles that respond to incidents and run the start-of-shift workflow. */
export const RESPONDER_ROLES: UserRole[] = [
  'Responder', 'Police', 'Officer', 'Metro', 'Security', 'Captain',
  'Firefighter', 'FireChief', 'Chief', 'Paramedic', 'Doctor', 'Disaster',
];

/** Roles that can see any silo's routes/data (V4 GLOBAL list + auth.is_global()). */
export const GLOBAL_ROLES: UserRole[] = [
  'SystemAdmin', 'SuperAdmin', 'Dispatcher', 'Operator', 'ControlRoom',
  'IncidentLogger', 'Viewer', 'System',
];

export const POLICE_ROLES: UserRole[] = ['Captain', 'Police', 'Officer', 'Metro', 'Security'];
export const FIRE_ROLES: UserRole[] = ['Chief', 'FireChief', 'Firefighter'];
export const MEDICAL_ROLES: UserRole[] = ['Paramedic', 'Doctor'];
export const DISASTER_ROLES: UserRole[] = ['Disaster'];

/** CaseManagerController's wide authorize list. */
export const CASE_MANAGER_ROLES: UserRole[] = [
  ...ADMIN_ROLES, 'CaseManager', 'Dispatcher', 'Operator', 'ControlRoom',
  'IncidentLogger', 'Supervisor', 'System', 'Viewer',
];

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
  { prefix: '/responder',    roles: [...RESPONDER_ROLES, ...ADMIN_ROLES] },
  { prefix: '/shift',        roles: [...RESPONDER_ROLES, ...ADMIN_ROLES, 'Supervisor'] },
  { prefix: '/police',       roles: [...POLICE_ROLES, ...ADMIN_ROLES, 'Responder'], silo: 'MetroPolice' },
  { prefix: '/fire',         roles: [...FIRE_ROLES, ...ADMIN_ROLES, 'Responder'], silo: 'MetroFire' },
  { prefix: '/medical',      roles: [...MEDICAL_ROLES, ...ADMIN_ROLES, 'Responder'], silo: 'Medical' },
  { prefix: '/disaster',     roles: [...DISASTER_ROLES, ...DISPATCH_ROLES, 'Viewer'], silo: 'EthekwiniDisaster' },
  // Everyone sees their own schedule; only supervisors build the roster.
  { prefix: '/roster/allocation', roles: [...SUPERVISORY_ROLES, ...RESPONDER_ROLES, ...DISPATCH_ROLES, 'Staff', 'CaseManager'] },
  { prefix: '/roster/mine',  roles: undefined },
  { prefix: '/roster',       roles: SUPERVISORY_ROLES },
  // HR command centre: supervisors and the admin tier run people-readiness.
  { prefix: '/hr',           roles: SUPERVISORY_ROLES },
  // Everyone who works here files leave — the desk (dispatch tier) included.
  { prefix: '/leave',        roles: [...ADMIN_ROLES, 'Staff', 'Supervisor', ...RESPONDER_ROLES, ...DISPATCH_ROLES, 'CaseManager'] },
  { prefix: '/training',     roles: [...SUPERVISORY_ROLES, ...RESPONDER_ROLES] },
  // Self-service performance views are open to field members; management views stay restricted.
  { prefix: '/performance/mine', roles: [...RESPONDER_ROLES, ...SUPERVISORY_ROLES, ...DISPATCH_ROLES, 'Viewer'] },
  // The three-axis reports centre: command staff, dispatch leadership and viewers.
  { prefix: '/performance/rollup', roles: [...SUPERVISORY_ROLES, ...DISPATCH_ROLES, 'Viewer', 'CaseManager'] },
  { prefix: '/performance/reports', roles: [...SUPERVISORY_ROLES, ...DISPATCH_ROLES, 'Viewer', 'CaseManager'] },
  { prefix: '/performance',  roles: ['Supervisor', 'SystemAdmin', 'SuperAdmin', 'System', 'Admin'] },
  { prefix: '/analytics',    roles: ['System', 'SystemAdmin', 'SuperAdmin', 'Admin', 'Viewer', 'Supervisor'] },
  { prefix: '/admin',        roles: ADMIN_ROLES },
  { prefix: '/cameras',      roles: [...DISPATCH_ROLES, 'Viewer'] },
  { prefix: '/notifications' },
  { prefix: '/profile' },
  { prefix: '/dashboard' },
];

/**
 * Route-level authorization check used by Next.js middleware and the sidebar.
 * Returns true when `role`/`silo` may open `pathname`.
 */
export function canAccess(pathname: string, role: UserRole, silo: Silo): boolean {
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
