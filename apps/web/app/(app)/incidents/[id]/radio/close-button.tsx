'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2 } from 'lucide-react';
import { dispositionsFor } from '@criticom/db';
import { closeFromDeskAction } from './actions';
import { useT } from '@/components/i18n';

/**
 * Close a department's part on scene for its crew (0075), from the
 * departments card: first how the call ended, from that department's list
 * (0098), then Close. Dispatch and command are told.
 */
export function CloseOnSceneButton({ incidentId, silo, label }: { incidentId: string; silo: string; label: string }) {
  const { t } = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [asking, setAsking] = useState(false);
  const [outcome, setOutcome] = useState('');
  const [error, setError] = useState<string | null>(null);
  const options = dispositionsFor(silo);

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => { setAsking(true); setError(null); }}
        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-severity-low px-3 text-xs font-semibold text-white"
      >
        <Check className="h-3.5 w-3.5" /> {t('Close on scene')}
      </button>
    );
  }

  return (
    <span className="inline-flex flex-col gap-1.5 rounded-md border border-border bg-bg-soft p-2">
      <label className="text-xs font-semibold">
        {t('How did it end for {label}?', { label })}
        <select
          value={outcome} onChange={(e) => setOutcome(e.target.value)}
          className="mt-1 block h-8 w-64 max-w-full rounded-md border border-border bg-bg-card px-2 text-sm"
        >
          <option value="">{t('Choose…')}</option>
          {options.map((o) => <option key={o.code} value={o.code}>{t(o.label)}</option>)}
        </select>
      </label>
      <span className="flex gap-2">
        <button
          type="button"
          disabled={pending || !outcome}
          onClick={() => start(async () => {
            setError(null);
            const res = await closeFromDeskAction({ incidentId, silo, disposition: outcome });
            if (!res.ok) { setError(res.error); return; }
            setAsking(false);
            router.refresh();
          })}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-severity-low px-3 text-xs font-semibold text-white disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} {t('Close on scene')}
        </button>
        <button type="button" onClick={() => setAsking(false)} disabled={pending} className="h-8 rounded-md border border-border px-3 text-xs font-semibold hover:bg-muted">
          {t('Cancel')}
        </button>
      </span>
      {error ? <span role="alert" className="text-xs text-severity-critical-ink">{error}</span> : null}
    </span>
  );
}
