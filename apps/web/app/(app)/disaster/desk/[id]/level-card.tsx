'use client';

import { useState, useTransition } from 'react';
import { ArrowDown, ArrowUp, ShieldCheck, TriangleAlert } from 'lucide-react';
import { LEVELS, levelRank, type CoordinationLevel } from '@criticom/db/disaster-plan';
import { JOC_AUTHORISERS, LEVEL_DECIDES, LEVEL_TRIGGERS, ROSTER_AUTHORISERS, triggerLabel } from '@criticom/db/disaster-joc';
import { Fold } from '@/components/disaster/fold';
import { Modal } from '@/components/ui/modal';
import { useT } from '@/components/i18n';
import { cn, formatSaTime } from '@/lib/utils';
import { escalateAction, levelPlacesAction } from '../joc-actions';

export type BoardLevelChange = {
  at: string; from: CoordinationLevel; to: CoordinationLevel; triggers: string[]; reason: string | null; by: string | null;
  authorisedBy: string | null; role: string | null; onRoster: boolean | null;
};
export type LevelFacts = {
  level: CoordinationLevel; highestLevel: CoordinationLevel; dmStatus: string;
  fcp: string | null; fcpCommander: string | null; eoc: string | null; eocCommander: string | null;
  jocAuthorisedBy: string | null; jocAuthoriserRole: string | null; jocOnRoster: boolean | null; jocReason: string | null; jocAt: string | null;
};
/** On duty now as stand-by officer or duty officer: who may authorise the JOC from the roster. */
export type RosterAuthoriser = { name: string; duty: string };

const CARD: Record<CoordinationLevel, { rail: string; title: string }> = {
  Bronze: { rail: 'border-l-[#b0753a]', title: 'text-[#b0753a]' },
  Silver: { rail: 'border-l-[#9aa6b2]', title: 'text-[#7c8794]' },
  Gold: { rail: 'border-l-[#d4a72c]', title: 'text-[#b8901f]' },
};
const NEXT_UP: Record<CoordinationLevel, CoordinationLevel | null> = { Bronze: 'Silver', Silver: 'Gold', Gold: null };
const NEXT_DOWN: Record<CoordinationLevel, CoordinationLevel | null> = { Bronze: null, Silver: 'Bronze', Gold: 'Silver' };
/** Who decides each step down (revision 2, section 2). */
const DOWN_DECIDES: Record<string, string> = {
  Silver: 'The JOC chair with the JOC commander, when strategic coordination is no longer needed.',
  Bronze: 'The EOC commander with the Principal DM Stand-by Officer, when the EOC closes.',
};

/**
 * The incident's level, as the process sets it out: the level and what it
 * means, what triggered it, the FCP and EOC with their commanders, the JOC's
 * authoriser at Gold, and one button up (with its reasons ticked) and one
 * down (with the reason). "What moves this incident up a level?" folds out.
 */
