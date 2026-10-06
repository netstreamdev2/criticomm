import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * A short-lived pass for weather map tiles. The officer app's map loads tiles
 * as plain images, which cannot carry its sign-in, so a signed-in phone asks
 * for a pass (app/api/weather/pass) and puts it on each tile address. The pass
 * opens weather tiles and nothing else, and only until it expires.
 *
 * Form: `<expiry in unix seconds>.<HMAC-SHA256 of "weather-tiles:<expiry>">`.
 */

export const WEATHER_PASS_TTL_S = 2 * 60 * 60;

function sign(expiry: number, key: string) {
  return createHmac('sha256', key).update(`weather-tiles:${expiry}`).digest('base64url');
}

export function issueWeatherPass(key: string, now = Date.now()): { pass: string; expiresAt: string } {
  if (!key) throw new Error('Weather passes need a signing key.');
  const expiry = Math.floor(now / 1000) + WEATHER_PASS_TTL_S;
  return { pass: `${expiry}.${sign(expiry, key)}`, expiresAt: new Date(expiry * 1000).toISOString() };
}

export function weatherPassValid(pass: string | null | undefined, key: string, now = Date.now()): boolean {
  if (!pass || !key) return false;
  const m = /^(\d{10})\.([A-Za-z0-9_-]{43})$/.exec(pass);
  if (!m) return false;
  const expiry = Number(m[1]);
  // Not expired, and not issued further ahead than a pass ever is.
  const nowS = Math.floor(now / 1000);
  if (expiry < nowS || expiry > nowS + WEATHER_PASS_TTL_S + 60) return false;
  const want = Buffer.from(sign(expiry, key));
  const got = Buffer.from(m[2]!);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** The key: its own setting when given, else the service role key the server already holds. */
export function weatherPassKey(): string {
  return process.env.WEATHER_PASS_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}
