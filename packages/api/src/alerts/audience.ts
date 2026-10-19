/**
 * Whom a notification is for (0084), in words, and which group it falls in
 * on the notifications page. Pure, so it can be tested.
 */

export type AudienceRow = {
  audience: 'person' | 'people' | 'role' | 'department' | 'organisation';
  silo: string;
  target_user_id: string | null;
  target_users: string[] | null;
  target_roles: string[] | null;
  all_departments: boolean;
};

export const NOTIFICATION_DEPARTMENTS: Record<string, string> = {
  Ethekwini: 'Control room',
  MetroPolice: 'Metro Police',
  MetroFire: 'Fire & Rescue',
  Medical: 'EMS',
  EthekwiniDisaster: 'Disaster Management',
};

/** Role names as people say them, in the plural. */
const ROLE_PLURAL: Record<string, string> = {
  SuperAdmin: 'super admins', SystemAdmin: 'system admins', Admin: 'admins', Supervisor: 'supervisors',
  Dispatcher: 'dispatchers', ControlRoom: 'control room staff', IncidentLogger: 'call loggers', Viewer: 'viewers',
  Captain: 'captains', FireChief: 'fire chiefs', Police: 'officers', Firefighter: 'firefighters',
  Paramedic: 'paramedics', Doctor: 'doctors', Disaster: 'disaster officers', CaseManager: 'case managers',
  SystemController: 'system controllers', System: 'system accounts',
};

/** "Admins", "Control room staff": a role's holders, for a picker. */
export const rolePlural = (role: string) => {
  const p = ROLE_PLURAL[role] ?? role;
  return `${p.charAt(0).toUpperCase()}${p.slice(1)}`;
};

/** The roles a notification can go to, in the order a sender looks for them. */
export const NOTIFIABLE_ROLES = [
  'Admin', 'Supervisor', 'Captain', 'FireChief', 'Dispatcher', 'ControlRoom', 'IncidentLogger',
  'Police', 'Firefighter', 'Paramedic', 'Doctor', 'Disaster', 'CaseManager', 'Viewer',
] as const;

const list = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/**
 * The audience, or for a row from before 0084 (no column yet) what the
 * migration backfills: a person when it names one, else the department.
 */
const audienceOf = (row: Pick<AudienceRow, 'audience' | 'target_user_id'>): AudienceRow['audience'] =>
  row.audience ?? (row.target_user_id ? 'person' : 'department');

/** "Just you", "You and 2 others", "Metro Police admins", "Captains in every department", "Metro Police", "Everyone". */
export function audienceLabel(row: AudienceRow): string {
  switch (audienceOf(row)) {
    case 'person': return 'Just you';
    case 'people': {
      const others = Math.max(0, (row.target_users?.length ?? 1) - 1);
      return others === 0 ? 'Just you' : `You and ${others} other${others === 1 ? '' : 's'}`;
    }
    case 'role': {
      const roles = list((row.target_roles ?? []).map((r) => ROLE_PLURAL[r] ?? r));
      return row.all_departments
        ? `${roles.charAt(0).toUpperCase()}${roles.slice(1)} in every department`
        : `${NOTIFICATION_DEPARTMENTS[row.silo] ?? row.silo} ${roles}`;
    }
    case 'department': return NOTIFICATION_DEPARTMENTS[row.silo] ?? row.silo;
    case 'organisation': return 'Everyone';
  }
}

/** The page's tabs: mine alone, shared with a group (people or a role), my department, everyone. */
export type AudienceGroup = 'mine' | 'shared' | 'department' | 'everyone';
export function audienceGroup(row: Pick<AudienceRow, 'audience' | 'target_user_id' | 'target_users'>): AudienceGroup {
  const audience = audienceOf(row);
  if (audience === 'person') return 'mine';
  if (audience === 'people') return (row.target_users?.length ?? 0) > 1 ? 'shared' : 'mine';
  if (audience === 'role') return 'shared';
  if (audience === 'department') return 'department';
  return 'everyone';
}

export const AUDIENCE_TONE: Record<AudienceGroup, string> = {
  mine: '#3b82f6',
  shared: '#a855f7',
  department: '#14b8a6',
  everyone: '#f97316',
};

/** The kinds HikTech raises for emergencies: shown as they always were, never restyled. */
export const EMERGENCY_KINDS = new Set(['sos', 'dispatch', 'assignment']);
