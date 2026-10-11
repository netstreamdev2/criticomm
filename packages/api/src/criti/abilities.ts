import type { Silo, UserRole } from '@criticom/db';
import { DEPARTMENT_NAMES } from '@criticom/db/onboarding';
import {
  CALL_CANCEL_ROLES, CALL_TAKER_ROLES, RESPONDER_ROLES, STATUS_OVERRIDE_ROLES,
} from '@criticom/db/roles';
import type { DeskSilo, ProposalKind } from './types.ts';

/**
 * What Criti may offer each role. Every list mirrors the require_role() of the
 * database function that does the work, so Criti never offers what the
 * database would refuse. The database still has the final word: these lists
 * only decide what is offered.
 */
const ABILITY_ROLES: Record<ProposalKind, readonly UserRole[]> = {
  // log_incoming_call() (0068)
  log_call: CALL_TAKER_ROLES,
  // tag_incident_departments() (0068)
  send_to_desk: [
    'SystemAdmin', 'SuperAdmin', 'Admin', 'Supervisor', 'Dispatcher', 'ControlRoom', 'IncidentLogger', 'System', 'SystemController',
  ],
  // assign_incident() and route_incident() (0042, 0044)
  assign_officer: ['SystemAdmin', 'SuperAdmin', 'Admin', 'Dispatcher', 'ControlRoom', 'Supervisor', 'System'],
  dispatch_all: ['SystemAdmin', 'SuperAdmin', 'Admin', 'Dispatcher', 'ControlRoom', 'Supervisor', 'System'],
  // update_responder_status() on a crew's behalf (0061)
  set_status: STATUS_OVERRIDE_ROLES,
  // incident_updates insert rules: everyone who works calls, never a viewer
  add_note: [
    'SystemAdmin', 'SuperAdmin', 'Admin', 'SystemController', 'Supervisor', 'Dispatcher', 'ControlRoom', 'IncidentLogger',
    'CaseManager', 'System', ...RESPONDER_ROLES,
  ],
  // close_case() on a live call, with a reason (0061)
  cancel_call: CALL_CANCEL_ROLES,
  // send_broadcast() (0070)
  broadcast: [
    'SuperAdmin', 'SystemAdmin', 'SystemController', 'Admin', 'Supervisor', 'Captain', 'FireChief', 'Dispatcher', 'ControlRoom', 'System',
  ],
};

export function canPropose(role: UserRole, kind: ProposalKind): boolean {
  return ABILITY_ROLES[kind].includes(role);
}

export function abilitiesFor(role: UserRole): ProposalKind[] {
  return (Object.keys(ABILITY_ROLES) as ProposalKind[]).filter((k) => canPropose(role, k));
}

/**
 * The department's own dispatch desk this person works, if any: a
 * Dispatcher, Control Room operator or call taker outside the control room.
 * Mirrors desk_silo() (0068).
 */
export function deskSiloOf(role: UserRole, silo: Silo): DeskSilo | null {
  return ['Dispatcher', 'ControlRoom', 'IncidentLogger'].includes(role) && silo !== 'Ethekwini' ? (silo as DeskSilo) : null;
}

/** Whom this person may broadcast to. Mirrors send_broadcast() (0070). */
export function broadcastTargets(role: UserRole, silo: Silo): Silo[] {
  if (!canPropose(role, 'broadcast')) return [];
  if (silo === 'Ethekwini' || ['SuperAdmin', 'SystemAdmin', 'SystemController', 'System'].includes(role)) {
    return ['Ethekwini', 'MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster'];
  }
  return [silo];
}

/* ── Departments in people's words ──────────────────────────────────── */

export const DESKS: readonly DeskSilo[] = ['MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster'];

/** "Fire & Rescue", never "MetroFire". */
export function deptName(silo: Silo): string {
  return DEPARTMENT_NAMES[silo] ?? 'Emergency Services';
}

/** "Fire & Rescue and EMS". */
export function deptList(silos: readonly Silo[]): string {
  const names = silos.map(deptName);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** What people call each department, for reading a request. */
const DEPARTMENT_WORDS: Array<[RegExp, Silo]> = [
  [/^(metro\s*)?police|^saps|^metropolice$|^law|^traffic/i, 'MetroPolice'],
  [/^fire|^metrofire$|^rescue/i, 'MetroFire'],
  [/^ems\b|^medical|^ambulance|^paramedic|^emergency medical/i, 'Medical'],
  [/^disaster|^ethekwinidisaster$/i, 'EthekwiniDisaster'],
  [/^control\s*room|^ethekwini$|^central/i, 'Ethekwini'],
];

/** A department from what someone typed: "fire", "EMS", "Metro Police", "MetroFire". */
export function parseDepartment(text: string | null | undefined): Silo | null {
  const t = (text ?? '').trim();
  if (!t) return null;
  for (const [re, silo] of DEPARTMENT_WORDS) if (re.test(t)) return silo;
  return null;
}

/** Several departments, each once, in the order the desks are listed. */
export function parseDesks(values: unknown): DeskSilo[] {
  const list = Array.isArray(values) ? values : typeof values === 'string' ? values.split(/[,;&]|\band\b/i) : [];
  const found = new Set<Silo>();
  for (const v of list) {
    const silo = parseDepartment(String(v));
    if (silo) found.add(silo);
  }
  return DESKS.filter((d) => found.has(d));
}
