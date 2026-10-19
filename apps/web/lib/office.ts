import 'server-only';
import { redirect } from 'next/navigation';
import { getMyModules, type MyModules } from '@criticom/api';
import { DEPARTMENT_NAMES, scheduleRank, type ModuleCode, type ModuleLevel, type Silo } from '@criticom/db';
import { getSession } from './session';

/** The departments the duty office works for (not the control room). */
export const OFFICE_SILOS: Silo[] = ['MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster'];

/**
 * Open a duty office screen: who is asking, their level on this screen, and
 * the department it shows. The systems controller tier picks the department
 * (?dept=); everyone else works in their own. No access sends them back to
 * System Modules. The database checks again on every write.
 */
export async function openModule(code: ModuleCode, dept?: string | null) {
  const session = await getSession();
  const modules: MyModules = await getMyModules(session.supabase).catch(() => ({}));
  const level: ModuleLevel | undefined = modules[code];
  if (!level) redirect('/modules');
  const global = scheduleRank(session.role) >= 4;
  const asked = dept && OFFICE_SILOS.includes(dept as Silo) ? (dept as Silo) : null;
  const silo: Silo = global ? (asked ?? (OFFICE_SILOS.includes(session.silo) ? session.silo : 'MetroPolice')) : session.silo;
  return {
    ...session,
    modules,
    level,
    canEdit: level === 'Edit',
    /** The controller tier works across departments and may switch. */
    global,
    target: silo,
    deptName: DEPARTMENT_NAMES[silo] ?? silo,
  };
}

/** Keep the chosen department on links and form posts. */
export const deptQuery = (global: boolean, silo: Silo) => (global ? `dept=${silo}` : '');
