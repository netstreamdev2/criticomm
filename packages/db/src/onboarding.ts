/**
 * Account invitations (migration 0049): the rules the web console, the
 * phone app and the database must agree on. Pure functions only.
 *
 * Design: apps/web/handbook/staff-onboarding.html (Admin → Handbook).
 */

import type { Silo, UserRole } from './types.generated';
import { ASSIGNABLE_ROLES, FIELD_ROLE_DEPARTMENT, TENANT_WIDE_ROLES, roleFitsDepartment } from './roles.ts';

/** The organisation this deployment signs people into. One tenant for now: eThekwini. */
export const DEFAULT_TENANT_SLUG = 'ethekwini';

/** Department names as people say them, for invitations, slips and screens. */
export const DEPARTMENT_NAMES: Record<Silo, string> = {
  Ethekwini: 'Control Room',
  MetroPolice: 'Metro Police',
  MetroFire: 'Fire & Rescue',
  Medical: 'EMS',
  EthekwiniDisaster: 'Disaster Management',
};

/** A department as people say it; never the system's code ("EthekwiniDisaster"). */
export function departmentName(silo: string | null | undefined): string {
  return (silo && DEPARTMENT_NAMES[silo as Silo]) || 'Emergency Services';
}

/** Roles as people say them, not as the system stores them ("FireChief"). */
export const ROLE_NAMES: Record<UserRole, string> = {
  SuperAdmin: 'Platform Administrator',
  SystemAdmin: 'System Administrator',
  Admin: 'Administrator',
  SystemController: 'System Controller',
  Supervisor: 'Supervisor',
  Dispatcher: 'Dispatcher',
  Operator: 'Operator',
  ControlRoom: 'Control Room Operator',
  IncidentLogger: 'Call Taker',
  CaseManager: 'Case Manager',
  Viewer: 'Viewer',
  System: 'System',
  Captain: 'Captain',
  Police: 'Police Officer',
  Officer: 'Officer',
  Metro: 'Metro Police Officer',
  Security: 'Security Officer',
  Chief: 'Chief',
  FireChief: 'Fire Chief',
  Firefighter: 'Firefighter',
  Paramedic: 'Paramedic',
  Doctor: 'Doctor',
  Disaster: 'Disaster Management Officer',
  Citizen: 'Citizen',
  Responder: 'Responder',
  Staff: 'Staff',
};

export function roleName(role: string | null | undefined): string {
  return (role && ROLE_NAMES[role as UserRole]) || role || '';
}

/**
 * Why `role` cannot be held in `silo`, in plain words, or null when it can:
 * "A Firefighter works in Fire & Rescue. Choose a Disaster Management role."
 * Mirrors role_fits_department() (migration 0067).
 */
export function roleDepartmentProblem(role: UserRole, silo: Silo): string | null {
  if (roleFitsDepartment(role, silo)) return null;
  const home = FIELD_ROLE_DEPARTMENT[role] as Silo;
  return `A ${roleName(role)} works in ${DEPARTMENT_NAMES[home]}. Choose a ${DEPARTMENT_NAMES[silo]} role.`;
}

/** Wrong badge numbers or codes before an invitation locks. */
export const INVITATION_ATTEMPTS = 5;

/** Version of the POPIA notice and acceptable-use terms a person accepts. */
export const POPIA_NOTICE_VERSION = '1.0';

export const MIN_PASSWORD_LENGTH = 12;

