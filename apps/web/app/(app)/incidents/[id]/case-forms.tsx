'use client';

import { useActionState, useState } from 'react';
import { CANCEL_REASON_MIN } from '@criticom/db';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { closeCaseAction, confirmArrivalAction, setStatusAction, standDownAction, type FormState } from './actions';
import { useT } from '@/components/i18n';

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
  const { t } = useT();
  const [state, action, pending] = useActionState(closeCaseAction, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="incident_id" value={incidentId} />
      <label htmlFor="review-note" className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t('Review note')}{' '}<span className="font-normal normal-case tracking-normal">{t('(optional, goes on the record and to the officer)')}</span>
      </label>
      <Textarea id="review-note" name="reason" rows={2} maxLength={1000} placeholder={t('e.g. Report complete; statement and photos on file.')} />
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
  const { t } = useT();
  const [state, action, pending] = useActionState(closeCaseAction, null);
  const [reason, setReason] = useState('');
  const short = reason.trim().length < CANCEL_REASON_MIN;
  return (
    <details className="group rounded-lg border border-border bg-bg-soft">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-fg">
        {t('Close without a report')}</summary>
      <form action={action} className="space-y-2 border-t border-border p-3">
        <input type="hidden" name="incident_id" value={incidentId} />
        <p className="text-xs text-muted-foreground">
          {t('For a call that will never have a report: a hoax, a duplicate, or the caller cancelled.{value}', { value: responding > 0
            ? ` ${responding} officer${responding === 1 ? ' is' : 's are'} on this call and will be told to stand down.`
            : '' })}
        </p>
        <label htmlFor="cancel-reason" className="sr-only">{t('Reason for closing {incidentNumber} without a report', { incidentNumber })}</label>
        <Textarea
          id="cancel-reason" name="reason" rows={2} required minLength={CANCEL_REASON_MIN} maxLength={1000}
          value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder={t('Why this call is being closed (at least 10 characters)')}
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
  incidentId, silo, steps, current, department,
}: { incidentId: string; silo: string; steps: readonly string[]; current: string; department?: string }) {
  const [state, action, pending] = useActionState(setStatusAction, null);
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {steps.map((s) => (
          <form key={s} action={action}>
            <input type="hidden" name="incident_id" value={incidentId} />
            <input type="hidden" name="silo" value={silo} />
            {department ? <input type="hidden" name="department" value={department} /> : null}
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

/** A department is not needed on this call (0073): say why; its crew is told to stand down. */
/** The crew's arrival is not proven by their phone: dispatch confirms it, saying how it knows (0102). */
export function ConfirmArrival({ incidentId, department }: { incidentId: string; department: string }) {
  const { t } = useT();
  const [state, action, pending] = useActionState(confirmArrivalAction, null);
  const [note, setNote] = useState('');
  if (state?.done) return <Outcome state={state} />;
  return (
    <details className="group">
      <summary className="cursor-pointer text-xs font-semibold text-severity-high-ink hover:underline">{t('Confirm arrival')}</summary>
      <form action={action} className="mt-2 space-y-2">
        <input type="hidden" name="incident_id" value={incidentId} />
        <input type="hidden" name="department" value={department} />
        <Textarea
          name="note"
          rows={2}
          required
          maxLength={200}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('How do you know they are there? e.g. Called the officer; seen on the bodycam')}
        />
        <button
          type="submit"
          disabled={pending || note.trim().length < 3}
          className="rounded-md border border-severity-high/50 bg-severity-high/10 px-3 py-1.5 text-xs font-semibold text-severity-high-ink disabled:opacity-50"
        >
          {pending ? t('Saving…') : t('Confirm they are on scene')}
        </button>
        <Outcome state={state} />
      </form>
    </details>
  );
}

export function StandDown({ incidentId, department, label }: { incidentId: string; department: string; label: string }) {
  const { t } = useT();
  const [state, action, pending] = useActionState(standDownAction, null);
  const [reason, setReason] = useState('');
  if (state?.done) return <Outcome state={state} />;
  return (
    <details className="group">
      <summary className="cursor-pointer text-xs font-semibold text-muted-foreground hover:text-fg">{t('Not needed')}</summary>
      <form action={action} className="mt-2 space-y-2">
        <input type="hidden" name="incident_id" value={incidentId} />
        <input type="hidden" name="department" value={department} />
        <Textarea
          name="reason"
          rows={2}
          required
          minLength={CANCEL_REASON_MIN}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={`Why ${label} is not needed`}
        />
        <button
          type="submit"
          disabled={pending || reason.trim().length < CANCEL_REASON_MIN}
          className="rounded-md border border-severity-medium/50 bg-severity-medium/10 px-3 py-1.5 text-xs font-semibold text-severity-medium-ink disabled:opacity-50"
        >
          {pending ? 'Saving…' : `Mark ${label} not needed`}
        </button>
        <Outcome state={state} />
      </form>
    </details>
  );
}
