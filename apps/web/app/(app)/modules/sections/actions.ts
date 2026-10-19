'use server';

import { saveSection, saveStation } from '@criticom/api';
import type { Silo } from '@criticom/db';
import { getSession } from '@/lib/session';
import { attempt, field, optional } from '@/lib/office-actions';

/** save_section checks Sections Edit for the department. */
export async function saveSectionAction(fd: FormData) {
  const { supabase } = await getSession();
  return attempt(async () => {
    await saveSection(supabase, {
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
