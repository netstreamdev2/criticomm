'use server';

import { saveAbsenceCode } from '@criticom/api';
import { getSession } from '@/lib/session';
import { attempt, field, optional } from '@/lib/office-actions';

/** save_absence_code checks Absence Codes Edit. */
export async function saveAbsenceCodeAction(fd: FormData) {
  const { supabase } = await getSession();
  return attempt(async () => {
    const days = optional(fd, 'entitlement');
    await saveAbsenceCode(supabase, {
      id: optional(fd, 'id'),
      code: field(fd, 'code'),
      name: field(fd, 'name'),
      officeOnly: fd.get('office') === 'on',
      entitlement: days == null ? null : Number(days),
      active: fd.get('active') !== 'off',
    });
  }, '/modules/absence', '/leave');
}
