'use client';

import { useState, useTransition } from 'react';
import { ClipboardList, FileSignature, RotateCcw } from 'lucide-react';
import {
  NEXT_STATUS, RECOVERY_STATES, RECOVERY_TASKS, REVIEW_FIELDS, REVIEW_SIGNOFFS, STATUS_MOVE, openRecoveryTasks, type DmStatus,
} from '@criticom/db/disaster-joc';
import { Fold } from '@/components/disaster/fold';
import { InfoDot } from '@/components/info-dot';
import { Modal } from '@/components/ui/modal';
import { useT } from '@/components/i18n';
import { cn, formatSaTime } from '@/lib/utils';
import { dmStatusAction, recoveryAction, reviewAction, signReviewAction } from '../joc-actions';

export type BoardRecovery = Record<string, { state: string; note: string | null; at: string; by: string }>;
export type BoardReview = {
  reviewDate: string | null; leadReviewer: string | null; what_happened: string | null; what_worked: string | null; to_improve: string | null;
  lessons: string | null; recommendations: string | null; signoffs: Record<string, { at: string; by: string }>; signedOffAt: string | null;
};

const STATUS_TONE: Record<DmStatus, string> = {
  Active: 'bg-severity-critical/15 text-severity-critical-ink',
  'Stood down': 'bg-severity-medium/15 text-severity-medium-ink',
  'In recovery': 'bg-accent/15 text-accent',
  Closed: 'bg-muted text-muted-foreground',
};

export function DmStatusChip({ status }: { status: DmStatus }) {
  const { t } = useT();
  return <span className={cn('rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide', STATUS_TONE[status])}>{t(status)}</span>;
}

/**
 * Where the incident stands for Disaster Management, and the moves from
 * there: stand down, start recovery, close, reopen. Each asks why, and who
 * decided if it was not the person at the desk.
 */
export function StatusBar({ incidentId, status, at, by, recovery, live }: {
  incidentId: string; status: DmStatus; at: string | null; by: string | null; recovery: BoardRecovery; live: boolean;
}) {
  const { t } = useT();
  const [to, setTo] = useState<DmStatus | null>(null);
  return (
    <div data-guide="board.status" className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-bg-card px-5 py-3 shadow-sm">
      <span className="text-sm font-semibold">{t('Status')}</span>
      <DmStatusChip status={status} />
      {at ? <span className="text-xs text-muted-foreground">{t('since {at}{by}', { at: formatSaTime(at), by: by ? ` · ${by}` : '' })}</span> : null}
      <InfoDot text={t('Active: the response is under way. Stood down: the response is over and the incident leaves the board. In recovery: rebuilding. Closed: finished, the record kept. Any of them can be reopened.')} />
      {live ? (
        <div className="ml-auto flex flex-wrap gap-2">
          {NEXT_STATUS[status].map((s) => (
            <button key={s} type="button" onClick={() => setTo(s)}
              className={cn('inline-flex h-11 items-center gap-2 rounded-md border px-4 text-sm font-semibold hover:bg-muted',
                s === 'Active' ? 'border-severity-critical/50 text-severity-critical-ink' : 'border-border')}>
              {s === 'Active' ? <RotateCcw className="h-4 w-4" aria-hidden /> : null}{t(STATUS_MOVE[s].label)}
            </button>
          ))}
        </div>
      ) : null}
      {to ? <StatusDialog incidentId={incidentId} from={status} to={to} openTasks={openRecoveryTasks(recovery)} onClose={() => setTo(null)} /> : null}
    </div>
  );
}

