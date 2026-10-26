import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { recordSignInDeviceSession, removeSignInDevice } from '@criticom/api';
import type { PinSignInResult } from '@criticom/db/sign-in-pin';
import { adoptSavedSession, keepCacheAtNextSignOut } from './auth';
import { webUrl } from './api-host';
import { radioId } from './presence';
import { getSupabase, signOutKeepingSession, writeSavedSession } from './supabase';
import {
  checkOffline, dropPass, findPass, livePasses, newPass, park, remember, type OfflinePass, type Who,
} from './offline-pass-policy';

/**
 * PIN sign-in on a registered device (0108, 0110), on the phone.
 *
 *   * A supervisor registers the device once, straight with the database,
 *     which makes its key; the key is kept here and sent with each PIN
 *     sign-in. Choosing or changing a PIN also goes straight to the database,
 *     so neither needs the web server (whose address changes with the Wi-Fi).
 *   * With signal, the web server has the database check the PIN and gives a
 *     one-time sign-in, exchanged here for a session. The device then
 *     remembers the officer for one shift (lib/offline-pass-policy.ts).
 *   * Handing the device over signs out without ending the sign-in at the
 *     server; it is set aside, so with no signal the officer's PIN takes it
 *     back up. The server still ends it after 14 hours, when the device is
 *     removed, or when their PIN is reset.
 */

const DEVICE_KEY = 'criticom.signin.device.v1';
const PASSES_KEY = 'criticom.signin.passes.v1';
const OFFICERS_KEY = 'criticom.signin.officers.v1';

export type RegisteredDevice = { id: string; secret: string; label: string; silo: string | null; radioId: string | null };

/* ── This device's registration ──────────────────────────────────────── */

export async function registeredDevice(): Promise<RegisteredDevice | null> {
  try {
    const raw = await AsyncStorage.getItem(DEVICE_KEY);
    const d = raw ? JSON.parse(raw) as Partial<RegisteredDevice> : null;
    return d?.id && d.secret && d.label ? { id: d.id, secret: d.secret, label: d.label, silo: d.silo ?? null, radioId: d.radioId ?? null } : null;
  } catch {
    return null;
  }
}

/** This device's registration, for a screen; `refresh` after registering or removing it. */
export function useRegisteredDevice() {
  const [device, setDevice] = useState<RegisteredDevice | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setDevice(await registeredDevice());
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return { device, loading, refresh };
}

/** A supervisor registers the device they hold. The database decides whether they may, and makes the key. */
export async function registerThisDevice(label: string): Promise<RegisteredDevice> {
  const { data, error } = await getSupabase().rpc('register_sign_in_device', { p_label: label, p_radio_id: await radioId() });
  if (error || !data) throw new Error(error?.message ?? 'The device could not be registered.');
  const device: RegisteredDevice = { id: data.id, label: data.label, silo: data.silo, radioId: data.radio_id, secret: data.key };
  await AsyncStorage.setItem(DEVICE_KEY, JSON.stringify(device));
  // A device registered afresh starts with nobody remembered.
  await AsyncStorage.multiRemove([PASSES_KEY, OFFICERS_KEY]).catch(() => {});
  return device;
}

/** Takes this device out of PIN sign-in, at the server (every sign-in made on it ends) and here. */
export async function removeThisDevice(reason: string): Promise<void> {
  const device = await registeredDevice();
  if (device) await removeSignInDevice(getSupabase(), device.id, reason);
  await forgetThisDevice();
}

/** Forgets the registration and everyone remembered, on this device only. */
export async function forgetThisDevice(): Promise<void> {
  await AsyncStorage.multiRemove([DEVICE_KEY, PASSES_KEY, OFFICERS_KEY]).catch(() => {});
}

/* ── Who this device remembers ───────────────────────────────────────── */