/** Badge numbers compared forgivingly: letters and digits only, any case. Mirrors normalise_badge() (0049). */
export function normaliseBadge(badge: string | null | undefined): string {
  return (badge ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

/**
 * The sign-in address of someone without email, made from their badge
 * number. `.internal` is reserved for private networks and never delivers
 * mail. Mirrors badge_sign_in_email() (0049).
 */
export function badgeSignInEmail(badge: string, tenantSlug: string = DEFAULT_TENANT_SLUG): string {
  const local = normaliseBadge(badge).toLowerCase();
  if (!local) throw new Error('Enter a badge number.');
  return `${local}@${tenantSlug}.badge.internal`;
}

/** Whether a sign-in address was made from a badge number. */
export function isBadgeSignInEmail(email: string | null | undefined): boolean {
  return /@[a-z0-9-]+\.badge\.internal$/i.test(email ?? '');
}

/** What the "Email or badge number" box means: an address as typed, or the badge's sign-in address. */
export function signInEmailFor(entry: string, tenantSlug: string = DEFAULT_TENANT_SLUG): string {
  const value = entry.trim();
  return value.includes('@') ? value.toLowerCase() : badgeSignInEmail(value, tenantSlug);
}

/**
 * Printed activation codes: eight characters from an alphabet with nothing
 * that reads two ways (no I, L, O, 0 or 1), printed as XXXX-XXXX.
 */
export const ACTIVATION_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** A typed code reduced to its eight characters: case, spaces and dashes forgiven. */
export function normaliseActivationCode(code: string | null | undefined): string {
  return (code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function formatActivationCode(code: string): string {
  const c = normaliseActivationCode(code);
  return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4, 8)}` : c;
}

/**
 * Roles an administrator may invite someone into. Mirrors vet_invitation()
 * (0049): SuperAdmin any; SystemAdmin any but SuperAdmin; a department Admin
 * only department roles.
 */
export function rolesInvitableBy(actor: UserRole): UserRole[] {
  if (actor === 'SuperAdmin') return ASSIGNABLE_ROLES;
  if (actor === 'SystemAdmin') return ASSIGNABLE_ROLES.filter((r) => r !== 'SuperAdmin');
  if (actor === 'Admin') return ASSIGNABLE_ROLES.filter((r) => !TENANT_WIDE_ROLES.includes(r));
  return [];
}

const ALL_SILOS: Silo[] = ['Ethekwini', 'MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster'];

/** Departments an administrator may invite into: any for SystemAdmin and above, their own for an Admin. */
export function departmentsInvitableBy(actor: { role: UserRole; silo: Silo }): Silo[] {
  if (actor.role === 'SuperAdmin' || actor.role === 'SystemAdmin') return ALL_SILOS;
  if (actor.role === 'Admin') return [actor.silo];
  return [];
}

/** The checklist shown while a person chooses their password. All must pass. */
export function passwordChecklist(
  password: string,
  about: { name?: string | null; badge?: string | null },
): Array<{ rule: string; ok: boolean }> {
  const lower = password.toLowerCase();
  const nameParts = (about.name ?? '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((p) => p.length >= 3);
  const badge = normaliseBadge(about.badge).toLowerCase();
  const alnum = lower.replace(/[^a-z0-9]/g, '');
  return [
    { rule: `At least ${MIN_PASSWORD_LENGTH} characters`, ok: password.length >= MIN_PASSWORD_LENGTH },
    { rule: 'Not your name', ok: password.length > 0 && !nameParts.some((p) => lower.includes(p)) },
    { rule: 'Not your badge number', ok: password.length > 0 && !(badge.length >= 3 && alnum.includes(badge)) },
  ];
}

export function passwordAcceptable(password: string, about: { name?: string | null; badge?: string | null }): boolean {
  return passwordChecklist(password, about).every((c) => c.ok);
}

/** An email address shown partly hidden, for screens anyone holding the link can see. */
export function maskEmail(email: string | null | undefined): string {
  if (!email || !email.includes('@')) return '';
  const [local, domain] = email.split('@');
  const keep = local!.slice(0, Math.min(2, local!.length));
  return `${keep}${'•'.repeat(Math.max(3, local!.length - keep.length))}@${domain}`;
}

/** A phone number shown with only its last four digits. */
export function maskPhone(phone: string | null | undefined): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length >= 4 ? `••• ••• ${digits.slice(-4)}` : '';
}
