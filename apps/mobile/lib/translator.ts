import { english, type Translate, type TranslateIn } from '@criticom/db/i18n';

/**
 * The translator for wording made outside a screen: a time ago, a confirm
 * dialog, a notification. The I18nProvider (lib/i18n.tsx) keeps it on the
 * person's language; screens use useT() instead, so they redraw when the
 * language changes. No app dependencies, so the rules that use it can be
 * tested (they get English).
 */
let current: { t: Translate; tc: TranslateIn } = english;

export function setTranslator(next: { t: Translate; tc: TranslateIn }) {
  current = next;
}

/** A sentence in the person's language now. */
export const tNow: Translate = (text, vars) => current.t(text, vars);
