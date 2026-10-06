import { createHmac, randomUUID } from 'node:crypto';

/**
 * Signing a call to the Hikvision platform's OpenAPI (the "artemis" gateway,
 * HCM Lite and HikCentral alike), as its developer guide and the vendor's
 * Postman collection do it:
 *
 *   POST\n  Accept\n  Content-Type\n  x-ca-key:…\n  x-ca-nonce:…\n  x-ca-timestamp:…\n  path
 *
 * HMAC-SHA256 with the app secret, Base64. The timestamp and nonce are
 * signed too, so a captured request cannot be replayed. Kept apart from the
 * client so it can be checked without a server.
 */

export const ACCEPT = '*/*';
export const CONTENT_TYPE = 'application/json';

export function stringToSign(path: string, headers: { key: string; nonce: string; timestamp: string }): string {
  return [
    'POST', ACCEPT, CONTENT_TYPE,
    `x-ca-key:${headers.key}`, `x-ca-nonce:${headers.nonce}`, `x-ca-timestamp:${headers.timestamp}`,
    path,
  ].join('\n');
}

/** The headers for one signed request. `now` and `nonce` are for tests. */
export function signedHeaders(
  creds: { appKey: string; appSecret: string },
  path: string,
  opts: { now?: number; nonce?: string } = {},
): Record<string, string> {
  const timestamp = String(opts.now ?? Date.now());
  const nonce = opts.nonce ?? randomUUID();
  const signature = createHmac('sha256', creds.appSecret)
    .update(stringToSign(path, { key: creds.appKey, nonce, timestamp }), 'utf8')
    .digest('base64');
  return {
    Accept: ACCEPT,
    'Content-Type': CONTENT_TYPE,
    'X-Ca-Key': creds.appKey,
    'X-Ca-Nonce': nonce,
    'X-Ca-Timestamp': timestamp,
    'X-Ca-Signature-Headers': 'x-ca-key,x-ca-nonce,x-ca-timestamp',
    'X-Ca-Signature': signature,
  };
}

/**
 * A time as the platform wants it: ISO 8601 with milliseconds and a numeric
 * offset (yyyy-MM-dd'T'HH:mm:ss.SSSXXX), in South African time.
 */
export function toPlatformTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`Not a time: ${iso}`);
  const sa = new Date(d.getTime() + 2 * 3_600_000);
  return `${sa.toISOString().slice(0, 23)}+02:00`;
}
