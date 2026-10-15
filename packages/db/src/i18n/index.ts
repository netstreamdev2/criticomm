/**
 * Our own translator: every screen's wording in South Africa's official
 * written languages, from translations that people have checked.
 *
 * A sentence's English is its name: t('Send to dispatch') looks up the
 * approved isiZulu for "Send to dispatch". Anything not approved yet shows in
 * English, never as an unchecked draft. A word that means two things gets a
 * context: tc('button', 'Close'). {name} in a sentence is filled in, and must
 * stay in every translation.
 *
 * The approved translations ship inside both apps (locales/), so the phone
 * works offline; the console and the phone also pick up newly approved ones
 * from the database. Translators draft and approve them under Admin →
 * Translations. What people type (descriptions, notes, reports) is never
 * translated: it is the record.
 *
 * No dependencies, so it can be tested.
 */

export type LangCode = 'en' | 'zu' | 'xh' | 'af' | 'nso' | 'tn' | 'st' | 'ts' | 'ss' | 've' | 'nr';

/** The official written languages. South African Sign Language has no written form: see docs/23. */
export const LANGUAGES: ReadonlyArray<{ code: LangCode; name: string }> = [
  { code: 'en', name: 'English' },
  { code: 'zu', name: 'isiZulu' },
  { code: 'xh', name: 'isiXhosa' },
  { code: 'af', name: 'Afrikaans' },
  { code: 'nso', name: 'Sepedi' },
  { code: 'tn', name: 'Setswana' },
  { code: 'st', name: 'Sesotho' },
  { code: 'ts', name: 'Xitsonga' },
  { code: 'ss', name: 'siSwati' },
  { code: 've', name: 'Tshivenḓa' },
  { code: 'nr', name: 'isiNdebele' },
];
export const DEFAULT_LANG: LangCode = 'en';
/** The languages translated into: every one but English. */
export const TARGET_LANGS: readonly LangCode[] = LANGUAGES.map((l) => l.code).filter((c) => c !== 'en');

export function isLang(x: unknown): x is LangCode {
  return typeof x === 'string' && LANGUAGES.some((l) => l.code === x);
}

export function languageName(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.name ?? code;
}

/** A sentence to translate, and where the apps use it (source.ts). */
export type SourceEntry = { key: string; text: string; context: string | null; where: string[] };

/** Approved translations: a sentence's key to its translation. */
export type Dictionary = Readonly<Record<string, string>>;
/** Values for a sentence's {names}; an empty one shows as nothing, as React shows it. */
export type Vars = Readonly<Record<string, string | number | null | undefined>>;
export type Translate = (text: string, vars?: Vars) => string;
export type TranslateIn = (context: string, text: string, vars?: Vars) => string;

const CONTEXT_MARK = '\u0004';

/** The key a sentence is kept under: its English, with its context if it has one. */
export function keyOf(text: string, context?: string | null): string {
  return context ? `${context}${CONTEXT_MARK}${text}` : text;
}

/** A key read back: its context and its English. */
export function splitKey(key: string): { context: string | null; text: string } {
  const at = key.indexOf(CONTEXT_MARK);
  return at < 0 ? { context: null, text: key } : { context: key.slice(0, at), text: key.slice(at + 1) };
}

const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;

/** The {names} a sentence carries, each once, in order. */
export function placeholders(s: string): string[] {
  return [...new Set([...s.matchAll(PLACEHOLDER)].map((m) => m[1]!))];
}

export function interpolate(s: string, vars?: Vars): string {
  if (!vars) return s;
  return s.replace(PLACEHOLDER, (whole, name: string) => (name in vars ? String(vars[name] ?? '') : whole));
}

/**
 * The translator for one language. A translation that lost one of its
 * {names} is not used: the English is safer than a sentence missing a number.
 */
export function makeTranslator(dict: Dictionary | null | undefined): { t: Translate; tc: TranslateIn } {
  const look = (key: string, english: string) => {
    const found = dict?.[key];
    if (!found) return english;
    const want = placeholders(english);
    return want.every((p) => found.includes(`{${p}}`)) ? found : english;
  };
  const t: Translate = (text, vars) => interpolate(look(text, text), vars);
  const tc: TranslateIn = (context, text, vars) => interpolate(look(keyOf(text, context), text), vars);
  return { t, tc };
}

/** English: the sentence as written. */
export const english = makeTranslator(null);

/**
 * Marks wording kept outside a screen (a list of step names, say) for the
 * translators; it returns the English unchanged. Translate it where it is
 * shown: t(STEPS[i]).
 */
export const tx = <S extends string>(text: S): S => text;

/**
 * The best language for a list of preferred ones (a phone's "zu-ZA", "en-ZA"):
 * the first we have, else English.
 */
export function bestLang(preferred: readonly string[]): LangCode {
  for (const p of preferred) {
    const base = p.toLowerCase().split(/[-_]/)[0]!;
    if (isLang(base)) return base;
  }
  return DEFAULT_LANG;
}

/** Merge approved translations: later ones win (the database over the app's own copy). */
export function mergeDictionaries(...dicts: Array<Dictionary | null | undefined>): Dictionary {
  return Object.assign({}, ...dicts.filter(Boolean));
}