export function LevelCard({ incidentId, facts, changes, roster, warning4, live, onError }: {
  incidentId: string; facts: LevelFacts; changes: BoardLevelChange[]; roster: RosterAuthoriser[]; warning4: boolean; live: boolean;
  onError: (e: string) => void;
}) {
  const { t } = useT();
  const [moving, setMoving] = useState<CoordinationLevel | null>(null);
  const level = LEVELS.find((l) => l.level === facts.level)!;
  const up = NEXT_UP[facts.level];
  const down = NEXT_DOWN[facts.level];
  const raisedHere = [...changes].reverse().find((c) => c.to === facts.level && levelRank(c.to) > levelRank(c.from));
  const triggered = facts.level === 'Bronze'
    ? [...LEVEL_TRIGGERS.Bronze.filter((x) => x.auto).map((x) => x.label), ...(facts.fcp ? [triggerLabel('b_fcp')] : [])]
    : (raisedHere?.triggers ?? []).map(triggerLabel);
  const activeOnly = facts.dmStatus === 'Active';

  return (
    <Fold id="board.level" className={cn('border-l-4', CARD[facts.level].rail)} icon={ShieldCheck}
      title={<span className={cn('text-lg font-bold', CARD[facts.level].title)}>{t(level.title)}</span>}
      summary={t(level.means)}
      info={t('How this incident is coordinated. Bronze: the services on scene at an FCP. Silver: a joint EOC. Gold: the JOC at the Disaster Operations Centre. Moving up needs at least one reason ticked.')}>
      <div className="space-y-4 p-5">
        <p className="text-sm text-muted-foreground">{t(level.means)}</p>

        <div className="rounded-lg bg-bg-soft p-4">
          <p className="text-sm font-semibold">{t('Triggered by')}</p>
          {triggered.length ? (
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">{triggered.map((x) => <li key={x}>{t(x)}</li>)}</ul>
          ) : <p className="mt-1 text-sm text-muted-foreground">{t('Set before reasons were recorded.')}</p>}
          {raisedHere ? <p className="mt-2 text-xs text-muted-foreground">{t('Raised {at} by {by}', { at: formatSaTime(raisedHere.at), by: raisedHere.by ?? '—' })}</p> : null}
        </div>

        {facts.level === 'Gold' ? (
          <div className="rounded-lg border border-[#d4a72c]/50 p-4 text-sm">
            <p><span className="text-muted-foreground">{t('JOC authorised by')}</span> <b>{facts.jocAuthorisedBy ?? '—'}</b>{facts.jocAuthoriserRole ? ` (${t(facts.jocAuthoriserRole)})` : ''}</p>
            {facts.jocReason ? <p className="mt-1"><span className="text-muted-foreground">{t('Reason')}</span> {facts.jocReason}</p> : null}
            {facts.jocOnRoster === false ? (
              <p className="mt-1 flex items-center gap-1.5 text-severity-medium-ink"><TriangleAlert className="h-4 w-4" aria-hidden />{t('Not on today’s duty roster as stand-by or duty officer.')}</p>
            ) : null}
            {facts.jocAt ? <p className="mt-1 text-xs text-muted-foreground">{t('JOC activated {at}', { at: formatSaTime(facts.jocAt) })}</p> : null}
          </div>
        ) : null}

        <Places incidentId={incidentId} facts={facts} live={live} onError={onError} />

        {live && activeOnly ? (
          <div className="flex flex-wrap gap-3">
            {up ? (
              <button type="button" onClick={() => setMoving(up)} data-guide="board.escalate"
                className={cn('inline-flex h-12 items-center gap-2 rounded-md px-5 font-semibold',
                  up === 'Gold' ? 'bg-[#d4a72c] text-slate-950 hover:bg-[#c99b22]' : 'border border-border bg-bg-card hover:bg-muted')}>
                <ArrowUp className="h-4 w-4" aria-hidden />{up === 'Gold' ? t('Activate JOC (Gold)') : t('Escalate to Silver')}
              </button>
            ) : null}
            {facts.level === 'Bronze' ? (
              <button type="button" onClick={() => setMoving('Gold')}
                className="inline-flex h-12 items-center gap-2 rounded-md bg-[#d4a72c] px-5 font-semibold text-slate-950 hover:bg-[#c99b22]">
                <ArrowUp className="h-4 w-4" aria-hidden />{t('Activate JOC (Gold)')}
              </button>
            ) : null}
            {down ? (
              <button type="button" onClick={() => setMoving(down)} className="inline-flex h-12 items-center gap-2 rounded-md border border-border px-5 font-semibold hover:bg-muted">
                <ArrowDown className="h-4 w-4" aria-hidden />{t('Step down to {level}', { level: down })}
              </button>
            ) : null}
          </div>
        ) : live && !activeOnly ? (
          <p className="text-sm text-muted-foreground">{t('The incident is {status}. Reopen it to change its level.', { status: t(facts.dmStatus).toLowerCase() })}</p>
        ) : null}

        <details className="rounded-lg border border-border">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">{t('What moves this incident up a level?')}</summary>
          <div className="space-y-3 px-4 pb-4 text-sm">
            {(['Silver', 'Gold'] as const).map((l) => (
              <div key={l}>
                <p className="font-semibold">{t(LEVELS.find((x) => x.level === l)!.title)}</p>
                <p className="text-muted-foreground">{t(LEVEL_DECIDES[l])}</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">{LEVEL_TRIGGERS[l].map((x) => <li key={x.key}>{t(x.label)}</li>)}</ul>
              </div>
            ))}
          </div>
        </details>
      </div>
      {moving ? (
        <MoveDialog incidentId={incidentId} from={facts.level} to={moving} roster={roster} warning4={warning4}
          onClose={() => setMoving(null)} />
      ) : null}
    </Fold>
  );
}

