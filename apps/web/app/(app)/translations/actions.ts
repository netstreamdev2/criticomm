'use server';

import { revalidatePath } from 'next/cache';
import { isLang } from '@criticom/db/i18n';
import { getServerSupabase } from '@/lib/supabase';
import { forgetDictionary } from '@/lib/i18n';

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export type SavedTranslation = { key: string; text: string; status: 'draft' | 'approved'; approvedBy: string | null };

/** Save one translation; a translator for the language may approve it (save_translation, 0078). */
export async function saveTranslationAction(key: string, lang: string, text: string, approve: boolean): Promise<Result<SavedTranslation>> {
  if (!isLang(lang) || lang === 'en') return { ok: false, error: 'That language is not offered.' };
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc('save_translation', { p_key: key, p_lang: lang, p_text: text, p_approve: approve });
  if (error) return { ok: false, error: error.message };
  // An approval (or one taken back) shows on the screens at once.
  forgetDictionary(lang);
  revalidatePath('/', 'layout');
  const row = data as { key: string; text: string; status: 'draft' | 'approved'; approved_by_name: string | null };
  return { ok: true, value: { key: row.key, text: row.text, status: row.status, approvedBy: row.approved_by_name } };
}

/** Who translates which language (set_translator_langs, 0078). */
export async function setTranslatorLangsAction(userId: string, langs: string[]): Promise<Result<string[]>> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc('set_translator_langs', { p_user: userId, p_langs: langs.filter((l) => isLang(l) && l !== 'en') });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/translations');
  return { ok: true, value: (data as { translator_langs: string[] }).translator_langs };
}
