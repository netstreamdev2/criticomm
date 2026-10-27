'use client';

import { useState } from 'react';
import { Send } from 'lucide-react';
import { CritiMascot } from '@/components/criti/mascot';
import { useT } from '@/components/i18n';

/**
 * "Ask Criti how to…": a question about the Disaster screens, answered from
 * Criti's guide to them. Criti is not sent any incident or person.
 */
export function AskCriti({ page, className }: { page?: string; className?: string }) {
  const { t } = useT();
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ask = async () => {
    if (q.trim().length < 3 || busy) return;
    setBusy(true);
    setAnswer(null);
    try {
      const res = await fetch('/api/criti/help', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q, page: page ?? null }),
      });
      const j = (await res.json().catch(() => ({}))) as { answer?: string | null; configured?: boolean; error?: string };
      setAnswer(j.answer ?? (j.configured === false
        ? t('Criti is switched off. Each page’s "How this page works" says what to do.')
        : t('Criti could not answer just now. Each page’s "How this page works" says what to do.')));
    } catch {
      setAnswer(t('Criti could not answer just now. Each page’s "How this page works" says what to do.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={className}>
      <form onSubmit={(e) => { e.preventDefault(); void ask(); }} className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={300} placeholder={t('Ask Criti how to… (for example: how do I send a warning to the councillors?)')}
          aria-label={t('Ask Criti how to do something')} className="h-11 min-w-0 flex-1 rounded-md border border-border bg-bg-soft px-3 text-[15px]" />
        <button type="submit" disabled={busy || q.trim().length < 3} aria-label={t('Ask')}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground disabled:opacity-50">
          <Send className="h-4 w-4" aria-hidden />
        </button>
      </form>
      {busy ? <p className="mt-2 text-sm text-muted-foreground">{t('Criti is thinking…')}</p> : null}
      {answer ? (
        <div className="mt-3 flex gap-3 rounded-lg border border-accent/30 bg-accent/5 p-3">
          <CritiMascot className="h-8 w-8 shrink-0" />
          <p className="whitespace-pre-line text-[15px] leading-relaxed">{answer}</p>
        </div>
      ) : null}
    </div>
  );
}
