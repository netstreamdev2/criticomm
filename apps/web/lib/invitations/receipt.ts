import { createHmac, timingSafeEqual } from 'node:crypto';

export const INVITATION_COOKIE = 'criticom-invitation';
export const RECEIPT_SECONDS = 3600;

function signature(payload: string, secret: string) {
  if (!secret) throw new Error('Invitation signing key is missing.');
  return createHmac('sha256', secret).update(`criticom-invite-v1:${payload}`).digest('base64url');
}

// This receipt only permits reading an invitation. It is never an Auth session.
export function createInvitationReceipt(userId: string, invitationId: string, secret: string, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ userId, invitationId, expires: now + RECEIPT_SECONDS * 1000 })).toString('base64url');
  return `${payload}.${signature(payload, secret)}`;
}

export function readInvitationReceipt(value: string | undefined, secret: string, now = Date.now()): {
  userId: string; invitationId: string;
} | null {
  if (!value || value.length > 1024) return null;
  const [payload, supplied, extra] = value.split('.');
  if (!payload || !supplied || extra !== undefined) return null;
  const expected = Buffer.from(signature(payload, secret));
  const actual = Buffer.from(supplied);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof decoded.userId !== 'string' || typeof decoded.invitationId !== 'string'
      || typeof decoded.expires !== 'number' || decoded.expires <= now) return null;
    return { userId: decoded.userId, invitationId: decoded.invitationId };
  } catch { return null; }
}
