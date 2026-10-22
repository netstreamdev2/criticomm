import { Suspense } from 'react';
import { OFFICE_MODULES, getMyModules, type MyModules } from '@criticom/api';
import { canAccess } from '@criticom/db';
import { tx } from '@criticom/db/i18n';
import { getSession } from '@/lib/session';
import { OfficeMenu, type MenuItem } from './office-menu';

/** The repeating-shift planner (/roster), which lives in the Duty menu too. */
const PLANNER: MenuItem[] = [
  { href: '/roster', label: tx('Plan Repeating Shifts'), info: tx('A month at a time: shift patterns that repeat for a team.') },
  { href: '/roster/setup', label: tx('Shift Patterns'), info: tx('The shift types, rotations and teams the planner repeats.') },
];

/** The duty office menu, with the screens this person may open. */
export async function OfficeMenuBar() {
  const { supabase, role, silo } = await getSession();
  const mine: MyModules = await getMyModules(supabase).catch(() => ({}));
  const pick = (group: 'staff' | 'duty'): MenuItem[] => OFFICE_MODULES
    .filter((m) => m.group === group && m.code in mine)
    .map((m) => ({ href: m.href, label: m.label, info: m.info }));
  const duty = [...pick('duty'), ...PLANNER.filter((p) => canAccess(p.href, role, silo))];
  return (
    <Suspense fallback={<div className="h-9" />}>
      <OfficeMenu staff={pick('staff')} duty={duty} />
    </Suspense>
  );
}