async function readPasses(): Promise<OfflinePass[]> {
  try {
    const raw = await AsyncStorage.getItem(PASSES_KEY);
    const list = raw ? JSON.parse(raw) as OfflinePass[] : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function writePasses(passes: OfflinePass[]): Promise<void> {
  await AsyncStorage.setItem(PASSES_KEY, JSON.stringify(passes)).catch(() => {});
}

export type DeviceOfficer = { userId: string; name: string | null; badge: string | null; silo: string | null };

/**
 * The names to choose from on the sign-in screen (0109): the officers who
 * may sign in here with a PIN, fresh from the server with signal, else the
 * list kept from last time; and anyone this device remembers who is not on it.
 */
export async function deviceOfficers(): Promise<DeviceOfficer[]> {
  const device = await registeredDevice();
  if (!device) return [];
  let list: DeviceOfficer[] | null = null;
  const url = webUrl('/api/pin/officers');
  if (url) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 15_000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: device.id, deviceSecret: device.secret }),
        signal: abort.signal,
      });
      const answer = res.ok ? await res.json() as { ok: boolean; state?: string; officers?: DeviceOfficer[] } : null;
      if (answer?.ok && Array.isArray(answer.officers)) {
        list = answer.officers;
        await AsyncStorage.setItem(OFFICERS_KEY, JSON.stringify(list)).catch(() => {});
      } else if (answer?.state === 'device') {
        // Removed in the console: nobody signs in here with a PIN any more.
        await forgetThisDevice();
        return [];
      }
    } catch {
      // No signal: the list kept from last time.
    } finally {
      clearTimeout(timer);
    }
  }
  if (!list) {
    try {
      const kept = JSON.parse((await AsyncStorage.getItem(OFFICERS_KEY)) ?? '[]') as DeviceOfficer[];
      list = Array.isArray(kept) ? kept : [];
    } catch {
      list = [];
    }
  }
  const known = new Set(list.map((o) => o.userId));
  const extra = livePasses(await readPasses(), Date.now())
    .filter((p) => !known.has(p.userId))
    .map((p) => ({ userId: p.userId, name: p.name, badge: p.badge, silo: null }));
  return [...list, ...extra];
}

/** Not secret, only different per pass. */
const newSalt = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

async function rememberOfficer(args: { userId: string; name: string | null; badge: string | null; pin: string }) {
  const now = Date.now();
  const passes = await readPasses();
  const badge = args.badge ?? findPass(passes, { userId: args.userId })?.badge ?? null;
  await writePasses(remember(passes, newPass({ ...args, badge, salt: newSalt(), now }), now));
}

/* ── Signing in ──────────────────────────────────────────────────────── */

export type PinOutcome =
  | { ok: true; offline: boolean }
  | { ok: false; state: string; triesLeft?: number; offline: boolean };

class NoSignal extends Error {}

