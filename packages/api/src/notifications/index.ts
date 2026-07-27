import type { CriticomClient, Database, Silo } from '@criticom/db';

type Tables = Database['public']['Tables'];

/** NotificationsController.Index */
export async function listNotifications(client: CriticomClient, silo?: Silo, limit = 100) {
  let q = client.from('notifications').select('*').order('created_at', { ascending: false });
  if (silo) q = q.eq('silo', silo);
  const { data, error } = await q.limit(limit);
  if (error) throw error;
  return data ?? [];
}

/** NotificationsController.Create */
export async function createNotification(
  client: CriticomClient,
  input: Tables['notifications']['Insert'],
) {
  const { data, error } = await client.from('notifications').insert(input).select().single();
  if (error) throw error;
  return data;
}
