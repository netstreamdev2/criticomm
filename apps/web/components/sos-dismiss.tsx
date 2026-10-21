'use client';

import { useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { ShieldOff, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/components/i18n';
import { dismissSosAction } from './sos-dismiss-actions';

/**
 * "Dismiss SOS": for an SOS pressed by mistake. A reason every time, picked
 * with one tap; then it leaves every screen and alert, Criti knows, and it
 * stays on the record (0093). The same button on the SOS pop-up, the bar,
 * the banner, the map, Criti's tile and the call itself.
 *
 * Shown only to those who may (canDismissSos); the database checks again.
 */

const REASONS = ['Pressed by mistake', 'Officer is safe', 'Test'] as const;

export function DismissSos({ incidentId, label, tone = 'plain', className, onDone }: {
  incidentId: string;
  /** Whose SOS, for the confirmation ("Const. Khumalo's SOS"). */
  label?: string;
  /** On a red SOS background, or on an ordinary card. */
  tone?: 'onRed' | 'plain' | 'icon';
  className?: string;
  onDone?: () => void;
}) {
  const { t } = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [other, setOther] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const chosen = reason === 'Other' ? other.trim() : reason;

  const confirm = () => {
    if (!chosen || chosen.length < 3) return;
    setError(null);
    start(async () => {
      const r = await dismissSosAction(incidentId, chosen);
      if ('error' in r) { setError(r.error); return; }
      setOpen(false);
      onDone?.();
      router.refresh();
    });
  };

  const trigger = tone === 'icon' ? (
    <button
      type="button" onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      aria-label={t('Dismiss SOS')} title={t('Dismiss SOS')}
      className={cn('rounded-md p-1.5 hover:bg-black/25', className)}
    >
      <ShieldOff className="h-4 w-4" />
    </button>
  ) : (
    <button
      type="button" onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 text-sm font-bold',
        tone === 'onRed' ? 'h-10 bg-white/90 text-severity-critical hover:bg-white' : 'h-10 border border-severity-critical/60 text-severity-critical-ink hover:bg-severity-critical/10',
        className,
      )}
    >
      <ShieldOff className="h-4 w-4" /> {t('Dismiss SOS')}
    </button>
  );

  return (
    <>
      {trigger}
      {open && typeof document !== 'undefined' ? createPortal(
        <div
          role="dialog" aria-modal="true" aria-labelledby="dismiss-sos-title"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4"
        >
          <div className="w-full max-w-md rounded-2xl border border-border bg-bg-card p-5 text-fg shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <h2 id="dismiss-sos-title" className="text-lg font-bold">
                {label ? t('Dismiss {label}?', { label }) : t('Dismiss this SOS?')}
              </h2>
              <button type="button" onClick={() => setOpen(false)} aria-label={t('Close')} className="rounded-md p-1 hover:bg-muted"><X className="h-5 w-5" /></button>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{t('Only if there is no emergency. Why?')}</p>

            <div className="mt-4 grid gap-2">
              {[...REASONS, 'Other' as const].map((r) => (
                <button
                  key={r} type="button" onClick={() => setReason(r)} aria-pressed={reason === r}
                  className={cn('h-11 rounded-lg border px-4 text-left text-base font-semibold',
                    reason === r ? 'border-severity-critical bg-severity-critical/10 text-severity-critical-ink' : 'border-border hover:bg-muted')}
                >
                  {t(r)}
                </button>
              ))}
              {reason === 'Other' ? (
                <input
                  value={other} maxLength={300} onChange={(e) => setOther(e.target.value)}
                  placeholder={t('Say why')}
                  className="h-11 rounded-lg border border-border bg-bg-soft px-3 text-base"
                />
              ) : null}
            </div>

            {error ? <p role="alert" className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p> : null}

            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setOpen(false)} className="h-11 flex-1 rounded-lg border border-border font-semibold hover:bg-muted">
                {t('Cancel')}
              </button>
              <button
                type="button" onClick={confirm} disabled={pending || !chosen || chosen.length < 3}
                className="h-11 flex-1 rounded-lg bg-severity-critical font-bold text-white disabled:opacity-50"
              >
                {pending ? t('Dismissing…') : t('Dismiss SOS')}
              </button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{t('It stays on the record with your name and the reason.')}</p>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
