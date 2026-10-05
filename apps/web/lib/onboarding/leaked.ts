import 'server-only';
import { createHash } from 'node:crypto';

/**
 * Has this password appeared in a known data breach? Uses the Pwned Passwords
 * range API with k-anonymity: only the first five characters of the
 * password's SHA-1 hash leave the server, never the password or its full
 * hash. Returns null when the service cannot be reached, so an outage never
 * stops someone activating; the length and personal-detail rules still apply.
 */
export async function isLeakedPassword(password: string): Promise<boolean | null> {
  const sha1 = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true', 'User-Agent': 'HikTech-account-activation' },
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = await res.text();
    return body.split('\n').some((line) => {
      const [hashSuffix, count] = line.trim().split(':');
      return hashSuffix === suffix && Number(count) > 0;
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