/** The server's answer; NoSignal when it cannot be reached (no signal, or the server is down). */
async function askServer(device: RegisteredDevice, who: Who, pin: string): Promise<PinSignInResult> {
  const url = webUrl('/api/pin/sign-in');
  if (!url) return { ok: false, state: 'error', message: 'This build has no web address configured.' };
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 15_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: device.id, deviceSecret: device.secret, userId: who.userId ?? null, badge: who.badge ?? null, pin }),
      signal: abort.signal,
    });
    if (res.status >= 500) throw new NoSignal();
    if (!res.ok) return { ok: false, state: 'error', message: `Request failed (${res.status})` };
    return await res.json() as PinSignInResult;
  } catch (e) {
    if (e instanceof NoSignal) throw e;
    throw new NoSignal();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Signs in with a PIN on this registered device: at the server when there
 * is signal, else with the sign-in this officer set aside here at hand-over.
 */
export async function signInWithPin(who: Who, pin: string): Promise<PinOutcome> {
  const device = await registeredDevice();
  if (!device) return { ok: false, state: 'device', offline: false };

  let answer: PinSignInResult;
  try {
    answer = await askServer(device, who, pin);
  } catch {
    return signInWithoutSignal(who, pin);
  }

  if (!answer.ok) {
    // What the server says outranks what this device remembers.
    if (answer.state === 'device') await forgetThisDevice();
    if (answer.state === 'locked' || answer.state === 'no_pin' || answer.state === 'inactive') {
      const pass = findPass(await readPasses(), who);
      if (pass) await writePasses(dropPass(await readPasses(), pass.userId));
    }
    return { ok: false, state: answer.state, triesLeft: answer.triesLeft, offline: false };
  }

  // Remembered before the session starts: the screen moves on as soon as it does.
  await rememberOfficer({ userId: answer.userId, name: answer.fullName, badge: who.badge ?? null, pin });
  const sb = getSupabase();
  let { error } = await sb.auth.verifyOtp({ token_hash: answer.tokenHash, type: 'email' });
  if (error) ({ error } = await sb.auth.verifyOtp({ token_hash: answer.tokenHash, type: 'magiclink' }));
  if (error) return { ok: false, state: 'error', offline: false };
  await recordSignInDeviceSession(sb, device.id).catch(() => {});
  return { ok: true, offline: false };
}

async function signInWithoutSignal(who: Who, pin: string): Promise<PinOutcome> {
  const { check, passes } = checkOffline(await readPasses(), who, pin, Date.now());
  await writePasses(passes);
  if (!check.ok) return { ok: false, state: `offline_${check.reason}`, triesLeft: check.triesLeft, offline: true };
  await writeSavedSession(check.session);
  await adoptSavedSession();
  return { ok: true, offline: true };
}

/** After a password sign-in on a registered device: noted, so the server can end it in time. */
export async function notePasswordSignIn(): Promise<void> {
  const device = await registeredDevice();
  if (device) await recordSignInDeviceSession(getSupabase(), device.id).catch(() => {});
}

/* ── Handing the device over ─────────────────────────────────────────── */

/**
 * Signs out, setting the sign-in aside for this officer if the device
 * remembers them, so they can take it back up with their PIN with no
 * signal. False when it does not apply here (the caller signs out as usual).
 */
export async function handOver(userId: string): Promise<boolean> {
  if (!(await registeredDevice())) return false;
  if (!livePasses(await readPasses(), Date.now()).some((p) => p.userId === userId)) return false;
  keepCacheAtNextSignOut();
  let raw: string | null;
  try {
    raw = await signOutKeepingSession();
  } catch {
    keepCacheAtNextSignOut(false);
    return false;
  }
  if (raw) await writePasses(park(await readPasses(), userId, raw, Date.now()).passes);
  return true;
}

/* ── Choosing a PIN ──────────────────────────────────────────────────── */

/**
 * Straight after a password sign-in on a registered device, choosing a PIN
 * comes up once. Nothing else is asked then: the database sees the sign-in
 * was by password in the last 30 minutes (0110).
 */
let offer: { until: number; taken: boolean } | null = null;

export function offerPinSetup() {
  offer = { until: Date.now() + 10 * 60_000, taken: false };
}

/** Once, straight after a password sign-in on a registered device: go to choosing a PIN. */
export function takePinSetupOffer(): boolean {
  if (!offer || offer.taken || offer.until < Date.now()) return false;
  offer.taken = true;
  return true;
}

export function clearPinSetupOffer() {
  offer = null;
}

/**
 * What the database said: done, or why not — proof (ask for the current PIN
 * or the password), wrong_pin, wrong_password, locked, busy. A PIN that
 * breaks a rule comes back as `message`.
 */
export type PinChoice =
  | { ok: true }
  | { ok: false; state: 'proof' | 'wrong_pin' | 'wrong_password' | 'locked' | 'busy' | 'rule' | 'error'; triesLeft?: number; message?: string };

/**
 * The officer's new PIN, straight to the database (0110): proven by the
 * current PIN, or the password, or by having just signed in with the
 * password. This device then remembers them for the shift.
 */
export async function choosePin(args: {
  pin: string; currentPin?: string | null; password?: string | null; userId: string; name: string | null; badge: string | null;
}): Promise<PinChoice> {
  const { data, error } = await getSupabase().rpc('set_my_sign_in_pin', {
    p_pin: args.pin, p_current_pin: args.currentPin ?? null, p_password: args.password ?? null,
  });
  // A PIN that breaks a rule is refused with the rule (22023).
  if (error) return { ok: false, state: error.code === '22023' ? 'rule' : 'error', message: error.message };
  if (!data?.ok) {
    return { ok: false, state: (data?.state as Exclude<PinChoice, { ok: true }>['state'] | undefined) ?? 'error', triesLeft: data?.tries_left };
  }
  clearPinSetupOffer();
  if (await registeredDevice()) await rememberOfficer({ userId: args.userId, name: args.name, badge: args.badge, pin: args.pin });
  return { ok: true };
}
