import { OFFLINE_PASS_HOURS, OFFLINE_PASSES_PER_DEVICE, PIN_MAX_TRIES } from '@criticom/db/sign-in-pin';
import { pbkdf2Sha256, sameHex, toHex, utf8 } from './pin-crypto.ts';

/**
 * Signing in with a PIN without signal (0108), as rules with no app
 * dependencies, so they can be tested.
 *
 * A registered device remembers the last officers who signed in on it with
 * their PIN, for one shift: a slow hash of the PIN to check it against, and —
 * once they hand the device over — their sign-in, set aside rather than
 * ended. With no signal, the right PIN takes that sign-in back up; it is
 * renewed when signal returns, and the server ends it after 14 hours, when
 * the device is removed or when the PIN is reset, whatever the phone says.
 * Five wrong PINs and the device forgets the officer.
 */

/** PBKDF2 rounds for the PIN check: a few hundred milliseconds on a radio. */
export const PASS_ITERATIONS = 10_000;
const HOUR = 3_600_000;

export type OfflinePass = {
  userId: string;
  name: string | null;
  badge: string | null;
  salt: string;
  verifier: string;
  iterations: number;
  /** Their last PIN sign-in on this device, online. */
  signedInAt: number;
  expiresAt: number;
  failed: number;
  /** Their sign-in, set aside at hand-over exactly as supabase-js kept it; null while in use. */
  session: string | null;
};

export type Who = { userId?: string | null; badge?: string | null };

/** Badge numbers compared forgivingly, as the database does (normalise_badge, 0049). */
export const badgeKey = (badge: string | null | undefined) => String(badge ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export function verifierFor(pin: string, userId: string, salt: string, iterations = PASS_ITERATIONS): string {
  return toHex(pbkdf2Sha256(utf8(pin), utf8(`${salt}:${userId}`), iterations));
}

/** A fresh pass after a PIN sign-in online (or choosing a PIN on this device). */
export function newPass(args: { userId: string; name: string | null; badge: string | null; pin: string; salt: string; now: number }): OfflinePass {
  return {
    userId: args.userId,
    name: args.name,
    badge: args.badge,
    salt: args.salt,
    verifier: verifierFor(args.pin, args.userId, args.salt),
    iterations: PASS_ITERATIONS,
    signedInAt: args.now,
    expiresAt: args.now + OFFLINE_PASS_HOURS * HOUR,
    failed: 0,
    session: null,
  };
}

/** The passes still good, newest first. */
export function livePasses(passes: readonly OfflinePass[], now: number): OfflinePass[] {
  return passes.filter((p) => p.expiresAt > now).sort((a, b) => b.signedInAt - a.signedInAt);
}

/** Keeps a new pass: replaces that officer's old one, and remembers at most the newest few. */
export function remember(passes: readonly OfflinePass[], pass: OfflinePass, now: number): OfflinePass[] {
  return livePasses([pass, ...passes.filter((p) => p.userId !== pass.userId)], now).slice(0, OFFLINE_PASSES_PER_DEVICE);
}

export function findPass(passes: readonly OfflinePass[], who: Who): OfflinePass | null {
  if (who.userId) return passes.find((p) => p.userId === who.userId) ?? null;
  const key = badgeKey(who.badge);
  return key ? passes.find((p) => badgeKey(p.badge) === key) ?? null : null;
}

export type OfflineCheck =
  | { ok: true; pass: OfflinePass; session: string }
  | { ok: false; reason: 'none' | 'expired' | 'no_session' | 'wrong' | 'locked'; triesLeft?: number };

/**
 * A PIN tried with no signal. Right: the sign-in set aside comes back (and is
 * no longer kept on the pass, as it is in use again). Wrong: counted; the
 * fifth forgets the officer on this device. A right PIN with nothing set
 * aside (they never handed over) cannot sign in here without signal.
 */
export function checkOffline(passes: readonly OfflinePass[], who: Who, pin: string, now: number): { check: OfflineCheck; passes: OfflinePass[] } {
  const pass = findPass(passes, who);
  if (!pass) return { check: { ok: false, reason: 'none' }, passes: [...passes] };
  const others = passes.filter((p) => p.userId !== pass.userId);
  if (pass.expiresAt <= now) return { check: { ok: false, reason: 'expired' }, passes: others };

  if (!sameHex(verifierFor(pin, pass.userId, pass.salt, pass.iterations), pass.verifier)) {
    const failed = pass.failed + 1;
    if (failed >= PIN_MAX_TRIES) return { check: { ok: false, reason: 'locked' }, passes: others };
    return { check: { ok: false, reason: 'wrong', triesLeft: PIN_MAX_TRIES - failed }, passes: [{ ...pass, failed }, ...others] };
  }
  if (!pass.session) return { check: { ok: false, reason: 'no_session' }, passes: [{ ...pass, failed: 0 }, ...others] };
  return { check: { ok: true, pass, session: pass.session }, passes: [{ ...pass, failed: 0, session: null }, ...others] };
}

/** At hand-over: the officer's sign-in is set aside on their pass, if they have a live one. */
export function park(passes: readonly OfflinePass[], userId: string, session: string, now: number): { parked: boolean; passes: OfflinePass[] } {
  const pass = passes.find((p) => p.userId === userId && p.expiresAt > now);
  if (!pass) return { parked: false, passes: [...passes] };
  return { parked: true, passes: passes.map((p) => (p === pass ? { ...p, session } : p)) };
}

/** Forget an officer on this device. */
export function dropPass(passes: readonly OfflinePass[], userId: string): OfflinePass[] {
  return passes.filter((p) => p.userId !== userId);
}
