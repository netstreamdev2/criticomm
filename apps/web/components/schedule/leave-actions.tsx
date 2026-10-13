'use client';

import { useState, useTransition } from 'react';
import { applyLeaveAction, cancelLeaveAction, decideLeaveAction, type LeaveResult } from '@/app/(app)/leave/actions';
import { useToast } from '@/components/toast';

const btn = 'inline-flex h-8 items-center rounded-md px-3 text-xs font-semibold transition-colors disabled:opacity-60';
const input = 'h-9 w-full rounded-md border border-border bg-bg-soft px-2 text-sm';
const label = 'text-[0.68rem] font-semibold uppercase tracking-wide text-muted-foreground';

function useRun() {
  const toast = useToast();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<LeaveResult>, ok: string, done?: () => void) =>
    start(async () => {
      const res = await fn();
      if (res.error) toast.push({ title: 'Not done', body: res.error, tone: 'critical' });
      else {
        toast.push({ title: ok, tone: 'success' });
        done?.();
      }
    });
  return { pending, run };
}

const fd = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};

/**
 * Approve, or refuse with a reason, for someone you are senior to. The
 * database checks who you are; a refusal it would not take comes back here.
 */
export function LeaveDecision({ id, compact = false }: { id: string; compact?: boolean }) {
  const { pending, run } = useRun();
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState('');

  if (refusing) {
    return (
      <div className="flex min-w-[220px] flex-wrap items-center gap-1.5">
        <input className={`${input} h-8 flex-1`} placeholder="Why it is not approved" value={reason}
          onChange={(e) => setReason(e.target.value)} aria-label="Reason" />
        <button type="button" disabled={pending || reason.trim().length < 3}
          onClick={() => run(() => decideLeaveAction(fd({ id, decision: 'refuse', comment: reason })), 'Leave not approved', () => setRefusing(false))}
          className={`${btn} bg-severity-critical/20 text-severity-critical-ink hover:bg-severity-critical/30`}>
          Refuse
        </button>
        <button type="button" onClick={() => setRefusing(false)} className={`${btn} border border-border hover:bg-muted`}>Back</button>
      </div>
    );
  }
  return (
    <div className="flex shrink-0 flex-wrap gap-1.5">
      <button type="button" disabled={pending}
        onClick={() => run(() => decideLeaveAction(fd({ id, decision: 'approve' })), 'Leave approved')}
        className={`${btn} bg-severity-low/20 text-severity-low-ink hover:bg-severity-low/30`}>
        Approve
      </button>
      <button type="button" disabled={pending} onClick={() => setRefusing(true)}
        className={`${btn} bg-severity-critical/15 text-severity-critical-ink hover:bg-severity-critical/25`}>
        {compact ? '✕' : 'Refuse'}
      </button>
    </div>
  );
}

/** Cancel leave: your own before it starts; someone else's (senior to them) with a reason. */
export function LeaveCancel({ id, own }: { id: string; own: boolean }) {
  const { pending, run } = useRun();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');

  if (own) {
    return (
      <button type="button" disabled={pending}
        onClick={() => { if (window.confirm('Cancel this leave?')) run(() => cancelLeaveAction(fd({ id })), 'Leave cancelled'); }}
        className={`${btn} border border-border hover:bg-muted`}>
        Cancel
      </button>
    );
  }
  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} className={`${btn} border border-border hover:bg-muted`}>
        Cancel leave
      </button>
    );
  }
  return (
    <div className="flex min-w-[220px] flex-wrap items-center gap-1.5">
      <input className={`${input} h-8 flex-1`} placeholder="Why it is cancelled" value={reason}
        onChange={(e) => setReason(e.target.value)} aria-label="Reason" />
      <button type="button" disabled={pending || reason.trim().length < 3}
        onClick={() => run(() => cancelLeaveAction(fd({ id, reason })), 'Leave cancelled', () => setAsking(false))}
        className={`${btn} bg-severity-critical/20 text-severity-critical-ink`}>
        Cancel it
      </button>
      <button type="button" onClick={() => setAsking(false)} className={`${btn} border border-border hover:bg-muted`}>Back</button>
    </div>
  );
}

/** Ask for leave. The days it costs are counted when it is saved. */
export function ApplyLeaveForm({ types }: { types: string[] }) {
  const { pending, run } = useRun();
  const [key, setKey] = useState(0);
  return (
    <form
      key={key}
      action={(f) => run(() => applyLeaveAction(f), 'Request sent to your supervisor', () => setKey((k) => k + 1))}
      className="grid gap-3 rounded-lg border border-border bg-bg-card p-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      <div>
        <label className={label} htmlFor="absence">Type</label>
        <select id="absence" name="absence" required className={`${input} mt-1`}>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div>
        <label className={label} htmlFor="eff_from">First day</label>
        <input id="eff_from" name="eff_from" type="date" required className={`${input} mt-1`} />
      </div>
      <div>
        <label className={label} htmlFor="eff_to">Last day</label>
        <input id="eff_to" name="eff_to" type="date" required className={`${input} mt-1`} />
      </div>
      <div className="sm:col-span-2 lg:col-span-1">
        <label className={label} htmlFor="reason">Reason (optional)</label>
        <input id="reason" name="reason" maxLength={1000} className={`${input} mt-1`} />
      </div>
      <div className="sm:col-span-2 lg:col-span-4">
        <button type="submit" disabled={pending} className="h-10 w-full rounded-md bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60">
          {pending ? 'Sending…' : 'Ask for leave'}
        </button>
      </div>
    </form>
  );
}
