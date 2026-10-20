'use server';

import { getMyModules, getOfficeSetup, type MyModules, type OfficeSetup } from '@criticom/api';
import { scheduleRank, type Silo } from '@criticom/db';
import { OFFICE_SILOS } from '@/lib/office';
import { getSession } from '@/lib/session';

/**
 * The setup path for the department on screen: what is done, and which
 * screens this person may open. The controller tier picks the department
 * (?dept=); everyone else sees their own, as on every duty office screen.
 */
export async function getSetupAction(dept: string | null): Promise<{ setup: OfficeSetup; modules: MyModules } | null> {
  const { supabase, role, silo } = await getSession();
  const modules: MyModules = await getMyModules(supabase).catch(() => ({}));
  if (Object.keys(modules).length === 0) return null;
  const global = scheduleRank(role) >= 4;
  const asked = dept && OFFICE_SILOS.includes(dept as Silo) ? (dept as Silo) : null;
  const target: Silo = global ? (asked ?? (OFFICE_SILOS.includes(silo) ? silo : 'MetroPolice')) : silo;
  try {
    return { setup: await getOfficeSetup(supabase, target), modules };
  } catch {
    return null;
  }
}
