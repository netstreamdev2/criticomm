import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  bestLang, english, isLang, makeTranslator, mergeDictionaries,
  type Dictionary, type LangCode, type Translate, type TranslateIn,
} from '@criticom/db/i18n';
import { bundled } from '@criticom/db/i18n/locales';
import { useAuth } from './auth';
import { getSupabase } from './supabase';
import { setTranslator } from './translator';

/**
 * The app's language (docs/23, item 1). The person's choice, kept on the
 * phone and on their profile; until they choose, the phone's own language
 * when we have it, else English.
 *
 * The approved translations travel inside the app, so a language works with
 * no signal. Those approved since are fetched when online and kept on the
 * phone. What people type (reports, notes) is never translated.
 */

type Value = { lang: LangCode; t: Translate; tc: TranslateIn; setLang: (lang: LangCode) => Promise<void> };
const I18n = createContext<Value>({ lang: 'en', t: english.t, tc: english.tc, setLang: async () => {} });

const choiceKey = (userId: string | null) => `criticom:lang:${userId ?? 'signed-out'}`;
const cacheKey = (lang: LangCode) => `criticom:i18n:${lang}`;

/** The phone's own language, as the operating system reports it. */
function deviceLang(): LangCode {
  try {
    return bestLang([Intl.DateTimeFormat().resolvedOptions().locale]);
  } catch {
    return 'en';
  }
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [lang, setLangState] = useState<LangCode>(deviceLang);
  const [fresh, setFresh] = useState<Dictionary>({});

  // The person's own choice: on this phone, else on their profile.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const saved = await AsyncStorage.getItem(choiceKey(userId)).catch(() => null);
      if (cancelled) return;
      if (isLang(saved)) { setLangState(saved); return; }
      if (!userId) return;
      const { data } = await getSupabase().from('profiles').select('language').eq('id', userId).maybeSingle();
      const chosen = (data as { language?: string | null } | null)?.language;
      if (!cancelled && isLang(chosen)) setLangState(chosen);
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [userId]);

  // Translations approved since this app was built: kept on the phone, renewed when online.
  useEffect(() => {
    let cancelled = false;
    setFresh({});
    if (lang === 'en') return;
    void (async () => {
      const kept = await AsyncStorage.getItem(cacheKey(lang)).catch(() => null);
      if (kept && !cancelled) {
        try { setFresh(JSON.parse(kept) as Dictionary); } catch { /* a damaged copy is refetched */ }
      }
      if (!userId) return;
      const next: Record<string, string> = {};
      for (let from = 0; ; from += 1000) {
        const { data, error } = await getSupabase().from('translations').select('key, text')
          .eq('lang', lang).eq('status', 'approved').order('key').range(from, from + 999);
        if (error || !data) return;
        for (const r of data as Array<{ key: string; text: string }>) next[r.key] = r.text;
        if (data.length < 1000) break;
      }
      if (cancelled) return;
      setFresh(next);
      await AsyncStorage.setItem(cacheKey(lang), JSON.stringify(next)).catch(() => {});
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [lang, userId]);

  const setLang = useCallback(async (next: LangCode) => {
    setLangState(next);
    await AsyncStorage.setItem(choiceKey(userId), next).catch(() => {});
    // On the profile too, so the console follows; with no signal, the phone remembers it.
    if (userId) await getSupabase().rpc('set_my_language', { p_lang: next }).then(() => {}, () => {});
  }, [userId]);

  const value = useMemo(() => {
    const dict = mergeDictionaries(bundled(lang), fresh);
    const translator = makeTranslator(dict);
    // Wording made outside a screen (lib/translator.ts) follows too.
    setTranslator(translator);
    return { lang, setLang, ...translator };
  }, [lang, fresh, setLang]);

  return <I18n.Provider value={value}>{children}</I18n.Provider>;
}

export function useT(): Value {
  return useContext(I18n);
}
