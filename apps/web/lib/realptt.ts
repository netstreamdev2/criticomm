import 'server-only';
import { createHash, createHmac } from 'node:crypto';

/**
 * RealPTT client — faithful port of ResponderController's PTT integration.
 *
 * Protocol (undocumented publicly, reverse-engineered in V4):
 *   1. GET /ptt/random                        → { data: { random, sessionId } }
 *   2. pwd = hex_hmac_sha1(random, hex_sha1(password))
 *   3. GET /ptt/organization;jsessionid={sid}?method=login&account={acct}&pwd={pwd}&timeZoneOffset=-120
 *   4. GET /ptt/user;jsessionid={sid}?method=get&user_account={acct}  → data.users[0].user_id
 *   5. GET /ptt/msgServer;jsessionid={sid}?method=sendMsg&userId={id}&data={text}
 *   6. GET /ptt/audio;jsessionid={sid}?method=get&user_account=&start_time=&limit=&page=
 *
 * Credentials come from REALPTT_ACCOUNT / REALPTT_PASSWORD (V4 hardcoded nets/Realptt1).
 */

const BASE = 'https://api.realptt.com/ptt';

const sha1Hex = (s: string) => createHash('sha1').update(s).digest('hex');
const hmacSha1Hex = (key: string, data: string) => createHmac('sha1', key).update(data).digest('hex');

type PttJson = {
  code?: number;
  data?: {
    random?: string;
    sessionId?: string;
    users?: Array<{ user_id?: number }>;
    audios?: Array<{ id: number; time: string; play_url: string }>;
  };
};

async function getJson(url: string): Promise<PttJson> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`RealPTT ${res.status} ${res.statusText}`);
  return (await res.json()) as PttJson;
}

export function isPttConfigured() {
  return Boolean(process.env.REALPTT_ACCOUNT && process.env.REALPTT_PASSWORD);
}

/** Steps 1–3: authenticate and return the session id. */
async function login(): Promise<string> {
  const account = process.env.REALPTT_ACCOUNT;
  const password = process.env.REALPTT_PASSWORD;
  if (!account || !password) throw new Error('REALPTT_ACCOUNT / REALPTT_PASSWORD not set');

  const rnd = await getJson(`${BASE}/random`);
  const random = rnd.data?.random;
  const sid = rnd.data?.sessionId;
  if (!random || !sid) throw new Error('RealPTT /random returned no session');

  const pwd = hmacSha1Hex(random, sha1Hex(password));
  await getJson(
    `${BASE}/organization;jsessionid=${sid}?method=login&account=${encodeURIComponent(account)}&pwd=${pwd}&timeZoneOffset=-120`,
  );
  return sid;
}

/** Steps 4–5: resolve the numeric user id and deliver a text message to the radio. */
export async function sendPttMessage(targetAccount: string, senderName: string, text: string) {
  const sid = await login();

  const userData = await getJson(
    `${BASE}/user;jsessionid=${sid}?method=get&user_account=${encodeURIComponent(targetAccount)}`,
  );
  const targetUserId =
    userData.code === 0 ? userData.data?.users?.[0]?.user_id ?? 0 : 0;
  if (!targetUserId) {
    return { ok: false as const, error: `Could not find a RealPTT numeric ID for account: ${targetAccount}` };
  }

  // V4 payload format: "[DISPATCHERNAME]: message"
  const payload = `[${senderName.toUpperCase()}]: ${text}`;
  const msg = await getJson(
    `${BASE}/msgServer;jsessionid=${sid}?method=sendMsg&userId=${targetUserId}&data=${encodeURIComponent(payload)}`,
  );
  if (msg.code === 0) return { ok: true as const };
  return { ok: false as const, error: 'The RealPTT API rejected the message.' };
}

/** Step 6: recent voice recordings for a unit (V4 window: last 2 hours, newest first). */
export async function getPttAudioLog(account: string) {
  const sid = await login();
  const start = new Date(Date.now() - 2 * 3600_000)
    .toISOString().slice(0, 19).replace('T', ' ');

  const data = await getJson(
    `${BASE}/audio;jsessionid=${sid}?method=get&user_account=${encodeURIComponent(account)}` +
    `&start_time=${encodeURIComponent(start)}&limit=100&page=0`,
  );
  if (data.code !== 0) return { ok: false as const, error: 'RealPTT audio query failed' };
  const audios = [...(data.data?.audios ?? [])].reverse(); // newest first, as in V4
  return { ok: true as const, audios };
}
