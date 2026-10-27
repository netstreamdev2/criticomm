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

/** A warning runs to several SMS parts (warningSms keeps it within six). */
export const SMS_MAX_PARTS = 6;

/**
 * The same message to many numbers (the warning SMS to every councillor), a
 * hundred to a request. Counts what went and what did not.
 */
export async function sendSmsMany(to: string[], body: string): Promise<{ sent: number; failed: number; unconfigured: boolean; detail?: string }> {
  const tokenId = process.env.BULKSMS_TOKEN_ID;
  const tokenSecret = process.env.BULKSMS_TOKEN_SECRET;
  if (!tokenId || !tokenSecret) return { sent: 0, failed: to.length, unconfigured: true };
  const numbers = [...new Set(to.map(normalizeSaPhone))];
  let sent = 0;
  let failed = 0;
  let detail: string | undefined;
  for (let i = 0; i < numbers.length; i += 100) {
    const batch = numbers.slice(i, i + 100);
    try {
      const res = await fetch('https://api.bulksms.com/v1/messages', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${tokenId}:${tokenSecret}`).toString('base64')}`,
          'Content-Type': 'application/json',
        },
        // A warning runs to several parts; BulkSMS stops at 3 unless told.
        body: JSON.stringify(batch.map((n) => ({ to: n, body, longMessageMaxParts: SMS_MAX_PARTS }))),
      });
      if (res.ok) sent += batch.length;
      else { failed += batch.length; detail = `${res.status} ${(await res.text()).slice(0, 200)}`; }
    } catch (e) {
      failed += batch.length;
      detail = (e as Error).message;
    }
  }
  return { sent, failed, unconfigured: false, detail };
}
