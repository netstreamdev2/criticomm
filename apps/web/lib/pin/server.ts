import 'server-only';
import { headers } from 'next/headers';
import { hitKeyedRateLimit } from '@criticom/api';
import { PIN_STATE_MESSAGES, type PinSignInResult, type PinSignInState } from '@criticom/db/sign-in-pin';
import { getServiceSupabase } from '@/lib/supabase';

/**
 * PIN sign-in on a registered device, the web server's part: starting the
 * sign-in once the database has checked the device and the PIN, which only
 * the server may do, and the device's list of names.
 *
 * Since 0110 the database keeps and checks every hash itself (bcrypt for the
 * PIN, SHA-256 for the device key), and the phone chooses PINs and registers
 * devices straight with the database. Nothing here is a secret to keep, so
 * moving the web server breaks nothing.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The key the database made when the device was registered: 64 hex characters. */
const DEVICE_KEY = /^[0-9a-f]{64}$/;

async function clientAddress() {
  const h = await headers();
  return (h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown').slice(0, 64);
}

/** Per-key limits on top of the five-try lock in the database. */
async function allowed(key: string, limit: number, windowSeconds: number) {
  try {
    return await hitKeyedRateLimit(getServiceSupabase(), key, limit, windowSeconds);
  } catch {
    // The limiter is a second line; the database's lock still holds.
    return true;
  }
}

/* ── Who a registered device lists ───────────────────────────────────── */

export type DeviceOfficer = { userId: string; name: string | null; badge: string | null; silo: string };
export type DeviceOfficers = { ok: true; officers: DeviceOfficer[] } | { ok: false; state: 'device' | 'busy' | 'error' };

/**
 * The officers who may sign in on this device with a PIN, by department and
 * name (0109), for the sign-in screen. Only the device's own key gets it.
 */
export async function officersForDevice(args: { deviceId: string; deviceSecret: string }): Promise<DeviceOfficers> {
  if (!UUID.test(args.deviceId) || !DEVICE_KEY.test(args.deviceSecret)) return { ok: false, state: 'device' };
  if (!(await allowed(`pin-list:${args.deviceId}`, 30, 600))) return { ok: false, state: 'busy' };
  try {
    const { data, error } = await getServiceSupabase().rpc('sign_in_device_officers', {
      p_device: args.deviceId, p_device_key: args.deviceSecret,
    });
    if (error || !data) return { ok: false, state: 'error' };
    if (data.state !== 'ok') return { ok: false, state: 'device' };
    return {
      ok: true,
      officers: (data.officers ?? []).map((o) => ({ userId: o.user_id, name: o.full_name, badge: o.badge_number, silo: o.silo })),
    };
  } catch {
    return { ok: false, state: 'error' };
  }
}

/* ── Signing in with a PIN ───────────────────────────────────────────── */

const refusal = (state: Exclude<PinSignInState, 'ok'>, triesLeft?: number): PinSignInResult => ({
  ok: false, state, triesLeft,
  message: state === 'wrong' && triesLeft !== undefined
    ? `${PIN_STATE_MESSAGES.wrong} ${triesLeft} ${triesLeft === 1 ? 'try' : 'tries'} left.`
    : PIN_STATE_MESSAGES[state],
});

const knownState = (s: unknown): Exclude<PinSignInState, 'ok'> =>
  (typeof s === 'string' && s in PIN_STATE_MESSAGES ? s : 'error') as Exclude<PinSignInState, 'ok'>;

/**
 * The database checks the device and the PIN (and counts wrong tries, locking
 * at five); then a one-time sign-in is made for the officer, which the phone
 * exchanges for a session at once. Each connection and device is limited too.
 */
export async function signInWithPin(args: {
  deviceId: string; deviceSecret: string; userId: string | null; badge: string | null; pin: string;
}): Promise<PinSignInResult> {
  if (!UUID.test(args.deviceId) || !DEVICE_KEY.test(args.deviceSecret)) return refusal('device');
  if (args.userId !== null && !UUID.test(args.userId)) return refusal('unknown');
  if (args.userId === null && !(args.badge ?? '').trim()) return refusal('unknown');
  if (!/^\d{6}$/.test(args.pin)) return refusal('wrong');
  if (!(await allowed(`pin-ip:${await clientAddress()}`, 30, 600))) return refusal('busy');
  if (!(await allowed(`pin-device:${args.deviceId}`, 20, 600))) return refusal('busy');

  const service = getServiceSupabase();
  try {
    const { data: look, error: lookError } = await service.rpc('sign_in_pin_lookup', {
      p_device: args.deviceId, p_device_key: args.deviceSecret, p_user: args.userId, p_badge: args.userId ? null : (args.badge ?? '').slice(0, 40),
    });
    if (lookError || !look) return refusal('error');
    if (look.state !== 'ok' || !look.user_id) return refusal(knownState(look.state));

    const { data: tried, error: tryError } = await service.rpc('sign_in_pin_attempt', {
      p_device: args.deviceId, p_device_key: args.deviceSecret, p_user: look.user_id, p_pin: args.pin,
    });
    if (tryError || !tried) return refusal('error');
    if (tried.state !== 'ok' || !tried.email) return refusal(knownState(tried.state), tried.tries_left);

    // A one-time sign-in, never sent anywhere: the phone exchanges it at once.
    const { data: link, error: linkError } = await service.auth.admin.generateLink({ type: 'magiclink', email: tried.email });
    const tokenHash = link?.properties?.hashed_token;
    if (linkError || !tokenHash) return refusal('error');
    return { ok: true, tokenHash, userId: look.user_id, fullName: tried.full_name ?? null };
  } catch {
    return refusal('error');
  }
}