function StatusDialog({ incidentId, from, to, openTasks, onClose }: {
  incidentId: string; from: DmStatus; to: DmStatus; openTasks: number; onClose: () => void;
}) {
  const { t } = useT();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [by, setBy] = useState('');
  const [handover, setHandover] = useState(false);
  const needsHandover = to === 'Closed' && from === 'In recovery' && openTasks > 0;
  const save = () => start(async () => {
    setError(null);
    const res = await dmStatusAction(incidentId, to, { reason, decided_by: by, handover });
    if ('error' in res) { setError(res.error); return; }
    onClose();
  });
  const title = t(STATUS_MOVE[to].label);
  return (
    <Modal title={title} onClose={onClose} busy={pending}
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={pending} className="h-11 rounded-md border border-border px-5 text-sm font-semibold hover:bg-muted">{t('Cancel')}</button>
          <button type="button" onClick={save} disabled={pending || !reason.trim() || (needsHandover && !handover)}
            className="h-11 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50">{pending ? t('Saving…') : title}</button>
        </div>
      )}>
      <div className="space-y-4">
        {error ? <p role="alert" className="rounded-md border border-severity-critical px-3 py-2 text-sm font-medium text-severity-critical-ink">{error}</p> : null}
        <p className="rounded-md bg-muted px-3 py-2 text-sm">{t('Decided by: {who}', { who: t(STATUS_MOVE[to].decides) })}</p>
        {to === 'Active' ? <p className="text-sm">{t('The incident goes back on the board at the level it had.')}</p> : null}
        {to === 'Stood down' ? <p className="text-sm">{t('The incident leaves the command board and waits on the Recovery and review list.')}</p> : null}
        <label className="block text-sm font-medium">{t('Why?')}
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500}
            className="mt-1 w-full rounded-md border border-border bg-bg-soft px-3 py-2 text-[15px]" />
        </label>
        <label className="block text-sm font-medium">{t('Who decided (if not you)')}
          <input value={by} onChange={(e) => setBy(e.target.value)} maxLength={160} className="mt-1 h-11 w-full rounded-md border border-border bg-bg-soft px-3 text-[15px]" />
        </label>
        {needsHandover ? (
          <label className="flex items-start gap-3 rounded-md border border-severity-medium px-3 py-2 text-sm">
            <input type="checkbox" checked={handover} onChange={(e) => setHandover(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0" />
            <span>{t('{n} recovery task(s) are still open. I confirm they are handed over to the departments.', { n: openTasks })}</span>
          </label>
        ) : null}
      </div>
    </Modal>
  );
}

/** The eight recovery tasks, each with its owner, how far it is and a note. */
export function RecoveryTile({ incidentId, recovery, live, onError }: { incidentId: string; recovery: BoardRecovery; live: boolean; onError: (e: string) => void }) {
  const { t } = useT();
  const [pending, start] = useTransition();
  const [notes, setNotes] = useState<Record<string, string>>(() => Object.fromEntries(RECOVERY_TASKS.map((x) => [x.key, recovery[x.key]?.note ?? ''])));
  const save = (task: string, state: string) => start(async () => {
    const res = await recoveryAction(incidentId, task, state, notes[task] ?? '');
    if ('error' in res) onError(res.error);
  });
  const done = RECOVERY_TASKS.length - openRecoveryTasks(recovery);
  return (
    <Fold id="board.recovery" icon={ClipboardList} title={t('Recovery and rehabilitation')}
      summary={t('{done} of {all} tasks done or handed over', { done, all: RECOVERY_TASKS.length })}
      info={t('Building back better: each task has the department that owns it. Mark how far it is; hand over what goes on in the departments’ own programmes.')}>
      <ul className="divide-y divide-border">
        {RECOVERY_TASKS.map((x) => {
          const cur = recovery[x.key];
          return (
            <li key={x.key} className="grid gap-2 px-5 py-3 lg:grid-cols-[minmax(0,1fr)_11rem_minmax(0,16rem)] lg:items-center">
              <div className="min-w-0">
                <p className="font-medium">{t(x.label)}</p>
                <p className="text-xs text-muted-foreground">{t(x.owner)}{cur ? ` · ${cur.by}, ${formatSaTime(cur.at)}` : ''}</p>
              </div>
              <select value={cur?.state ?? 'Not started'} disabled={!live || pending} onChange={(e) => save(x.key, e.target.value)}
                aria-label={t('How far: {task}', { task: t(x.label) })} className="h-11 rounded-md border border-border bg-bg-soft px-2 text-sm">
                {RECOVERY_STATES.map((s) => <option key={s} value={s}>{t(s)}</option>)}
              </select>
              <input value={notes[x.key] ?? ''} disabled={!live} maxLength={500} placeholder={t('Note')}
                onChange={(e) => setNotes({ ...notes, [x.key]: e.target.value })}
                onBlur={() => { if ((notes[x.key] ?? '') !== (cur?.note ?? '')) save(x.key, cur?.state ?? 'Not started'); }}
                className="h-11 rounded-md border border-border bg-bg-soft px-3 text-sm" />
            </li>
          );
        })}
      </ul>
    </Fold>
  );
}

