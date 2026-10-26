'use client';

import { useState, useTransition } from 'react';
import { Pencil } from 'lucide-react';
import { HAZARD_GROUPS, LEVELS, MUNICIPALITIES, type CoordinationLevel } from '@criticom/db/disaster-plan';
import { useT } from '@/components/i18n';
import { cn } from '@/lib/utils';
import { setCallAction, setLevelAction } from '../actions';

/**
 * The call as the Plan names it (0112): a short title, the hazard, the
 * municipalities affected, the FCP and EOC, and the level of command,
 * control and co-ordination. Gold activates the DOC and calls the SCG into
 * session, so it asks first.
 */

export type BoardFacts = {
  shortTitle: string | null; hazard: string | null; level: CoordinationLevel; highestLevel: CoordinationLevel;
  municipalities: string[]; fcp: string | null; eoc: string | null; docActivatedAt: string | null;
};

export const LEVEL_TONE: Record<CoordinationLevel, string> = {
  Bronze: 'border-[#b0753a] bg-[#b0753a] text-white',
  Silver: 'border-[#9aa6b2] bg-[#9aa6b2] text-slate-950',
  Gold: 'border-[#d4a72c] bg-[#d4a72c] text-slate-950',
};

export function LevelChip({ level }: { level: CoordinationLevel }) {
  return <span className={cn('rounded-full border px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide', LEVEL_TONE[level])}>{level}</span>;
}

export function CallFacts({ incidentId, facts, live, onError }: {
  incidentId: string; facts: BoardFacts; live: boolean; onError: (e: string) => void;
}) {
  const { t } = useT();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(facts.shortTitle ?? '');
  const [hazard, setHazard] = useState(facts.hazard ?? '');
  const [munis, setMunis] = useState<string[]>(facts.municipalities.length ? facts.municipalities : ['eThekwini Metro']);
  const [fcp, setFcp] = useState(facts.fcp ?? '');
  const [eoc, setEoc] = useState(facts.eoc ?? '');

  const save = () => start(async () => {
    const res = await setCallAction({ incidentId, shortTitle: title, hazard, municipalities: munis, fcpLocation: fcp, eocLocation: eoc });
    if ('error' in res) onError(res.error);
    else setEditing(false);
  });
  const level = (to: CoordinationLevel) => {
    if (to === facts.level) return;
    if (to === 'Gold' && !window.confirm(t('Activate the DOC and call the SCG into session?'))) return;
    start(async () => {
      const res = await setLevelAction({ incidentId, level: to });
      if ('error' in res) onError(res.error);
    });
  };
  const field = 'h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm';

  return (
    <section className="rounded-xl border border-border bg-bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('Level of co-ordination')}</p>
          <div className="flex flex-wrap gap-2">
            {LEVELS.map((l) => (
              <button key={l.level} type="button" disabled={!live || pending} onClick={() => level(l.level)} title={l.means}
                aria-pressed={facts.level === l.level}
                className={cn('h-11 rounded-md border px-4 text-sm font-bold disabled:cursor-default',
                  facts.level === l.level ? LEVEL_TONE[l.level] : 'border-border text-muted-foreground hover:bg-muted')}>
                {l.name}
              </button>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">{LEVELS.find((l) => l.level === facts.level)?.means}</p>
          {facts.highestLevel !== facts.level ? (
            <p className="text-xs text-muted-foreground">{t('Highest on this call: {level}', { level: facts.highestLevel })}</p>
          ) : null}
        </div>
        {live && !editing ? (
          <button type="button" onClick={() => setEditing(true)}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-sm font-semibold hover:bg-muted">
            <Pencil className="h-4 w-4" aria-hidden />{t('Title, hazard and area')}
          </button>
        ) : null}
      </div>

      {!editing ? (
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <div><dt className="text-xs text-muted-foreground">{t('Hazard')}</dt><dd className="font-semibold">{facts.hazard ?? t('Not set yet')}</dd></div>
          <div><dt className="text-xs text-muted-foreground">{t('Municipalities affected')}</dt><dd className="font-semibold">{facts.municipalities.join(', ') || t('Not set yet')}</dd></div>
          <div><dt className="text-xs text-muted-foreground">{t('Forward Control Point (FCP)')}</dt><dd className="font-semibold">{facts.fcp ?? '—'}</dd></div>
          <div><dt className="text-xs text-muted-foreground">{t('Emergency Operations Centre (EOC)')}</dt><dd className="font-semibold">{facts.eoc ?? '—'}</dd></div>
        </dl>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <label className="block text-sm font-medium">{t('Short title')}
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder={t('For example: Isipingo transformer fire')}
                className={cn(field, 'mt-1')} />
            </label>
            <label className="block text-sm font-medium">{t('Hazard')}
              <select value={hazard} onChange={(e) => setHazard(e.target.value)} className={cn(field, 'mt-1')}>
                <option value="">{t('Choose the hazard')}</option>
                {HAZARD_GROUPS.map((g) => (
                  <optgroup key={g.group} label={g.group}>
                    {g.hazards.map((h) => <option key={h} value={h}>{h}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium">{t('Forward Control Point (FCP)')}
              <input value={fcp} onChange={(e) => setFcp(e.target.value)} maxLength={200} placeholder={t('Where the services meet on scene')}
                className={cn(field, 'mt-1')} />
            </label>
            <label className="block text-sm font-medium">{t('Emergency Operations Centre (EOC)')}
              <input value={eoc} onChange={(e) => setEoc(e.target.value)} maxLength={200} placeholder={t('Only when one is set up on site')}
                className={cn(field, 'mt-1')} />
            </label>
          </div>
          <div>
            <p className="text-sm font-medium">{t('Municipalities affected')}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {MUNICIPALITIES.map((m) => {
                const on = munis.includes(m);
                return (
                  <button key={m} type="button" aria-pressed={on} onClick={() => setMunis(on ? munis.filter((x) => x !== m) : [...munis, m])}
                    className={cn('h-9 rounded-full border px-3 text-sm font-semibold',
                      on ? 'border-accent bg-accent/15 text-accent' : 'border-border text-muted-foreground hover:bg-muted')}>
                    {m}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={pending || munis.length === 0}
              className="h-11 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
              {pending ? t('Saving…') : t('Save')}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="h-11 rounded-md border border-border px-5 text-sm hover:bg-muted">{t('Cancel')}</button>
          </div>
        </div>
      )}
    </section>
  );
}
