import type { CriticomClient, Database } from '@criticom/db';

/**
 * PIN sign-in on a registered device (0108). The console lists the devices
 * and who has a PIN, removes a lost device, resets and unlocks PINs; the
 * phone asks whether its officer has one and notes a sign-in made on a
 * registered device. Checking a PIN is the web server's alone (service role).
 * Every write goes through the database functions.
 */

export type SignInDevice = Database['public']['Tables']['sign_in_devices']['Row'];
export type SignInPinRow = Database['public']['Functions']['sign_in_pin_board']['Returns'][number];
export type MySignInPin = { hasPin: boolean; locked: boolean; setAt: string | null };

/** The registered devices this person looks after, live ones first. Never their key's hash. */
export async function listSignInDevices(client: CriticomClient): Promise<Array<Omit<SignInDevice, 'secret_hash'>>> {
  const { data, error } = await client.from('sign_in_devices')
    .select('id, tenant_id, silo, label, radio_id, registered_by, registered_by_name, registered_at, last_used_at, last_used_by, removed_at, removed_by, removed_reason')
    .order('removed_at', { ascending: false, nullsFirst: true })
    .order('registered_at', { ascending: false })
    .limit(2000);
  if (error) throw error;
  return (data ?? []) as Array<Omit<SignInDevice, 'secret_hash'>>;
}

/** A lost or retired device stops working, and every sign-in made on it ends. */
export async function removeSignInDevice(client: CriticomClient, id: string, reason: string): Promise<void> {
  const { error } = await client.rpc('remove_sign_in_device', { p_id: id, p_reason: reason });
  if (error) throw error;
}

/** Every active officer this person looks after, with their PIN's state. */
export async function signInPinBoard(client: CriticomClient): Promise<SignInPinRow[]> {
  const { data, error } = await client.rpc('sign_in_pin_board', {});
  if (error) throw error;
  return (data ?? []) as SignInPinRow[];
}

/** A forgotten PIN: cleared; the officer's device sign-ins end. */
export async function resetSignInPin(client: CriticomClient, userId: string, reason: string): Promise<void> {
  const { error } = await client.rpc('reset_sign_in_pin', { p_user: userId, p_reason: reason });
  if (error) throw error;
}

/** Unlocked after five wrong tries. */
export async function unlockSignInPin(client: CriticomClient, userId: string): Promise<void> {
  const { error } = await client.rpc('unlock_sign_in_pin', { p_user: userId });
  if (error) throw error;
}

/** Whether the signed-in officer has a PIN. */
export async function mySignInPin(client: CriticomClient): Promise<MySignInPin> {
  const { data, error } = await client.rpc('my_sign_in_pin', {});
  if (error) throw error;
  const row = data as { has_pin?: boolean; locked?: boolean; set_at?: string | null } | null;
  return { hasPin: Boolean(row?.has_pin), locked: Boolean(row?.locked), setAt: row?.set_at ?? null };
}

/** Notes that this sign-in was made on a registered device, so the server can end it in time. */
export async function recordSignInDeviceSession(client: CriticomClient, deviceId: string): Promise<void> {
  const { error } = await client.rpc('record_sign_in_device_session', { p_device: deviceId });
  if (error) throw error;
}