/** The post-incident review and its four sign-offs; signed off, it leaves the Recovery and review list. */
export function ReviewTile({ incidentId, review, lessonsFromPostMortem, live, onError }: {
  incidentId: string; review: BoardReview | null; lessonsFromPostMortem: string | null; live: boolean; onError: (e: string) => void;
}) {
  const { t } = useT();
  const [pending, start] = useTransition();
  const [v, setV] = useState<Record<string, string>>({
    review_date: review?.reviewDate ?? '', lead_reviewer: review?.leadReviewer ?? '',
    what_happened: review?.what_happened ?? '', what_worked: review?.what_worked ?? '', to_improve: review?.to_improve ?? '',
    lessons: review?.lessons ?? lessonsFromPostMortem ?? '', recommendations: review?.recommendations ?? '',
  });
  const save = () => start(async () => {
    const res = await reviewAction(incidentId, v);
    if ('error' in res) onError(res.error);
  });
  const sign = (key: string, done: boolean) => start(async () => {
    const res = await signReviewAction(incidentId, key, done);
    if ('error' in res) onError(res.error);
  });
  const signed = REVIEW_SIGNOFFS.filter((s) => review?.signoffs[s.key]).length;
  const field = 'mt-1 w-full rounded-md border border-border bg-bg-soft px-3 text-[15px]';
  return (
    <Fold id="board.review" icon={FileSignature} title={t('Post-incident review')} defaultOpen={false}
      summary={review?.signedOffAt ? t('Signed off {at}', { at: formatSaTime(review.signedOffAt) }) : t('{n} of 4 sign-offs', { n: signed })}
      info={t('Lessons learnt: what happened, what worked, what to improve and the changes recommended. It feeds the Level 2 plan review and the IDP.')}>
      <div className="grid gap-6 p-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium">{t('Date of the review')}
              <input type="date" value={v.review_date} disabled={!live} onChange={(e) => setV({ ...v, review_date: e.target.value })} className={cn(field, 'h-11')} />
            </label>
            <label className="block text-sm font-medium">{t('Lead reviewer')}
              <input value={v.lead_reviewer} disabled={!live} maxLength={160} onChange={(e) => setV({ ...v, lead_reviewer: e.target.value })} className={cn(field, 'h-11')} />
            </label>
          </div>
          {REVIEW_FIELDS.map((f) => (
            <label key={f.key} className="block text-sm font-medium">{t(f.label)}
              <textarea value={v[f.key] ?? ''} disabled={!live} rows={3} maxLength={4000} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} className={cn(field, 'py-2')} />
            </label>
          ))}
          {live ? (
            <button type="button" onClick={save} disabled={pending} className="h-11 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50">
              {pending ? t('Saving…') : t('Save the review')}
            </button>
          ) : null}
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold">{t('Sign-off')}</p>
          <ul className="space-y-2">
            {REVIEW_SIGNOFFS.map((s) => {
              const done = review?.signoffs[s.key];
              return (
                <li key={s.key}>
                  <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-border px-3 py-2">
                    <input type="checkbox" checked={Boolean(done)} disabled={!live || pending || !review?.what_happened}
                      onChange={(e) => sign(s.key, e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0" />
                    <span className="text-sm">
                      <span className="block">{t(s.label)}</span>
                      {done ? <span className="block text-xs text-muted-foreground">{done.by}, {formatSaTime(done.at)}</span> : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {!review?.what_happened ? <p className="mt-2 text-xs text-muted-foreground">{t('Save the review with the lead reviewer and what happened first.')}</p> : null}
        </div>
      </div>
    </Fold>
  );
}
