/**
 * Signing in with a PIN on a registered device (migration 0108): the rules the
 * phone and the server share. The phone uses them to say at once what is
 * wrong; the server applies them again before keeping a PIN.
 */

export const PIN_LENGTH = 6;
/** Wrong PINs before the PIN locks. Mirrors sign_in_pin_max_tries() in 0108. */
export const PIN_MAX_TRIES = 5;
/** A device lets an officer back in without signal for this long after their last PIN sign-in on it. */
export const OFFLINE_PASS_HOURS = 12;
/** How many officers a device remembers for signing in without signal. */
export const OFFLINE_PASSES_PER_DEVICE = 5;

/** Straight runs, up or down: the first PINs anyone tries. */
const RUNS = new Set(['012345', '123456', '234567', '345678', '456789', '987654', '876543', '765432', '654321', '543210']);

/**
 * What is wrong with a PIN, in the words the screen shows, or null when it may
 * be used. The obvious rules only (0110), so officers can choose one they will
 * remember: six digits, not one digit six times, not 123456 or 654321.
 * Mirrors sign_in_pin_problem() in the database, which has the last word.
 */
export function pinProblem(pin: string): string | null {
  if (!/^\d{6}$/.test(pin)) return 'Your PIN is 6 digits.';
  if (/^(\d)\1{5}$/.test(pin)) return 'Choose a PIN that is not one digit six times.';
  if (RUNS.has(pin)) return 'Choose a PIN that is not 123456 or 654321.';
  return null;
}

/** What the server says about a PIN sign-in. Mirrors the states of sign_in_pin_lookup() and sign_in_pin_attempt(). */
export type PinSignInState =
  | 'ok' | 'wrong' | 'locked' | 'device' | 'unknown' | 'inactive' | 'elsewhere' | 'no_pin' | 'busy' | 'error';

export type PinSignInResult =
  | { ok: true; tokenHash: string; userId: string; fullName: string | null }
  | { ok: false; state: Exclude<PinSignInState, 'ok'>; triesLeft?: number; message: string };

/** The server's words for each state; the phone shows its own translated ones. */
export const PIN_STATE_MESSAGES: Record<Exclude<PinSignInState, 'ok'>, string> = {
  wrong: 'Wrong PIN.',
  locked: 'Your PIN is locked after 5 wrong tries. Sign in with your password and choose a new PIN, or ask your supervisor to unlock it.',
  device: 'This device is no longer registered for PIN sign-in. Sign in with your password, and ask your supervisor to register it again.',
  unknown: 'We could not find that officer. Check the badge number, or sign in with your password.',
  inactive: 'This account has been deactivated. If you think this is a mistake, speak to your station commander or system administrator.',
  elsewhere: 'This device belongs to another department. Use one of your own department\'s devices, or sign in with your password.',
  no_pin: 'You have not chosen a PIN yet. Sign in with your password once, then choose one.',
  busy: 'Too many tries from this device. Wait a few minutes, then try again.',
  error: 'We could not sign you in just now. Try again shortly.',
};
