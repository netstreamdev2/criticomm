'use client';

import { useMemo, useState, useTransition } from 'react';
import { CheckCircle2, Download, Loader2, Search } from 'lucide-react';
import { placeholders, type LangCode } from '@criticom/db/i18n';
import { useT } from '@/components/i18n';
import { CritiMascot } from '@/components/criti/mascot';
import { cn } from '@/lib/utils';
import { saveTranslationAction } from './actions';

export type EditorRow = {
  key: string;
  english: string;
  context: string | null;
  where: string[];
  uses: number;
  glossary: string | null;
  text: string;
  status: 'draft' | 'approved' | null;
  criti: boolean;
  approvedBy: string | null;
};

type Filter = 'todo' | 'draft' | 'approved' | 'all';
const PAGE = 40;

/**
 * Every sentence for one language: the English, where it is used, and the
 * translation. Glossary words come first. A translator for the language
 * approves; an administrator only drafts.
 */
export function TranslationsEditor({ lang, rows, canApprove }: { lang: LangCode; rows: EditorRow[]; canApprove: boolean }) {
  const { t } = useT();
  const [state, setState] = useState(rows);
  const [filter, setFilter] = useState<Filter>('todo');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [drafting, setDrafting] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const counts = useMemo(() => ({
    todo: state.filter((r) => r.status !== 'approved').length,
    draft: state.filter((r) => r.status === 'draft').length,
    approved: state.filter((r) => r.status === 'approved').length,
    all: state.length,
  }), [state]);

  const shown = useMemo(() => {
    const words = q.trim().toLowerCase();
    return state.filter((r) => {
      if (filter === 'todo' && r.status === 'approved') return false;
      if (filter === 'draft' && r.status !== 'draft') return false;
      if (filter === 'approved' && r.status !== 'approved') return false;
      return !words || r.english.toLowerCase().includes(words) || r.text.toLowerCase().includes(words);
    });
  }, [state, filter, q]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const slice = shown.slice(page * PAGE, page * PAGE + PAGE);

  const update = (key: string, patch: Partial<EditorRow>) => setState((cur) => cur.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const draftWithCriti = async () => {
    setDrafting(true);
    setNote(null);
    try {
      const res = await fetch('/api/i18n/draft', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang }),
      });
      const data = (await res.json().catch(() => ({}))) as { drafts?: Record<string, string>; saved?: number; left?: number; error?: string };
      if (!res.ok || data.error) { setNote(data.error ?? t('Criti could not draft just now.')); return; }
      setState((cur) => cur.map((r) => (data.drafts?.[r.key] && r.status === null ? { ...r, text: data.drafts[r.key]!, status: 'draft', criti: true } : r)));
      setNote(t('Criti drafted {saved}. {left} still to draft.', { saved: data.saved ?? 0, left: data.left ?? 0 }));
    } catch {
      setNote(t('Criti could not draft just now.'));
    } finally {
      setDrafting(false);
    }
  };

  return (
    <section className="space-y-3 rounded-xl border border-border bg-bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        {(['todo', 'draft', 'approved', 'all'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => { setFilter(f); setPage(0); }}
            className={cn('rounded-full border px-3 py-1 text-xs font-semibold',
              filter === f ? 'border-primary bg-primary/15 text-fg' : 'border-border text-muted-foreground hover:text-fg')}
          >
            {f === 'todo' ? t('Still to approve') : f === 'draft' ? t('Drafts') : f === 'approved' ? t('Approved') : t('All')}
            <span className="ml-1 tabular-nums text-muted-foreground">{counts[f]}</span>
          </button>
        ))}
        <label className="relative ml-auto">
          <span className="sr-only">{t('Search')}</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(0); }}
            placeholder={t('Search')}
            className="h-8 w-56 rounded-md border border-border bg-bg-soft pl-8 pr-2 text-xs"
          />
        </label>
        <button
          type="button"
          onClick={() => void draftWithCriti()}
          disabled={drafting}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-accent/50 px-3 text-xs font-semibold text-accent hover:bg-accent/10 disabled:opacity-60"
        >
          {drafting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CritiMascot className="h-4 w-4" />} {t('Draft with Criti')}
        </button>
        <a
          href={`/api/i18n/export?lang=${lang}`}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-semibold hover:bg-muted"
        >
          <Download className="h-3.5 w-3.5" /> {t('Download approved file')}
        </a>
      </div>
      {note ? <p className="text-xs text-muted-foreground" aria-live="polite">{note}</p> : null}
      {!canApprove ? (
        <p className="text-xs text-muted-foreground">{t('Only a translator for this language approves. You can save drafts.')}</p>
      ) : null}

      <ul className="divide-y divide-border">
        {/* A new draft or a saved translation starts the row afresh; what is being typed is kept. */}
        {slice.map((r) => <Row key={`${r.key}|${r.status}|${r.text}`} lang={lang} row={r} canApprove={canApprove} onSaved={update} />)}
        {slice.length === 0 ? <li className="py-8 text-center text-sm text-muted-foreground">{t('Nothing here.')}</li> : null}
      </ul>

      {pages > 1 ? (
        <div className="flex items-center justify-end gap-2 text-xs">
          <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="rounded border border-border px-2 py-1 disabled:opacity-40">‹</button>
          <span className="tabular-nums text-muted-foreground">{page + 1} / {pages}</span>
          <button type="button" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} className="rounded border border-border px-2 py-1 disabled:opacity-40">›</button>
        </div>
      ) : null}
    </section>
  );
}

