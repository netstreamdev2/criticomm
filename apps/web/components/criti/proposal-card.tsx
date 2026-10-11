'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, ClipboardList, Loader2, Sparkles, X } from 'lucide-react';
import type { ProposalView } from '@criticom/api';
import { cn } from '@/lib/utils';
import { runProposal, saveCallDraft } from './shared';

export type CardState = 'open' | 'working' | 'done' | 'cancelled' | 'failed';

/**
 * One task Criti prepared, waiting for the person. Nothing happens until they
 * press Confirm; then the server checks it again and does it the way the
 * form would. Closing a call, and a Critical broadcast, ask twice.
 */
export function ProposalCard({
  view, state: initial = 'open', onChange, onDone,
}: {
  view: ProposalView;
  state?: CardState;
  /** The card's state, for the conversation's memory. */
  onChange?: (state: CardState, note?: string) => void;
  /** After a task is done: refresh whatever shows the board. */
  onDone?: () => void;
}) {
  const router = useRouter();
  const [state, setState] = useState<CardState>(initial);
  const [note, setNote] = useState<{ text: string; href?: string } | null>(null);
  const [armed, setArmed] = useState(false);
  const p = view.proposal;
  const blocked = view.missing.length > 0;
  const twice = p.kind === 'cancel_call' || (p.kind === 'broadcast' && p.severity === 'Critical');

  const set = (s: CardState, text?: string, href?: string) => {
    setState(s);
    setNote(text ? { text, href } : null);
    onChange?.(s, text);
  };

  const confirm = async () => {
    if (blocked || state === 'working') return;
    if (twice && !armed) { setArmed(true); return; }
    set('working');
    const incidentId = 'incident_id' in p ? p.incident_id : undefined;
    const r = await runProposal(p, incidentId);
    if (r.ok) {
      set('done', r.message, r.href);
      onDone?.();
      router.refresh();
    } else {
      setArmed(false);
      set('failed', r.error);
    }
  };

  const openForm = () => {
    if (p.kind !== 'log_call') return;
    saveCallDraft(p.call);
    router.push('/dispatch/log-call');
  };

  const finished = state === 'done' || state === 'cancelled';

  return (
    <section
      aria-label={view.title}
      className={cn(
        'rounded-xl border p-3 text-[13px]',
        state === 'done' ? 'border-severity-low/50 bg-severity-low/5'
          : state === 'failed' ? 'border-severity-critical/50 bg-severity-critical/5'
            : state === 'cancelled' ? 'border-border bg-bg-soft opacity-70'
              : 'border-accent/40 bg-accent/5',
      )}
    >
      <p className="flex items-start gap-2 font-semibold">
        {state === 'done' ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-severity-low-ink" />
          : <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent" />}
        <span className="min-w-0 break-words">{view.title}</span>
      </p>

      {!finished && view.lines.length ? (
        <ul className="mt-1.5 space-y-0.5 pl-6 text-muted-foreground">
          {view.lines.map((l, i) => <li key={i} className="break-words">{l}</li>)}
        </ul>
      ) : null}

      {!finished && view.warnings.length ? (
        <ul className="mt-2 space-y-1">
          {view.warnings.map((w, i) => (
            <li key={i} className="flex gap-1.5 rounded-md bg-severity-medium/10 px-2 py-1 text-severity-medium-ink">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span className="break-words">{w}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {!finished && blocked ? (
        <p className="mt-2 rounded-md bg-muted px-2 py-1 text-xs">
          <span className="font-semibold">Still needed:</span> {view.missing.join(', ')}.
        </p>
      ) : null}

      {note ? (
        <p className={cn('mt-2 break-words text-xs', state === 'failed' ? 'text-severity-critical-ink' : 'text-severity-low-ink')}>
          {note.text}{' '}
          {note.href ? <Link href={note.href} className="font-semibold underline">Open the call</Link> : null}
        </p>
      ) : null}
      {state === 'cancelled' ? <p className="mt-1 text-xs text-muted-foreground">Cancelled. Nothing was changed.</p> : null}

      {!finished ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {!blocked ? (
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={state === 'working'}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-bold transition-opacity disabled:opacity-60',
                armed ? 'bg-severity-critical text-severity-critical-fg' : 'bg-primary text-primary-foreground',
              )}
            >
              {state === 'working' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {state === 'working' ? 'Working…' : armed ? `Yes, ${view.confirmLabel.toLowerCase()}` : state === 'failed' ? 'Try again' : view.confirmLabel}
            </button>
          ) : null}
          {p.kind === 'log_call' ? (
            <button
              type="button"
              onClick={openForm}
              disabled={state === 'working'}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-semibold hover:bg-muted"
            >
              <ClipboardList className="h-3.5 w-3.5" /> Open in the form
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => { setArmed(false); set('cancelled'); }}
            disabled={state === 'working'}
            className="inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-fg"
          >
            <X className="h-3.5 w-3.5" /> Cancel
          </button>
          {armed ? <span className="text-[11px] text-severity-critical-ink">This cannot be undone. Press again to go ahead.</span> : null}
        </div>
      ) : null}
    </section>
  );
}
