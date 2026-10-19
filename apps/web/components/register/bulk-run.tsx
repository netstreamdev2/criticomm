'use client';

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Copy, Printer, X } from 'lucide-react';
import type { BulkItemResult } from '@/app/(app)/admin/invitations/actions';
import { SlipBatch } from '@/app/(app)/admin/invitations/slip';
import type { ActivationSlip } from '@/lib/onboarding/server';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useT } from '@/components/i18n';

export type BulkItem = { key: string; name: string; detail: string };

type Run = (chunk: BulkItem[], reason: string) => Promise<{ ok: true; results: BulkItemResult[] } | { ok: false; error: string }>;

const CHUNK = 5;

/**
 * Doing one thing for many people (inviting a station, resending to everyone
 * who has not opened theirs): confirm, run a few at a time with progress,
 * then show exactly what happened to each. Printed codes come out together
 * at the end, ready for the shift briefing.
 */
export function BulkRunDialog({
  title, intro, items, confirmLabel, askReason, askHrConfirm, run, onClose,
}: {
  title: string;
  intro: React.ReactNode;
  items: BulkItem[];
  confirmLabel: string;
  /** Invitations carry a reason onto the permanent record. */
  askReason?: boolean;
  /** Bulk invitations go to addresses nobody checked one by one: they must come from HR. */
  askHrConfirm?: boolean;
  run: Run;
  onClose: () => void;
}) {
  const { t } = useT();
  const router = useRouter();
  const [phase, setPhase] = useState<'confirm' | 'running' | 'done'>('confirm');
  const [reason, setReason] = useState('');
  const [fromHr, setFromHr] = useState(false);
  const [results, setResults] = useState<BulkItemResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showSlips, setShowSlips] = useState(false);
  const stop = useRef(false);

  const ready = items.length > 0 && (!askReason || reason.trim().length >= 10) && (!askHrConfirm || fromHr);

  const start = async () => {
    setPhase('running');
    setError(null);
    stop.current = false;
    const all: BulkItemResult[] = [];
    for (let i = 0; i < items.length; i += CHUNK) {
      if (stop.current) break;
      const res = await run(items.slice(i, i + CHUNK), reason.trim()).catch((e: unknown) => ({ ok: false as const, error: (e as Error).message }));
      if (!res.ok) { setError(res.error); break; }
      all.push(...res.results);
      setResults([...all]);
    }
    setPhase('done');
  };

  const close = () => { onClose(); router.refresh(); };

  const count = (s: BulkItemResult['status']) => results.filter((r) => r.status === s).length;
  const slips = results.flatMap((r) => (r.outcome?.status === 'slip' ? [r.outcome.slip as ActivationSlip] : []));
  const links = results.flatMap((r) => (r.outcome?.status === 'link' ? [{ name: r.name, link: r.outcome.link }] : []));
  const problems = results.filter((r) => r.status === 'failed' || r.status === 'skipped');
  const done = results.length;
  const percent = items.length ? Math.round((done / items.length) * 100) : 0;

  if (showSlips && slips.length) return <SlipBatch slips={slips} onClose={() => setShowSlips(false)} />;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[8vh] backdrop-blur-sm"
      role="dialog" aria-modal="true" aria-labelledby="bulk-title">
      <div className="w-full max-w-2xl space-y-4 rounded-xl border border-border bg-bg-card p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <h2 id="bulk-title" className="text-lg font-semibold">{title}</h2>
          {phase !== 'running' ? (
            <button type="button" onClick={phase === 'done' ? close : onClose} aria-label={t('Close')} className="rounded p-1 text-muted-foreground hover:text-fg">
              <X className="h-5 w-5" />
            </button>
          ) : null}
        </div>

        {phase === 'confirm' ? (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">{intro}</div>
            <ul className="max-h-60 divide-y divide-border overflow-y-auto rounded-lg border border-border text-sm">
              {items.map((it) => (
                <li key={it.key} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-1.5">
                  <span className="font-medium">{it.name}</span>
                  <span className="text-xs text-muted-foreground">{it.detail}</span>
                </li>
              ))}
            </ul>
            {askReason ? (
              <div>
                <Label htmlFor="bulk-reason">{t('Reason (kept on the permanent record of each invitation)')}</Label>
                <Input id="bulk-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300}
                  placeholder={t('e.g. Go-live wave 1: Durban Central, briefing 6 October')} className="mt-1.5" />
                {reason.trim().length > 0 && reason.trim().length < 10 ? (
                  <p className="mt-1 text-xs text-severity-medium-ink">{t('At least 10 characters.')}</p>
                ) : null}
              </div>
            ) : null}
            {askHrConfirm ? (
              <label className="flex items-start gap-2.5 text-sm">
                <input type="checkbox" checked={fromHr} onChange={(e) => setFromHr(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[rgb(var(--c-primary))]" />
                <span>{t('These email addresses and cellphone numbers come from HR’s staff list.')}</span>
              </label>
            ) : null}
            <div className="flex gap-2">
              <Button onClick={start} disabled={!ready}>{confirmLabel}</Button>
              <Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
            </div>
          </div>
        ) : null}

        {phase === 'running' ? (
          <div className="space-y-3" aria-live="polite">
            <p className="text-sm">{t('Working… {done} of {length}', { done, length: items.length })}</p>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
            </div>
            <Button variant="outline" size="sm" onClick={() => { stop.current = true; }}>{t('Stop after this batch')}</Button>
          </div>
        ) : null}

        {phase === 'done' ? (
          <div className="space-y-4" aria-live="polite">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Tile n={count('sent') + count('link')} label={t('Sent')} tone="ok" />
              <Tile n={count('slip')} label={t('Slips to print')} tone="info" />
              <Tile n={count('skipped') + count('awaiting_approval')} label={t('Skipped')} tone="dim" />
              <Tile n={count('failed')} label={t('Not delivered')} tone={count('failed') ? 'crit' : 'dim'} />
            </div>
            {done < items.length ? (
              <p className="text-sm text-severity-medium-ink">{t('Stopped after {done} of {length}. The rest were not touched; run it again for them.', { done, length: items.length })}</p>
            ) : null}
            {error ? <p role="alert" className="rounded-md border border-severity-critical/40 bg-severity-critical/10 px-3 py-2 text-sm text-severity-critical-ink">{error}</p> : null}
            {slips.length ? (
              <Button onClick={() => setShowSlips(true)}><Printer className="h-4 w-4" /> {' '}{t('Print {length} activation {value}', { length: slips.length, value: slips.length === 1 ? 'slip' : 'slips' })}</Button>
            ) : null}
            {links.length ? (
              <div className="space-y-2 rounded-lg border border-severity-medium/50 p-3 text-sm">
                <p className="font-semibold">{t('Invitation links (development only)')}</p>
                <p className="text-muted-foreground">{t('Email is not set up on this server, so pass these on yourself. Production always emails them.')}</p>
                <ul className="space-y-1.5">
                  {links.map((l) => (
                    <li key={l.link} className="flex items-center gap-2">
                      <span className="w-40 shrink-0 truncate">{l.name}</span>
                      <code className="min-w-0 flex-1 truncate text-xs">{l.link}</code>
                      <Button size="sm" variant="ghost" onClick={() => { void navigator.clipboard?.writeText(l.link).catch(() => {}); }} aria-label={`Copy ${l.name}'s link`}>
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {problems.length ? (
              <div className="space-y-1.5">
                <p className="text-sm font-semibold">{t('Not done')}</p>
                <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-lg border border-border text-sm">
                  {problems.map((r) => (
                    <li key={r.key} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-1.5">
                      <span>{r.name}</span>
                      <span className={cn('text-xs', r.status === 'failed' ? 'text-severity-critical-ink' : 'text-muted-foreground')}>{r.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <Button variant="outline" onClick={close}>{t('Done')}</Button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

function Tile({ n, label, tone }: { n: number; label: string; tone: 'ok' | 'info' | 'crit' | 'dim' }) {
  return (
    <div className="rounded-lg border border-border bg-bg-soft px-3 py-2">
      <p className={cn('text-2xl font-bold tabular-nums',
        tone === 'ok' && 'text-success', tone === 'info' && 'text-primary', tone === 'crit' && 'text-severity-critical-ink',
        tone === 'dim' && 'text-muted-foreground')}>{n}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
