'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Languages, Loader2 } from 'lucide-react';
import { LANGUAGES, type LangCode } from '@criticom/db/i18n';
import { setLanguage } from '@/app/(app)/language-actions';
import { useT } from '@/components/i18n';
import { cn } from '@/lib/utils';

/**
 * The console's language, in the top bar. Each language shows how much of it
 * is translated and approved so far; the rest shows in English.
 */
export function LanguageMenu({ canTranslate = false }: { canTranslate?: boolean }) {
  const { t, lang } = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ total: number; approved: Record<string, number> } | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    if (!progress) {
      void fetch('/api/i18n/progress').then((r) => (r.ok ? r.json() : null)).then((p) => setProgress(p)).catch(() => {});
    }
    return () => window.removeEventListener('keydown', onKey);
  }, [open, progress]);

  const choose = (code: LangCode) => {
    setError(null);
    start(async () => {
      const r = await setLanguage(code);
      if (!r.ok) { setError(r.error); return; }
      setOpen(false);
      router.refresh();
    });
  };

  const share = (code: LangCode) => {
    if (code === 'en' || !progress || !progress.total) return null;
    return Math.floor(((progress.approved[code] ?? 0) / progress.total) * 100);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t('Language')}
        aria-expanded={open}
        title={t('Language')}
        className="inline-flex h-9 items-center gap-1 rounded-md px-2 text-xs font-semibold uppercase text-muted-foreground transition-colors hover:bg-muted hover:text-fg"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Languages className="h-4 w-4" />}
        <span className="hidden sm:inline">{lang}</span>
      </button>

      {open && (
        <>
          <button type="button" aria-label={t('Close')} className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-xl border border-border bg-bg-card shadow-2xl">
            <p className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('Language')}
            </p>
            <div className="max-h-80 overflow-y-auto p-1.5">
              {LANGUAGES.map((l) => {
                const selected = l.code === lang;
                const pct = share(l.code);
                return (
                  <button
                    key={l.code}
                    type="button"
                    disabled={busy}
                    onClick={() => choose(l.code)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors disabled:opacity-60',
                      selected ? 'bg-primary/15 text-fg' : 'text-fg/80 hover:bg-muted',
                    )}
                  >
                    <span className="flex-1">{l.name}</span>
                    {pct !== null ? <span className="text-[11px] tabular-nums text-muted-foreground">{t('{pct}% translated', { pct })}</span> : null}
                    {selected ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
                  </button>
                );
              })}
            </div>
            {error ? <p className="border-t border-border px-3 py-2 text-xs text-severity-critical-ink">{error}</p> : null}
            {canTranslate ? (
              <Link href="/translations" onClick={() => setOpen(false)} className="block border-t border-border px-3 py-2 text-xs font-semibold text-accent hover:underline">
                {t('Translations')}
              </Link>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
