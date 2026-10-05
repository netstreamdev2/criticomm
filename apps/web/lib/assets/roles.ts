import type { Silo, UserRole } from '@criticom/db';

const ALL_SILOS: Silo[] = ['MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster', 'Ethekwini'];
const GLOBAL: UserRole[] = ['SystemAdmin', 'SuperAdmin', 'SystemController'];

/**
 * Who keeps the armoury, as can_manage_armoury() decides it in the database
 * (0051): the global administrators everywhere, command staff in their own
 * department. The page only hides buttons; the database is the lock.
 */
export function armouryRolesFor(role: UserRole, silo: Silo) {
  const global = GLOBAL.includes(role);
  return {
    global,
    canManage: global || (['Admin', 'System', 'Supervisor', 'Captain', 'FireChief'] as UserRole[]).includes(role),
    departments: global ? ALL_SILOS : [silo],
  };
}

/** The same for the fleet (can_manage_fleet). */
export function fleetRolesFor(role: UserRole, silo: Silo) {
  const global = GLOBAL.includes(role);
  return {
    global,
    canManage: global || (['Admin', 'Supervisor', 'Captain', 'FireChief'] as UserRole[]).includes(role),
    departments: global ? ALL_SILOS : [silo],
  };
}
