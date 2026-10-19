'use server';

import { redirect } from 'next/navigation';
import { addLeoRecord, removeLeoRecord, saveStaffRecord, setModuleAccess } from '@criticom/api';
import type { ModuleCode, ModuleLevel, Silo } from '@criticom/db';
import { getSession } from '@/lib/session';
import { attempt, field, optional } from '@/lib/office-actions';

const PERSON = [
  'first_name', 'last_name', 'badge_number', 'rank', 'force_number', 'service_number', 'persal_number', 'region', 'la_code',
  'department_name', 'station', 'section_id', 'platoon', 'weekend_group', 'join_date', 'resign_date', 'work_email', 'work_cellphone',
] as const;
const PRIVATE = [
  'id_number', 'birth_date', 'address_1', 'address_2', 'address_3', 'address_4', 'post_code', 'phone', 'email',
  'nok_name', 'nok_relation', 'nok_phone', 'nok_email', 'nok_address',
  'emergency_name', 'emergency_relation', 'emergency_phone', 'emergency_email', 'emergency_address', 'comments',
] as const;
const CODES: ModuleCode[] = ['STFM', 'CSNM', 'SECM', 'ENTM', 'ABSM', 'DUTA', 'DUTM', 'DUTR', 'LEAM'];

/** save_staff_record checks Staff Maintenance Edit. Only the fields on the form are sent. */
export async function saveStaffAction(fd: FormData) {
  const { supabase } = await getSession();
  const id = optional(fd, 'id');
  const silo = field(fd, 'silo') as Silo;
  let saved = '';
  const res = await attempt(async () => {
    const fields: Record<string, unknown> = {};
    for (const k of PERSON) if (fd.has(k)) fields[k] = field(fd, k);
    if (fd.has('duty_allocation')) fields.duty_allocation = field(fd, 'duty_allocation') !== 'N';
    const priv: Record<string, unknown> = {};
    for (const k of PRIVATE) if (fd.has(k)) priv[k] = field(fd, k);
    saved = await saveStaffRecord(supabase, { personnelId: id, silo, fields, private: priv });
  }, '/modules/staff');
  // A new member opens on their own record.
  if (!id && res.ok && saved) redirect(`/modules/staff?id=${saved}${field(fd, 'dept') ? `&dept=${field(fd, 'dept')}` : ''}`);
  return res;
}

export async function addLeoAction(fd: FormData) {
  const { supabase } = await getSession();
  return attempt(() => addLeoRecord(supabase, {
    personnelId: field(fd, 'personnel'), radio: optional(fd, 'radio'), from: optional(fd, 'from'), to: optional(fd, 'to'),
    area: optional(fd, 'area'), region: optional(fd, 'region'),
  }), '/modules/staff');
}

export async function removeLeoAction(fd: FormData) {
  const { supabase } = await getSession();
  return attempt(() => removeLeoRecord(supabase, field(fd, 'id')), '/modules/staff');
}

/** set_module_access: the systems controller tier only. Only changed screens are written. */
export async function saveAccessAction(fd: FormData) {
  const { supabase } = await getSession();
  return attempt(async () => {
    const user = field(fd, 'user');
    let changed = 0;
    for (const code of CODES) {
      const now = field(fd, code);
      if (now === field(fd, `was_${code}`)) continue;
      await setModuleAccess(supabase, { userId: user, module: code, level: (now || null) as ModuleLevel | null });
      changed++;
    }
    return changed === 0 ? 'Nothing changed' : `Access saved (${changed})`;
  }, '/modules/staff', '/modules');
}
