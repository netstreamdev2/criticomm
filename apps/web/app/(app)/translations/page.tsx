import type { Metadata } from 'next';
import Link from 'next/link';
import { TARGET_LANGS, isLang, languageName, type LangCode } from '@criticom/db/i18n';
import { GLOSSARY } from '@criticom/db/i18n/glossary';
import { SOURCE } from '@criticom/db/i18n/source';
import { getSession } from '@/lib/session';
import { getT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { TranslationsEditor, type EditorRow } from './translations-editor';
import { TranslatorsCard, type Person } from './translators-card';

export const metadata: Metadata = { title: 'Translations · HikTech' };
export const dynamic = 'force-dynamic';

/**
 * Translations: every sentence the apps show, in English beside its
 * translation. Criti drafts them; a translator for the language checks and
 * approves each one. Only approved sentences are shown on the screens.
 * Translators and administrators only (0078).
 */
export default async function TranslationsPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { supabase, userId, role } = await getSession();
  const { t } = await getT(supabase, userId);
  const admin = role === 'SuperAdmin' || role === 'SystemAdmin';
  const { data: me } = await supabase.from('profiles').select('translator_langs').eq('id', userId).maybeSingle();
  const mine = ((me as { translator_langs?: string[] } | null)?.translator_langs ?? []).filter(isLang) as LangCode[];

  if (!admin && mine.length === 0) {
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-border bg-bg-card p-6 text-sm">
        <h1 className="text-lg font-bold">{t('Translations')}</h1>
        <p className="mt-2 text-muted-foreground">{t('Only translators and administrators work on translations.')}</p>
      </div>
    );
  }

  const langs = admin ? TARGET_LANGS : mine;
  const wanted = (await searchParams).lang;
  const lang = (isLang(wanted) && langs.includes(wanted) ? wanted : langs[0]!) as LangCode;

  const rows: Array<{ key: string; text: string; status: 'draft' | 'approved'; drafted_by: string; approved_by_name: string | null }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('translations')
      .select('key, text, status, drafted_by, approved_by_name').eq('lang', lang).order('key').range(from, from + 999);
    if (error || !data) break;
    rows.push(...(data as typeof rows));
    if (data.length < 1000) break;
  }
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const glossary = new Map(GLOSSARY.map((g) => [g.text, g.note]));
  const entries: EditorRow[] = SOURCE.map((e) => {
    const tr = byKey.get(e.key);
    return {
      key: e.key, english: e.text, context: e.context, where: e.where.slice(0, 3), uses: e.where.length,
      glossary: glossary.get(e.key) ?? null,
      text: tr?.text ?? '', status: tr ? tr.status : null, criti: tr?.drafted_by === 'criti', approvedBy: tr?.approved_by_name ?? null,
    };
  }).sort((a, b) => Number(!a.glossary) - Number(!b.glossary));

  let people: Person[] = [];
  if (admin) {
    const { data } = await supabase.from('profiles').select('id, full_name, role, translator_langs').order('full_name').limit(500);
    people = ((data ?? []) as Array<{ id: string; full_name: string | null; role: string; translator_langs?: string[] }>)
      .map((p) => ({ id: p.id, name: p.full_name ?? '—', role: p.role, langs: p.translator_langs ?? [] }));
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">{t('Translations')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('Only approved translations are shown on the screens. Everything else shows in English.')}
        </p>
      </header>

      <nav className="flex flex-wrap gap-1.5" aria-label={t('Language')}>
        {langs.map((l) => (
          <Link
            key={l}
            href={`/translations?lang=${l}`}
            className={cn('rounded-full border px-3 py-1 text-xs font-semibold',
              l === lang ? 'border-primary bg-primary/15 text-fg' : 'border-border text-muted-foreground hover:text-fg')}
          >
            {languageName(l)}
          </Link>
        ))}
      </nav>

      <TranslationsEditor lang={lang} rows={entries} canApprove={mine.includes(lang)} />

      {admin ? <TranslatorsCard people={people} /> : null}
    </div>
  );
}
