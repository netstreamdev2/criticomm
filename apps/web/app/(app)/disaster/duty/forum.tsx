'use client';

import { useRef, useState, useTransition } from 'react';
import { Plus, Trash2, Users } from 'lucide-react';
import { TASK_TEAMS } from '@criticom/db/disaster-readiness';
import { CallButton } from '@/components/disaster/call-button';
import { FieldProblem, problemBorder } from '@/components/disaster/field-problem';
import { Fold } from '@/components/disaster/fold';
import { useT } from '@/components/i18n';
import { checkName, checkPhone } from '@/lib/disaster-checks';
import { cn } from '@/lib/utils';
import { forumMeetingAction, removeForumMeetingAction, taskTeamAction } from '../readiness/actions';

type Team = { team: string; chair: string | null; phone: string | null };
type Meeting = { id: string; body: string; heldOn: string; attended: string | null; notes: string | null; by: string | null };

const bodyName = (b: string) => (b === 'forum' ? 'Advisory Forum' : TASK_TEAMS.find((x) => x.key === b)?.label ?? b);
const todaySa = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(new Date());

/**
 * The Disaster Management Advisory Forum (revision 2, section 13): its five
 * task teams and their chairs, and the meetings of the Forum (every quarter)
 * and of the teams. Both count towards the readiness score.
 */
export function ForumBoard({ teams, meetings, canEdit }: { teams: Team[]; meetings: Meeting[]; canEdit: boolean }) {
  const { t } = useT();
  const [error, setError] = useState<string | null>(null);
  const lastForum = meetings.find((m) => m.body === 'forum');
  const quarterDays = lastForum ? Math.floor((Date.now() - Date.parse(lastForum.heldOn)) / (24 * 3600_000)) : null;
  return (
    <div className="space-y-6">
      {error ? <p role="alert" className="rounded-lg border border-severity-critical bg-bg-card px-4 py-3 text-sm font-medium text-severity-critical-ink">{error}</p> : null}
      <Fold id="duty.teams" icon={Users} title={t('Advisory Forum task teams')}
        summary={t('{n} of 5 have a chair', { n: teams.filter((x) => x.chair).length })}
        info={t('The Forum’s five task teams. Each needs a chair; the readiness score counts them.')}>
        <ul className="divide-y divide-border">
          {TASK_TEAMS.map((x) => (
            <TeamRow key={x.key} team={x.key} label={x.label} current={teams.find((c) => c.team === x.key) ?? null} canEdit={canEdit} onError={setError} />
          ))}
        </ul>
      </Fold>
      <Fold id="duty.meetings" icon={Users} title={t('Meetings ({n})', { n: meetings.length })}
        summary={quarterDays == null ? t('The Forum has no meeting recorded') : t('The Forum last met {d} days ago', { d: quarterDays })}
        info={t('The Advisory Forum meets every quarter; its task teams as they need. A Forum meeting in the last three months counts towards readiness.')}>
        {canEdit ? <MeetingForm onError={setError} /> : null}
        <ul className="divide-y divide-border">
          {meetings.map((m) => <MeetingRow key={m.id} m={m} canEdit={canEdit} onError={setError} />)}
          {meetings.length === 0 ? <li className="px-5 py-6 text-center text-sm text-muted-foreground">{t('No meeting recorded yet.')}</li> : null}
        </ul>
      </Fold>
    </div>
  );
}

function TeamRow({ team, label, current, canEdit, onError }: {
  team: string; label: string; current: Team | null; canEdit: boolean; onError: (e: string | null) => void;
}) {
  const { t } = useT();
  const [pending, start] = useTransition();
  const [v, setV] = useState({ chair: current?.chair ?? '', phone: current?.phone ?? '' });
  const dirty = v.chair !== (current?.chair ?? '') || v.phone !== (current?.phone ?? '');
  const bad = { chair: checkName(v.chair), phone: checkPhone(v.phone) };
  const field = 'h-11 w-full rounded-md border border-border bg-bg-soft px-3 text-[15px]';
  return (
    <li className="grid gap-2 px-5 py-3 lg:grid-cols-[minmax(0,1fr)_14rem_11rem_auto] lg:items-start">
      <div className="pt-2">
        <p className="font-medium">{t(label)}</p>
        {!current?.chair ? <p className="text-xs text-severity-medium-ink">{t('No chair yet')}</p> : null}
      </div>
      <label className="block">
        <span className="sr-only">{t('Chair')}</span>
        <input value={v.chair} disabled={!canEdit} maxLength={160} placeholder={t('Chair')} onChange={(e) => setV({ ...v, chair: e.target.value })}
          className={cn(field, problemBorder(bad.chair))} />
        <FieldProblem problem={bad.chair} />
      </label>
      <label className="block">
        <span className="sr-only">{t('Their number')}</span>
        <input value={v.phone} disabled={!canEdit} maxLength={30} inputMode="tel" placeholder={t('Their number')} onChange={(e) => setV({ ...v, phone: e.target.value })}
          className={cn(field, problemBorder(bad.phone))} />
        <FieldProblem problem={bad.phone} />
      </label>
      <div className="flex gap-2">
        {current?.phone && !dirty ? <CallButton number={current.phone} /> : null}
        {canEdit && dirty ? (
          <button type="button" disabled={pending || Boolean(bad.chair || bad.phone)}
            onClick={() => start(async () => {
              const res = await taskTeamAction(team, v.chair, v.phone);
              onError('error' in res ? res.error : null);
            })}
            className="h-11 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">{t('Save')}</button>
        ) : null}
      </div>
    </li>
  );
}

