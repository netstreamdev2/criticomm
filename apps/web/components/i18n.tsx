'use client';

import { createContext, useContext, useMemo } from 'react';
import { english, makeTranslator, type Dictionary, type LangCode, type Translate, type TranslateIn } from '@criticom/db/i18n';

/**
 * The console's translator for client components: useT() gives t('…') and
 * tc(context, '…') in the person's language (lib/i18n.ts on the server).
 */
type Value = { lang: LangCode; t: Translate; tc: TranslateIn };
const I18n = createContext<Value>({ lang: 'en', t: english.t, tc: english.tc });

export function I18nProvider({ lang, dict, children }: { lang: LangCode; dict: Dictionary; children: React.ReactNode }) {
  const value = useMemo(() => ({ lang, ...makeTranslator(dict) }), [lang, dict]);
  return <I18n.Provider value={value}>{children}</I18n.Provider>;
}

export function useT(): Value {
  return useContext(I18n);
}

/**
 * A sentence in a component that runs on the server and in the browser
 * alike, where neither the hook nor the server translator fits: the
 * sentence in the s prop, any {name} in it as a prop of its own.
 */
export function T({ s, ...vars }: { s: string } & Record<string, string | number | null | undefined>) {
  const { t } = useT();
  return <>{t(s, vars)}</>;
}
