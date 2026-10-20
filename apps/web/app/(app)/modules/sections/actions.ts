'use server';

import { saveSection, saveStation } from '@criticom/api';
import { scheduleRank, type Silo } from '@criticom/db';
import { getSession } from '@/lib/session';
import { attempt, field, optional } from '@/lib/office-actions';
import type { ActionResult } from '@/components/office/action-form';
import { tx } from '@criticom/db/i18n';

/** save_section checks Sections Edit for the department. */
/** A new section leads on to its call signs (the next step of the setup path). */
export async function saveSectionAction(fd: FormData): Promise<ActionResult> {
  const { supabase, role } = await getSession();
  const isNew = !optional(fd, 'id');
  let id = '';
  const res = await attempt(async () => {
    id = await saveSection(supabase, {
      id: optional(fd, 'id'),
      silo: field(fd, 'silo') as Silo,
      code: field(fd, 'code'),
      name: field(fd, 'name'),
      short: optional(fd, 'short'),
      station: optional(fd, 'station'),
      zone: optional(fd, 'zone'),
      division: optional(fd, 'division'),
      overtime: optional(fd, 'overtime'),
      active: fd.get('active') !== 'off',
    });
  }, '/modules/sections');
  if (!res.ok || !isNew || !id) return res;
  const dept = scheduleRank(role) >= 4 ? `dept=${field(fd, 'silo')}&` : '';
  return { ...res, next: { label: tx('Next: add its call signs'), href: `/modules/call-signs?${dept}section=${id}&id=new` } };
}

export async function saveStationAction(fd: FormData) {
  const { supabase } = await getSession();
  return attempt(async () => {
    await saveStation(supabase, {
      id: optional(fd, 'id'),
      silo: field(fd, 'silo') as Silo,
      code: field(fd, 'code'),
      name: field(fd, 'name'),
      zone: optional(fd, 'zone'),
      active: fd.get('active') !== 'off',
    });
  }, '/modules/sections');
}
