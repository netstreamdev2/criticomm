'use server';

import { revalidatePath } from 'next/cache';
import { logAudit, setFeature, FEATURES } from '@criticom/api';
import { getSession } from '@/lib/session';

/**
 * Feature toggles are SuperAdmin-only and audited by name.
 *
 * The RLS policy on feature_flags already refuses anyone else; the check here
 * exists so the refusal is a clear message rather than a database error, and
 * so nothing is attempted before the audit context is known.
 */
export async function toggleFeatureAction(formData: FormData) {
  const { supabase, role, fullName } = await getSession();
  if (role !== 'SuperAdmin') return { error: 'Only a SuperAdmin may toggle features.' };

  const key = String(formData.get('key') ?? '');
  const enabled = String(formData.get('enabled') ?? '') === 'true';
  const def = FEATURES.find((f) => f.key === key);
  if (!def) return { error: 'Unknown feature.' };

  try {
    await setFeature(supabase, { key, enabled, byName: fullName });
    await logAudit(supabase, {
      silo: 'Ethekwini',
      action_type: enabled ? 'FeatureEnabled' : 'FeatureDisabled',
      entity_type: 'feature_flag', entity_id: key, user_name: fullName,
      details: `${def.label} (${key}) ${enabled ? 'enabled' : 'disabled'} for this tenant`,
    }).catch(() => {});
    revalidatePath('/admin/features');
    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
