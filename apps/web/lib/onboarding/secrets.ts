import { createHmac, randomBytes, randomInt } from 'node:crypto';
import {
  ACTIVATION_CODE_ALPHABET, formatActivationCode, normaliseActivationCode,
} from '@criticom/db/onboarding';

/**
 * Invitation secrets. The link token and the printed code exist only in the
 * message that carries them; the database keeps a keyed hash (HMAC-SHA256),
 * so even someone who could read the table could not use or guess them.
 */

export type SecretKind = 'link' | 'code';

/** A link token: 256 random bits, URL-safe. */
export function newLinkToken(): string {
  return randomBytes(32).toString('base64url');
}

/** A printed activation code: eight characters from the unambiguous alphabet, as XXXX-XXXX. */
export function newActivationCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) code += ACTIVATION_CODE_ALPHABET[randomInt(ACTIVATION_CODE_ALPHABET.length)];
  return formatActivationCode(code);
}

/** The keyed hash stored in place of the secret. Links and codes hash apart, so one can never pass as the other. */
export function hashInvitationSecret(kind: SecretKind, secret: string, key: string): string {
  if (!key) throw new Error('Invitation secrets need a key (INVITATION_SECRET).');
  const value = kind === 'code' ? normaliseActivationCode(secret) : secret.trim();
  return createHmac('sha256', key).update(`${kind}:${value}`).digest('hex');
}

/** Cheap shape checks, so junk never reaches the database or the rate limiter's budget. */
export function looksLikeLinkToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function looksLikeActivationCode(code: string): boolean {
  const c = normaliseActivationCode(code);
  return c.length === 8 && [...c].every((ch) => ACTIVATION_CODE_ALPHABET.includes(ch));
}