function Row({ lang, row, canApprove, onSaved }: {
  lang: LangCode; row: EditorRow; canApprove: boolean; onSaved: (key: string, patch: Partial<EditorRow>) => void;
}) {
  const { t } = useT();
  const [text, setText] = useState(row.text);
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const missing = placeholders(row.english).filter((p) => text.trim() && !text.includes(`{${p}}`));

  const save = (approve: boolean) => {
    setError(null);
    start(async () => {
      const r = await saveTranslationAction(row.key, lang, text, approve);
      if (!r.ok) { setError(r.error); return; }
      setText(r.value.text);
      onSaved(row.key, { text: r.value.text, status: r.value.status, criti: false, approvedBy: r.value.approvedBy });
    });
  };

  return (
    <li className="grid gap-2 py-3 md:grid-cols-2">
      <div className="min-w-0 text-sm">
        <p className="whitespace-pre-wrap font-medium">{row.english}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {row.context ? <span className="mr-1 rounded bg-muted px-1">{row.context}</span> : null}
          {row.glossary ? <span className="mr-1 rounded bg-accent/15 px-1 font-semibold text-accent">{t('Glossary')}: {row.glossary}</span> : null}
          {row.where.join(' · ')}{row.uses > row.where.length ? ` +${row.uses - row.where.length}` : ''}
        </p>
      </div>
      <div className="min-w-0 space-y-1.5">
        <textarea
          rows={Math.min(4, Math.max(1, Math.ceil(row.english.length / 60)))}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label={t('Translation')}
          className="w-full rounded-md border border-border bg-bg-soft px-2.5 py-1.5 text-sm"
        />
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          {row.status === 'approved'
            ? <span className="inline-flex items-center gap-1 font-semibold text-severity-low-ink"><CheckCircle2 className="h-3 w-3" /> {t('Approved')}{row.approvedBy ? ` · ${row.approvedBy}` : ''}</span>
            : row.status === 'draft'
              ? <span className="text-muted-foreground">{row.criti ? t('Draft by Criti') : t('Draft')}</span>
              : <span className="text-muted-foreground">{t('Not translated yet')}</span>}
          {missing.length ? <span className="text-severity-critical-ink">{t('Keep {names}', { names: missing.map((p) => `{${p}}`).join(' ') })}</span> : null}
          <span className="ml-auto flex gap-1.5">
            <button
              type="button"
              disabled={busy || !text.trim() || missing.length > 0}
              onClick={() => save(false)}
              className="rounded border border-border px-2 py-1 font-semibold hover:bg-muted disabled:opacity-40"
            >
              {t('Save draft')}
            </button>
            {canApprove ? (
              <button
                type="button"
                disabled={busy || !text.trim() || missing.length > 0}
                onClick={() => save(true)}
                className="rounded bg-severity-low px-2 py-1 font-semibold disabled:opacity-40"
              >
                {busy ? <Loader2 className="inline h-3 w-3 animate-spin" /> : null} {t('Approve')}
              </button>
            ) : null}
          </span>
        </div>
        {error ? <p className="text-[11px] text-severity-critical-ink">{error}</p> : null}
      </div>
    </li>
  );
}
