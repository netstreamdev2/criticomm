import type { CriticomClient, Silo } from '@criticom/db';

/** NotificationsController.ToggleDutyStatus / UpdateLiveLocation */
export async function toggleDuty(
  client: CriticomClient,
  args: { onDuty: boolean; latitude?: number; longitude?: number },
) {
  const { data, error } = await client.rpc('toggle_duty', {
    p_on_duty: args.onDuty,
    p_latitude: args.latitude ?? null,
    p_longitude: args.longitude ?? null,
  });
  if (error) throw error;
  return data;
}

/** AuthController.Logout */
export async function cleanupOnLogout(client: CriticomClient) {
  const { error } = await client.rpc('cleanup_on_logout');
  if (error) throw error;
}

/** DispatchController.GetOnDutyResponders — internal personnel positions */
export async function getOnDutyResponders(client: CriticomClient, silo?: Silo) {
  let q = client
    .from('personnel')
    .select('id, first_name, last_name, latitude, longitude, last_login, silo, station')
    .eq('is_on_duty', true)
    .not('latitude', 'is', null)
    .not('longitude', 'is', null);
  if (silo) q = q.eq('silo', silo);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/** How many officers are on duty in the app — the people a dispatch reaches. */
export async function countOnDuty(client: CriticomClient, silo?: Silo) {
  let q = client
    .from('personnel')
    .select('id', { count: 'exact', head: true })
    .eq('is_on_duty', true)
    .not('user_id', 'is', null);
  if (silo) q = q.eq('silo', silo);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

/** Get my personnel record (incl. assigned vehicle) */
export async function getMyPersonnel(client: CriticomClient, userId: string) {
  const { data, error } = await client
    .from('personnel')
    .select('*, apparatus:assigned_apparatus_id (id, unit_number, name, type, status)')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** DevAdminController.ManageSilo — list users for a silo */
export async function listSiloProfiles(client: CriticomClient, silo: Silo) {
  const { data, error } = await client.from('profiles').select('*').eq('silo', silo);
  if (error) throw error;
  return data ?? [];
}
