import 'server-only';
import { cookies } from 'next/headers';
import type { CriticomClient } from '@criticom/db';
import {
  DEFAULT_LANG, isLang, makeTranslator, mergeDictionaries, type Dictionary, type LangCode,
} from '@criticom/db/i18n';
import { bundled } from '@criticom/db/i18n/locales';

/**
 * The console's language: the one the person chose (profiles.language, kept
 * in a cookie with their account, so a page needs no extra query and a shared
 * control-room computer never shows one person's language to the next), else
 * English. The approved translations are the app's own copy plus any approved
 * since, read from the database and kept for five minutes.
 */

export const LANG_COOKIE = 'criticom-lang';
const CACHE_MS = 5 * 60_000;
const cache = new Map<LangCode, { at: number; dict: Dictionary }>();

/** The cookie's value: whose choice it is, and the language. */
export const langCookieValue = (userId: string, lang: LangCode) => `${userId}:${lang}`;

/** The language for this request: this person's cookie, else their profile, else English. */
export async function currentLang(supabase?: CriticomClient, userId?: string): Promise<LangCode> {
  const jar = await cookies();
  const [owner, fromCookie] = (jar.get(LANG_COOKIE)?.value ?? '').split(':');
  if (userId && owner === userId && isLang(fromCookie)) return fromCookie;
  if (supabase && userId) {
    // Before 0078 there is no language column: English.
    const { data } = await supabase.from('profiles').select('language').eq('id', userId).maybeSingle();
    const lang = (data as { language?: string | null } | null)?.language;
    if (isLang(lang)) return lang;
  }
  return DEFAULT_LANG;
}

/** Every approved translation for a language: the app's copy, then the database's. */
export async function dictionaryFor(supabase: CriticomClient, lang: LangCode): Promise<Dictionary> {
  if (lang === 'en') return {};
  const hit = cache.get(lang);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.dict;
  const fresh: Record<string, string> = {};
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('translations').select('key, text').eq('lang', lang).eq('status', 'approved')
      .order('key').range(from, from + 999);
    if (error || !data) break;
    for (const r of data as Array<{ key: string; text: string }>) fresh[r.key] = r.text;
    if (data.length < 1000) break;
  }
  const dict = mergeDictionaries(bundled(lang), fresh);
  cache.set(lang, { at: Date.now(), dict });
  return dict;
}

/** A newly approved translation shows at once on this server. */
export function forgetDictionary(lang: LangCode) {
  cache.delete(lang);
}

/** The translator for a server component or route. */
export async function getT(supabase: CriticomClient, userId?: string) {
  const lang = await currentLang(supabase, userId);
  const dict = await dictionaryFor(supabase, lang);
  return { lang, dict, ...makeTranslator(dict) };
}
