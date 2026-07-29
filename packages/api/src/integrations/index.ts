import type { CriticomClient, Database } from '@criticom/db';

export type IntegrationSetting = Database['public']['Tables']['integration_settings']['Row'];

/**
 * Integration catalogue. Secrets never live here — they stay in server
 * environment variables. This table holds the switch, the endpoint, and the
 * tunable parameters an admin is allowed to change without a redeploy, plus
 * the outcome of the last connection test.
 */

export async function listIntegrations(client: CriticomClient) {
  const { data, error } = await client
    .from('integration_settings')
    .select('*')
    .order('category')
    .order('label');
  if (error) throw error;
  return data ?? [];
}

export async function getIntegration(client: CriticomClient, key: string) {
  const { data, error } = await client
    .from('integration_settings')
    .select('*')
    .eq('key', key)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateIntegration(
  client: CriticomClient,
  key: string,
  patch: { enabled?: boolean; config?: Record<string, unknown>; updatedBy?: string },
) {
  const { data, error } = await client
    .from('integration_settings')
    .update({
      ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
      ...(patch.config === undefined ? {} : { config: patch.config }),
      updated_by: patch.updatedBy ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('key', key)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Record the outcome of a connection test so the panel can show it later. */
export async function recordIntegrationTest(
  client: CriticomClient,
  key: string,
  result: { ok: boolean; message: string },
) {
  const { error } = await client
    .from('integration_settings')
    .update({
      last_tested_at: new Date().toISOString(),
      last_test_ok: result.ok,
      last_test_message: result.message.slice(0, 500),
    })
    .eq('key', key);
  if (error) throw error;
}

/**
 * Is a feature switched on? Used by app code that should degrade gracefully
 * (e.g. skip SMS when BulkSMS is off) rather than erroring.
 */
export async function isIntegrationEnabled(client: CriticomClient, key: string) {
  const row = await getIntegration(client, key).catch(() => null);
  return Boolean(row?.enabled);
}
