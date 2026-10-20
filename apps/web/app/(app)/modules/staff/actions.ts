'use server';

import { addLeoRecord, removeLeoRecord, saveStaffRecord, setModuleAccess } from '@criticom/api';
import { normaliseCellphone, normaliseWorkEmail, rolesInvitableBy, type ModuleCode, type ModuleLevel, type Silo } from '@criticom/db';
import { tx } from '@criticom/db/i18n';
import { getSession } from '@/lib/session';
import type { ActionResult } from '@/components/office/action-form';
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
export async function saveStaffAction(fd: FormData): Promise<ActionResult> {
  const { supabase, role } = await getSession();
  const id = optional(fd, 'id');
  const silo = field(fd, 'silo') as Silo;
  let saved = '';
  const res = await attempt(async () => {
    const fields: Record<string, unknown> = {};
    for (const k of PERSON) if (fd.has(k)) fields[k] = field(fd, k);
    // As the old Personnel form did: an invitation goes to these, so they must be real.
    if (fd.has('work_email')) {
      const email = normaliseWorkEmail(field(fd, 'work_email') || null);
      if (!email.ok) throw new Error(`“${email.value}” is not an email address.`);
      fields.work_email = email.value ?? '';
    }
    if (fd.has('work_cellphone')) {
      const phone = normaliseCellphone(field(fd, 'work_cellphone') || null);
      if (!phone.ok) throw new Error(`“${phone.value}” is not a cellphone number.`);
      fields.work_cellphone = phone.value ?? '';
    }
    if (fd.has('duty_allocation')) fields.duty_allocation = field(fd, 'duty_allocation') !== 'N';
    const priv: Record<string, unknown> = {};
    for (const k of PRIVATE) if (fd.has(k)) priv[k] = field(fd, k);
    saved = await saveStaffRecord(supabase, { personnelId: id, silo, fields, private: priv });
  }, '/modules/staff');
  if (!res.ok) return res;
  const who = [field(fd, 'first_name'), field(fd, 'last_name')].filter(Boolean).join(' ');
  if (!id && saved) {
    // A new member: say so, open their own record, and offer the next step (their login).
    const invite = rolesInvitableBy(role).length > 0;
    return {
      ok: true,
      message: who ? `${who} added` : 'Staff member added',
      detail: `Staff no. ${field(fd, 'badge_number')}`,
      next: invite ? { label: tx('Next: invite / create login'), href: `/admin/invitations/new?person=${saved}` } : undefined,
      goTo: `/modules/staff?id=${saved}${field(fd, 'dept') ? `&dept=${field(fd, 'dept')}` : ''}`,
    };
  }
  return { ok: true, message: who ? `${who} saved` : 'Record saved' };
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
