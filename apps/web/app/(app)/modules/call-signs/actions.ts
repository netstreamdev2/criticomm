'use server';

import { saveCallSign } from '@criticom/api';
import type { Silo } from '@criticom/db';
import { getSession } from '@/lib/session';
import { attempt, field, optional } from '@/lib/office-actions';

/** Save a call sign. save_call_sign checks Call Signs Edit for the department. */
export async function saveCallSignAction(fd: FormData) {
  const { supabase } = await getSession();
  return attempt(async () => {
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
}