function MeetingForm({ onError }: { onError: (e: string | null) => void }) {
  const { t } = useT();
  const ref = useRef(crypto.randomUUID());
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [v, setV] = useState({ body: 'forum', held_on: todaySa(), attended: '', notes: '' });
  const field = 'mt-1 h-11 w-full rounded-md border border-border bg-bg-soft px-3 text-[15px]';
  if (!open) {
    return (
      <div className="border-b border-border px-5 py-3">
        <button type="button" onClick={() => setOpen(true)} className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground">
          <Plus className="h-4 w-4" aria-hidden />{t('Record a meeting')}
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-3 border-b border-border px-5 py-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">{t('Who met')}
          <select value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} className={field}>
            <option value="forum">{t('Advisory Forum')}</option>
            {TASK_TEAMS.map((x) => <option key={x.key} value={x.key}>{t(x.label)}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium">{t('When')}
          <input type="date" value={v.held_on} onChange={(e) => setV({ ...v, held_on: e.target.value })} className={field} />
        </label>
      </div>
      <label className="block text-sm font-medium">{t('Who was there')}
        <input value={v.attended} maxLength={1000} onChange={(e) => setV({ ...v, attended: e.target.value })} className={field} />
      </label>
      <label className="block text-sm font-medium">{t('What was decided')}
        <textarea value={v.notes} maxLength={4000} rows={3} onChange={(e) => setV({ ...v, notes: e.target.value })}
          className="mt-1 w-full rounded-md border border-border bg-bg-soft px-3 py-2 text-[15px]" />
      </label>
      <div className="flex gap-2">
        <button type="button" disabled={pending || !v.held_on}
          onClick={() => start(async () => {
            const res = await forumMeetingAction(ref.current, v);
            if ('error' in res) { onError(res.error); return; }
            onError(null);
            ref.current = crypto.randomUUID();
            setV({ body: 'forum', held_on: todaySa(), attended: '', notes: '' });
            setOpen(false);
          })}
          className="h-11 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50">{pending ? t('Saving…') : t('Save the meeting')}</button>
        <button type="button" onClick={() => setOpen(false)} className="h-11 rounded-md border border-border px-5 text-sm hover:bg-muted">{t('Cancel')}</button>
      </div>
    </div>
  );
}

function MeetingRow({ m, canEdit, onError }: { m: Meeting; canEdit: boolean; onError: (e: string | null) => void }) {
  const { t } = useT();
  const [pending, start] = useTransition();
  return (
    <li className="flex flex-wrap items-start gap-3 px-5 py-3 text-sm">
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{t(bodyName(m.body))} <span className="font-normal text-muted-foreground">· {m.heldOn}</span></p>
        {m.attended ? <p><span className="text-muted-foreground">{t('Attended:')}</span> {m.attended}</p> : null}
        {m.notes ? <p className="whitespace-pre-line">{m.notes}</p> : null}
      </div>
      {canEdit ? (
        <button type="button" disabled={pending} aria-label={t('Take this meeting off')}
          onClick={() => {
            if (!window.confirm(t('Take this meeting off the record?'))) return;
            start(async () => {
              const res = await removeForumMeetingAction(m.id);
              onError('error' in res ? res.error : null);
            });
          }}
          className="grid h-10 w-10 place-items-center rounded-md border border-border hover:bg-muted"><Trash2 className="h-4 w-4" aria-hidden /></button>
      ) : null}
    </li>
  );
}
