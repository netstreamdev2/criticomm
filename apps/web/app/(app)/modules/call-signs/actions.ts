'use server';

import { saveCallSign } from '@criticom/api';
import { scheduleRank, type Silo } from '@criticom/db';
import { tx } from '@criticom/db/i18n';
import type { ActionResult } from '@/components/office/action-form';
import { getSession } from '@/lib/session';
import { attempt, field, optional } from '@/lib/office-actions';

/** Save a call sign. save_call_sign checks Call Signs Edit for the department. */
export async function saveCallSignAction(fd: FormData): Promise<ActionResult> {
  const { supabase, role } = await getSession();
  const res = await attempt(async () => {
    await saveCallSign(supabase, {
      id: optional(fd, 'id'),
      silo: field(fd, 'silo') as Silo,
      callSign: field(fd, 'call_sign'),
      station: optional(fd, 'station'),
      sectionId: optional(fd, 'section_id'),
      start: field(fd, 'start'),
      stop: field(fd, 'stop'),
      breakAt: optional(fd, 'break'),
      rank: optional(fd, 'rank'),
      description: optional(fd, 'description'),
      active: fd.get('active') !== 'off',
    });
  }, '/modules/call-signs');
  // The next step of the setup path: book staff onto the section's call signs.
  const section = optional(fd, 'section_id');
  if (!res.ok || !section) return res;
  const dept = scheduleRank(role) >= 4 ? `dept=${field(fd, 'silo')}&` : '';
  return { ...res, next: { label: tx('Next: allocate duty'), href: `/modules/duty-allocation?${dept}section=${section}` } };
}
