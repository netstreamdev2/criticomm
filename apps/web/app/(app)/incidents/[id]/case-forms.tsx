'use client';

import { useActionState, useState } from 'react';
import { CANCEL_REASON_MIN } from '@criticom/db';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { closeCaseAction, setStatusAction, type FormState } from './actions';

function Outcome({ state }: { state: FormState }) {
  if (state?.error) {
    return (
      <p role="alert" className="mt-2 rounded-md border border-severity-critical/40 bg-severity-critical/10 px-3 py-2 text-xs text-severity-critical-ink">
        {state.error}
      </p>
    );
  }
  if (state?.done) return <output className="mt-2 block text-xs text-severity-low-ink">{state.done}</output>;
  return null;
}

/**
 * Close a case after reading its report (0061). The review note is optional:
 * it goes on the case's timeline and to the officer.
 */
export function ReviewCloseForm({ incidentId, incidentNumber }: { incidentId: string; incidentNumber: string }) {
  const [state, action, pending] = useActionState(closeCaseAction, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="incident_id" value={incidentId} />
      <label htmlFor="review-note" className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Review note <span className="font-normal normal-case tracking-normal">(optional, goes on the record and to the officer)</span>
      </label>
      <Textarea id="review-note" name="reason" rows={2} maxLength={1000} placeholder="e.g. Report complete; statement and photos on file." />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-severity-low/90 px-3 py-2 text-sm font-semibold hover:bg-severity-low disabled:opacity-60"
      >
        {pending ? 'Closing…' : `Close ${incidentNumber}`}
      </button>
      <Outcome state={state} />
    </form>
  );
}

/**
 * Close a live call without a report (hoax, duplicate, caller cancelled). The
 * desk's decision, never the case manager's, and only with a reason. Folded
 * away by default: it is the exception, and it stands crews down.
 */
export function CancelCallForm({
  incidentId, incidentNumber, responding,
}: { incidentId: string; incidentNumber: string; responding: number }) {
  const [state, action, pending] = useActionState(closeCaseAction, null);
  const [reason, setReason] = useState('');
  const short = reason.trim().length < CANCEL_REASON_MIN;
  return (
    <details className="group rounded-lg border border-border bg-bg-soft">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-fg">
        Close without a report
      </summary>
      <form action={action} className="space-y-2 border-t border-border p-3">
        <input type="hidden" name="incident_id" value={incidentId} />
        <p className="text-xs text-muted-foreground">
          For a call that will never have a report: a hoax, a duplicate, or the caller cancelled.
          {responding > 0
            ? ` ${responding} officer${responding === 1 ? ' is' : 's are'} on this call and will be told to stand down.`
            : ''}
        </p>
        <label htmlFor="cancel-reason" className="sr-only">Reason for closing {incidentNumber} without a report</label>
        <Textarea
          id="cancel-reason" name="reason" rows={2} required minLength={CANCEL_REASON_MIN} maxLength={1000}
          value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="Why this call is being closed (at least 10 characters)"
        />
        <button
          type="submit"
          disabled={pending || short}
          className="w-full rounded-md bg-severity-critical/90 px-3 py-2 text-sm font-semibold hover:bg-severity-critical disabled:opacity-60"
        >
          {pending ? 'Closing…' : `Close ${incidentNumber} without a report`}
        </button>
        <Outcome state={state} />
      </form>
    </details>
  );
}

/**
 * The desk marks a crew's step when the officer radios it in rather than
 * pressing it on the phone. Resolved and Closed are not offered.
 */
export function StatusOverride({
  incidentId, silo, steps, current,
}: { incidentId: string; silo: string; steps: readonly string[]; current: string }) {
  const [state, action, pending] = useActionState(setStatusAction, null);
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {steps.map((s) => (
          <form key={s} action={action}>
            <input type="hidden" name="incident_id" value={incidentId} />
            <input type="hidden" name="silo" value={silo} />
            <input type="hidden" name="status" value={s} />
            <button
              type="submit"
              disabled={pending || s === current}
              className={cn(
                'rounded-md border border-border bg-bg-soft px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-50',
                s === current && 'border-accent/50 text-accent',
              )}
            >
              {s}
            </button>
          </form>
        ))}
      </div>
      <Outcome state={state} />
    </div>
  );
}
