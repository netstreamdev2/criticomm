'use server';

import { revalidatePath } from 'next/cache';
import {
  logAudit, resetOperationalSetting, updateOperationalSetting,
  OPERATIONAL_SETTINGS, type OperationalSettingKey,
} from '@criticom/api';
import { ADMIN_ROLES } from '@criticom/db';
import { getSession } from '@/lib/session';

const VALID_KEYS = new Set<string>(OPERATIONAL_SETTINGS.map((d) => d.key));

async function requireAdmin() {
  const session = await getSession();
  if (!ADMIN_ROLES.includes(session.role)) throw new Error('Forbidden');
  return session;
}

export async function saveSettingAction(formData: FormData) {
  const { supabase, fullName } = await requireAdmin();
  const key = String(formData.get('key') ?? '');
  if (!VALID_KEYS.has(key)) return { error: 'Unknown setting.' };

  const def = OPERATIONAL_SETTINGS.find((d) => d.key === key)!;
  const raw = String(formData.get('value') ?? '');
  const value: number | boolean | string =
    def.type === 'number' ? Number(raw)
    : def.type === 'boolean' ? raw === 'true'
    : raw;

  try {
    const stored = await updateOperationalSetting(
      supabase, key as OperationalSettingKey, value, fullName,
    );
    await logAudit(supabase, {
      silo: 'Ethekwini', action_type: 'SettingChanged', entity_type: 'app_setting',
      user_name: fullName, details: `${key} = ${String(stored)}`,
    }).catch(() => {});
    revalidatePath('/admin/operations');
    return { ok: true, stored };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function resetSettingAction(formData: FormData) {
  const { supabase, fullName } = await requireAdmin();
  const key = String(formData.get('key') ?? '');
  if (!VALID_KEYS.has(key)) return { error: 'Unknown setting.' };

  await resetOperationalSetting(supabase, key as OperationalSettingKey);
  await logAudit(supabase, {
    silo: 'Ethekwini', action_type: 'SettingReset', entity_type: 'app_setting',
    user_name: fullName, details: `${key} → default`,
  }).catch(() => {});
  revalidatePath('/admin/operations');
  return { ok: true };
}
