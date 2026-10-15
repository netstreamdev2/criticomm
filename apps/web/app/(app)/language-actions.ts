'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { isLang } from '@criticom/db/i18n';
import { getServerSupabase } from '@/lib/supabase';
import { LANG_COOKIE, langCookieValue } from '@/lib/i18n';

/** The language the signed-in person sees the console in: kept on their profile, and here. */
export async function setLanguage(lang: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isLang(lang)) return { ok: false, error: 'That language is not offered.' };
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Sign in again.' };
  const { error } = await supabase.rpc('set_my_language', { p_lang: lang });
  // Before 0078 there is nowhere to keep it: this browser remembers it.
  if (error && error.code !== 'PGRST202') return { ok: false, error: error.message };
  (await cookies()).set(LANG_COOKIE, langCookieValue(user.id, lang), { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax', httpOnly: true });
  revalidatePath('/', 'layout');
  return { ok: true };
}
