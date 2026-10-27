import { ETHEKWINI_BOX } from './sources.ts';

/**
 * The outside sources with no data service of their own, read the way their
 * websites publish (Hazard watch): the NICD's latest reports and RMIS's
 * foot-and-mouth news from their sites' public post lists, and NASA FIRMS's
 * fire count over eThekwini when a free key is set. Kept an hour on the
 * server. Titles and links only; nothing about any person.
 */

export type Post = { title: string; date: string; url: string };

const cache = new Map<string, { at: number; data: unknown }>();
async function kept<T>(key: string, minutes: number, run: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < minutes * 60_000) return hit.data as T;
  try {
    const data = await run();
    cache.set(key, { at: Date.now(), data });
    return data;
  } catch (e) {
    if (hit) return hit.data as T;
    throw e;
  }
}

const decode = (s: string) => s
  .replace(/<[^>]+>/g, '')
  .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCharCode(Number.parseInt(h, 16)))
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .trim();

/** A WordPress site's latest posts (its public /wp-json list): title, date and link. */
export function readPosts(json: unknown): Post[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((p: { title?: { rendered?: string }; date?: string; link?: string }) => {
    const title = decode(p?.title?.rendered ?? '');
    const url = typeof p?.link === 'string' && /^https?:\/\//.test(p.link) ? p.link.replace(/^http:/, 'https:') : '';
    return title && url ? [{ title, date: String(p.date ?? '').slice(0, 10), url }] : [];
  });
}

async function posts(site: string, count: number): Promise<Post[]> {
  const res = await fetch(`${site}/wp-json/wp/v2/posts?per_page=${count}&_fields=date,link,title`, {
    cache: 'no-store', signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`${new URL(site).host} answered ${res.status}`);
  return readPosts(await res.json());
}

/** The NICD's latest reports: outbreaks, situation reports, alerts. */
export const nicdReports = () => kept('nicd', 60, () => posts('https://www.nicd.ac.za', 8));

/** Foot-and-mouth disease news from RMIS (the red meat industry's animal health service). */
export const fmdNews = () => kept('rmis', 60, async () =>
  (await posts('https://rmis.co.za', 40)).filter((p) => /\bFMD\b|foot[\s-]+and[\s-]+mouth/i.test(p.title)).slice(0, 6));

/** Fires FIRMS saw over eThekwini in the last 24 hours (needs FIRMS_MAP_KEY); null without a key. */
export const firmsFiresToday = () => kept('firms', 60, async (): Promise<number | null> => {
  const key = process.env.FIRMS_MAP_KEY;
  if (!key) return null;
  const res = await fetch(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/VIIRS_NOAA20_NRT/${ETHEKWINI_BOX.join(',')}/1`, {
    cache: 'no-store', signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`FIRMS answered ${res.status}`);
  const lines = (await res.text()).trim().split('\n');
  return Math.max(0, lines.length - 1);
});
