'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, Lightbulb } from 'lucide-react';
import { useT } from '@/components/i18n';
import { cn } from '@/lib/utils';

/**
 * "How this page works": a few numbered steps under a duty office title.
 * Open the first time someone opens the page; "Got it" folds it to one line,
 * remembered in this browser, and one click opens it again.
 */
export function PageGuide({ id, steps }: { id: string; steps: string[] }) {
  const { t } = useT();
  const key = `criticom.guide.${id}`;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try { setOpen(localStorage.getItem(key) !== 'seen'); } catch { setOpen(true); }
  }, [key]);

  const fold = () => {
    setOpen(false);
    try { localStorage.setItem(key, 'seen'); } catch { /* private window: folds until reload */ }
  };

  if (steps.length === 0) return null;

  return (
    <section className="no-print rounded-lg border border-primary/30 bg-bg-card shadow-sm">
      <button
        type="button"
        onClick={() => (open ? fold() : setOpen(true))}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-semibold"
      >
        <Lightbulb className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        {t('How this page works')}
        <ChevronDown className={cn('ml-auto h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open ? (
        <div className="border-t border-border px-4 pb-3 pt-2.5">
          <ol className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {steps.map((s, i) => (
              <li key={s} className="flex gap-2.5 text-sm">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">{i + 1}</span>
                <span className="pt-0.5 text-fg/90">{s}</span>
              </li>
            ))}
          </ol>
          <div className="mt-3 flex justify-end">
            <button type="button" onClick={fold} className="h-8 rounded-md border border-border px-3 text-xs font-semibold hover:bg-muted">
              {t('Got it')}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
