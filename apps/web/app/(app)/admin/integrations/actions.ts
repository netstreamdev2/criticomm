'use server';

import { revalidatePath } from 'next/cache';
import { getIntegration, logAudit, updateIntegration } from '@criticom/api';
import { ADMIN_CONSOLE_ROLES } from '@criticom/db';
import { getSession } from '@/lib/session';

async function requireAdmin() {
  const session = await getSession();
  if (!ADMIN_CONSOLE_ROLES.includes(session.role)) throw new Error('Forbidden');
  return session;
}

export async function setIntegrationEnabledAction(formData: FormData) {
  const { supabase, fullName } = await requireAdmin();
  const key = String(formData.get('key') ?? '');
  const enabled = String(formData.get('enabled') ?? '') === 'true';
  if (!key) return;

  await updateIntegration(supabase, key, { enabled, updatedBy: fullName });
  await logAudit(supabase, {
    silo: 'Ethekwini', action_type: 'IntegrationToggled', entity_type: 'integration',
    user_name: fullName, details: `${key} → ${enabled ? 'enabled' : 'disabled'}`,
  }).catch(() => {});

  revalidatePath('/admin/integrations');
}

export async function saveIntegrationConfigAction(formData: FormData) {
  const { supabase, fullName } = await requireAdmin();
  const key = String(formData.get('key') ?? '');
  const raw = String(formData.get('config') ?? '{}');
  if (!key) return { error: 'Missing integration key.' };

  let config: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw || '{}');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { error: 'Configuration must be a JSON object.' };
    }
    config = parsed as Record<string, unknown>;
  } catch (e) {
    return { error: `Invalid JSON: ${(e as Error).message}` };
  }

  await updateIntegration(supabase, key, { config, updatedBy: fullName });
  await logAudit(supabase, {
    silo: 'Ethekwini', action_type: 'IntegrationConfigured', entity_type: 'integration',
    user_name: fullName, details: `${key} configuration updated`,
  }).catch(() => {});

  revalidatePath('/admin/integrations');
  return { ok: true };
}

/**
 * Bodycams (0054): play the sample video instead of asking the Hikvision
 * platform, for demonstrations before it is connected. Only this one setting
 * changes; every other parameter is kept.
 */
export async function setBodycamTestVideoAction(on: boolean) {
  const { supabase, fullName } = await requireAdmin();
  try {
    const row = await getIntegration(supabase, 'hikvision');
    if (!row) return { error: 'The Hikvision integration is not in the catalogue.' };
    const config = { ...((row.config ?? {}) as Record<string, unknown>), stream_source: on ? 'test' : 'hikvision' };
    await updateIntegration(supabase, 'hikvision', { config, updatedBy: fullName });
  } catch (e) {
    return { error: (e as Error).message || 'The setting could not be saved.' };
  }
  await logAudit(supabase, {
    silo: 'Ethekwini', action_type: 'IntegrationConfigured', entity_type: 'integration',
    user_name: fullName, details: `hikvision bodycam test video ${on ? 'switched on' : 'switched off'}`,
  }).catch(() => {});
  revalidatePath('/admin/integrations');
  revalidatePath('/cameras');
  return { ok: true };
}
