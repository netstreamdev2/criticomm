import 'server-only';

/**
 * BulkSMS sender — port of NotificationsController.TriggerLocationSms.
 * V4 hardcoded the token pair in source (part of the credential leak);
 * V5 reads BULKSMS_TOKEN_ID / BULKSMS_TOKEN_SECRET from the environment.
 */

/** V4 phone normalisation: 0xx → +27xx, bare numbers get a +. */
export function normalizeSaPhone(phone: string): string {
  const p = phone.trim().replace(/\s+/g, '');
  if (p.startsWith('0')) return `+27${p.slice(1)}`;
  if (!p.startsWith('+')) return `+${p}`;
  return p;
}

export type SmsResult =
  | { ok: true }
  | { ok: false; reason: 'unconfigured' | 'rejected' | 'error'; detail?: string };

export async function sendSms(to: string, body: string): Promise<SmsResult> {
  const tokenId = process.env.BULKSMS_TOKEN_ID;
  const tokenSecret = process.env.BULKSMS_TOKEN_SECRET;
  if (!tokenId || !tokenSecret) {
    return { ok: false, reason: 'unconfigured', detail: 'BULKSMS_TOKEN_ID / BULKSMS_TOKEN_SECRET not set' };
  }

  try {
    const res = await fetch('https://api.bulksms.com/v1/messages', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${tokenId}:${tokenSecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{ to: normalizeSaPhone(to), body }]),
    });
    if (!res.ok) {
      return { ok: false, reason: 'rejected', detail: `${res.status} ${await res.text()}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'error', detail: (e as Error).message };
  }
}
