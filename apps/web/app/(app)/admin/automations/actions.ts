'use server';

import { revalidatePath } from 'next/cache';
import {
  logAudit, runAutomationNow, setAutomationEnabled, updateAutomationConfig, RULE_FIELDS,
} from '@criticom/api';
import { ADMIN_ROLES } from '@criticom/db';
import { getSession } from '@/lib/session';

/**
 * Every action here is audited by name.
 *
 * These rules raise alerts across departments and pull crews around. Turning
 * one off, or widening a threshold, changes what the service notices — and
 * "why did nobody get told the call had been sitting for forty minutes"
 * needs an answer that names a person and a time.
 */

async function requireAdmin() {
  const session = await getSession();
  if (!ADMIN_ROLES.includes(session.role)) throw new Error('Forbidden');
  return session;
}

export async function toggleAutomationAction(formData: FormData) {
  const { supabase, fullName } = await requireAdmin();
  const key = String(formData.get('key') ?? '');
  const enabled = String(formData.get('enabled') ?? '') === 'true';
  if (!RULE_FIELDS[key]) return { error: 'Unknown automation.' };

  try {
    await setAutomationEnabled(supabase, { key, enabled });
    await logAudit(supabase, {
      silo: 'Ethekwini',
      action_type: enabled ? 'AutomationEnabled' : 'AutomationDisabled',
      entity_type: 'automation_rule', entity_id: key, user_name: fullName,
      details: `${key} ${enabled ? 'enabled' : 'disabled'}`,
    }).catch(() => {});
    revalidatePath('/admin/automations');
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function saveAutomationAction(formData: FormData) {
  const { supabase, fullName } = await requireAdmin();
  const key = String(formData.get('key') ?? '');
  const fields = RULE_FIELDS[key];
  if (!fields) return { error: 'Unknown automation.' };

  const config: Record<string, string> = {};
  for (const field of fields) {
    const value = formData.get(field.key);
    if (value !== null) config[field.key] = String(value);
  }

  const intervalRaw = formData.get('interval_minutes');
  const intervalMinutes = intervalRaw === null ? undefined : Number(intervalRaw);

  try {
    const stored = await updateAutomationConfig(supabase, { key, config, intervalMinutes });
    await logAudit(supabase, {
      silo: 'Ethekwini', action_type: 'AutomationTuned', entity_type: 'automation_rule',
      entity_id: key, user_name: fullName,
      details: `${key}: ${JSON.stringify(stored)}`,
    }).catch(() => {});
    revalidatePath('/admin/automations');
    // The saved values may have been clamped — hand them back so the form shows
    // what is actually stored rather than what was typed.
    return { ok: true, stored };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function runAutomationAction(formData: FormData) {
  const { supabase, fullName } = await requireAdmin();
  const key = String(formData.get('key') ?? '');
  if (!RULE_FIELDS[key]) return { error: 'Unknown automation.' };

  try {
    const results = await runAutomationNow(supabase, key);
    const result = results[0];
    await logAudit(supabase, {
      silo: 'Ethekwini', action_type: 'AutomationRun', entity_type: 'automation_rule',
      entity_id: key, user_name: fullName,
      details: `${key} run manually: ${result?.detail ?? 'no result'}`,
    }).catch(() => {});
    revalidatePath('/admin/automations');
    return {
      ok: true,
      status: result?.status ?? 'ok',
      affected: result?.affected ?? 0,
      detail: result?.detail ?? 'Completed with no detail.',
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