/** The FCP (Bronze) and the EOC (Silver), each with its commander. */
function Places({ incidentId, facts, live, onError }: { incidentId: string; facts: LevelFacts; live: boolean; onError: (e: string) => void }) {
  const { t } = useT();
  const [pending, start] = useTransition();
  const [v, setV] = useState({
    fcp_location: facts.fcp ?? '', fcp_commander: facts.fcpCommander ?? '', eoc_location: facts.eoc ?? '', eoc_commander: facts.eocCommander ?? '',
  });
  const dirty = v.fcp_location !== (facts.fcp ?? '') || v.fcp_commander !== (facts.fcpCommander ?? '')
    || v.eoc_location !== (facts.eoc ?? '') || v.eoc_commander !== (facts.eocCommander ?? '');
  const showEoc = levelRank(facts.highestLevel) >= 2 || Boolean(facts.eoc);
  const save = () => start(async () => {
    const res = await levelPlacesAction(incidentId, v);
    if ('error' in res) onError(res.error);
  });
  const field = 'h-11 w-full rounded-md border border-border bg-bg-soft px-3 text-[15px] disabled:opacity-70';
  const row = (label: string, key: keyof typeof v, placeholder: string) => (
    <label className="grid gap-1 text-sm sm:grid-cols-[12rem_1fr] sm:items-center">
      <span className="text-muted-foreground">{label}</span>
      <input value={v[key]} onChange={(e) => setV({ ...v, [key]: e.target.value })} disabled={!live} maxLength={key.endsWith('commander') ? 160 : 200}
        placeholder={placeholder} className={field} />
    </label>
  );
  return (
    <div className="space-y-2">
      {row(t('Forward Control Point'), 'fcp_location', t('FCP location'))}
      {row(t('On-scene commander'), 'fcp_commander', t('Name and service'))}
      {showEoc ? row(t('Emergency Operations Centre'), 'eoc_location', t('EOC location')) : null}
      {showEoc ? row(t('EOC commander'), 'eoc_commander', t('Name and service')) : null}
      {live && dirty ? (
        <button type="button" onClick={save} disabled={pending} className="h-11 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          {pending ? t('Saving…') : t('Save')}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Moving the level. Up: tick the reasons for the new level; Silver records
 * the EOC and its commander, Gold who authorised the JOC (someone on duty
 * now as stand-by or duty officer, or a named senior manager) and why.
 * Down: the reason. Also opened by Criti's level advice.
 */
export function MoveDialog({ incidentId, from, to, roster, warning4, why, onClose }: {
  incidentId: string; from: CoordinationLevel; to: CoordinationLevel; roster: RosterAuthoriser[]; warning4: boolean; why?: string;
  onClose: () => void;
}) {
  const { t } = useT();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const goingUp = levelRank(to) > levelRank(from);
  const [ticks, setTicks] = useState<string[]>(() => (to === 'Gold' && warning4 ? ['g_saws4'] : []));
  const authorisers = roster.filter((r) => r.duty in ROSTER_AUTHORISERS);
  const [who, setWho] = useState<string>(authorisers.length ? '0' : 'other');
  const [role, setRole] = useState<string>('');
  const [name, setName] = useState('');
  const [place, setPlace] = useState('');
  const [commander, setCommander] = useState('');
  const [reason, setReason] = useState(why ?? '');

  const picked = who !== 'other' ? authorisers[Number(who)] : null;
  const ready = goingUp
    ? ticks.length > 0 && (to !== 'Gold' || (reason.trim() && (picked || (role && name.trim()))))
    : Boolean(reason.trim());
  const save = () => start(async () => {
    setError(null);
    const fields: Record<string, unknown> = { reason: reason.trim() || null };
    if (goingUp) {
      fields.triggers = ticks;
      if (to === 'Silver') Object.assign(fields, { place: place.trim() || null, commander: commander.trim() || null });
      if (to === 'Gold') Object.assign(fields, picked
        ? { authorised_by: picked.name, authoriser_role: ROSTER_AUTHORISERS[picked.duty] }
        : { authorised_by: name.trim(), authoriser_role: role });
    }
    const res = await escalateAction(incidentId, to, fields);
    if ('error' in res) { setError(res.error); return; }
    onClose();
  });

  const title = goingUp ? (to === 'Gold' ? t('Activate the JOC (Gold)') : t('Escalate to Silver')) : t('Step down to {level}', { level: to });
  const field = 'mt-1 h-11 w-full rounded-md border border-border bg-bg-soft px-3 text-[15px]';
  return (
    <Modal title={title} onClose={onClose} busy={pending} wide
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={pending} className="h-11 rounded-md border border-border px-5 text-sm font-semibold hover:bg-muted">{t('Cancel')}</button>
          <button type="button" onClick={save} disabled={pending || !ready}
            className={cn('h-11 rounded-md px-5 text-sm font-semibold disabled:opacity-50', to === 'Gold' && goingUp ? 'bg-[#d4a72c] text-slate-950' : 'bg-primary text-primary-foreground')}>
            {pending ? t('Saving…') : title}
          </button>
        </div>
      )}>
      <div className="space-y-4">
        {error ? <p role="alert" className="rounded-md border border-severity-critical px-3 py-2 text-sm font-medium text-severity-critical-ink">{error}</p> : null}
        {goingUp ? (
          <>
            <fieldset>
              <legend className="text-sm font-semibold">{t('Why does it move up? Tick at least one.')}</legend>
              <div className="mt-2 space-y-1.5">
                {LEVEL_TRIGGERS[to].map((x) => (
                  <label key={x.key} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-border px-3 py-2 hover:bg-muted">
                    <input type="checkbox" checked={ticks.includes(x.key)} className="mt-0.5 h-5 w-5 shrink-0"
                      onChange={(e) => setTicks(e.target.checked ? [...ticks, x.key] : ticks.filter((k) => k !== x.key))} />
                    <span className="text-sm">{t(x.label)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {to === 'Silver' ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium">{t('Where is the EOC?')}
                  <input value={place} onChange={(e) => setPlace(e.target.value)} maxLength={200} className={field} />
                </label>
                <label className="block text-sm font-medium">{t('EOC commander')}
                  <input value={commander} onChange={(e) => setCommander(e.target.value)} maxLength={160} placeholder={t('Name and service')} className={field} />
                </label>
              </div>
            ) : null}
            {to === 'Gold' ? (
              <fieldset className="space-y-2">
                <legend className="text-sm font-semibold">{t('Who authorised the JOC?')}</legend>
                <p className="text-xs text-muted-foreground">{t(LEVEL_DECIDES.Gold)}</p>
                {authorisers.map((a, i) => (
                  <label key={`${a.name}-${a.duty}`} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3 hover:bg-muted">
                    <input type="radio" name="who" checked={who === String(i)} onChange={() => setWho(String(i))} className="h-5 w-5" />
                    <span className="text-sm"><b>{a.name}</b> · {t(a.duty)} {t('(on duty now)')}</span>
                  </label>
                ))}
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3 hover:bg-muted">
                  <input type="radio" name="who" checked={who === 'other'} onChange={() => setWho('other')} className="h-5 w-5" />
                  <span className="text-sm">{t('Someone else')}</span>
                </label>
                {who === 'other' ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-sm font-medium">{t('Their role')}
                      <select value={role} onChange={(e) => setRole(e.target.value)} className={field}>
                        <option value="">{t('Choose')}</option>
                        {JOC_AUTHORISERS.map((r) => <option key={r} value={r}>{t(r)}</option>)}
                      </select>
                    </label>
                    <label className="block text-sm font-medium">{t('Their name')}
                      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={160} className={field} />
                    </label>
                  </div>
                ) : null}
              </fieldset>
            ) : null}
            {to === 'Gold' ? (
              <label className="block text-sm font-medium">{t('Why is the JOC activated?')}
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500}
                  className="mt-1 w-full rounded-md border border-border bg-bg-soft px-3 py-2 text-[15px]" />
              </label>
            ) : null}
          </>
        ) : (
          <>
            <p className="rounded-md bg-muted px-3 py-2 text-sm">{t(DOWN_DECIDES[to] ?? '')}</p>
            <label className="block text-sm font-medium">{t('Why does it come down?')}
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500}
                className="mt-1 w-full rounded-md border border-border bg-bg-soft px-3 py-2 text-[15px]" />
            </label>
          </>
        )}
      </div>
    </Modal>
  );
}
