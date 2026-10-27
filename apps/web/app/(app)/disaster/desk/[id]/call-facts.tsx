'use client';

import { useState, useTransition } from 'react';
import { FileText, Pencil } from 'lucide-react';
import { HAZARD_GROUPS, HAZARDS, MUNICIPALITIES, type CoordinationLevel } from '@criticom/db/disaster-plan';
import { useT } from '@/components/i18n';
import { Fold } from '@/components/disaster/fold';
import { cn } from '@/lib/utils';
import { setCallAction } from '../actions';

/**
 * The call as the desk names it (0112): a short title, the hazard and the
 * municipalities affected. The level, the FCP and the EOC are on the level
 * card (level-card.tsx, 0117).
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

  const save = () => start(async () => {
    const res = await setCallAction({ incidentId, shortTitle: title, hazard, municipalities: munis });
    if ('error' in res) onError(res.error);
    else setEditing(false);
  });
  const field = 'h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm';

  return (
    <Fold id="board.details" icon={FileText} title={t('Title, hazard and area')} bodyClassName="p-5" defaultOpen={false}
      summary={[facts.hazard, facts.municipalities.join(', ')].filter(Boolean).join(' · ')}
      info={t('The incident’s short title, its hazard (the top ten risks first) and the municipalities it affects.')}
      actions={live && !editing ? (
        <button type="button" onClick={() => setEditing(true)}
          className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-sm font-semibold hover:bg-muted">
          <Pencil className="h-4 w-4" aria-hidden />{t('Change')}
        </button>
      ) : null}>
      {!editing ? (
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-muted-foreground">{t('Hazard')}</dt><dd className="font-semibold">{facts.hazard ? t(facts.hazard) : t('Not set yet')}</dd></div>
          <div><dt className="text-xs text-muted-foreground">{t('Municipalities affected')}</dt><dd className="font-semibold">{facts.municipalities.join(', ') || t('Not set yet')}</dd></div>
        </dl>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <label className="block text-sm font-medium">{t('Short title')}
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder={t('For example: Isipingo transformer fire')}
                className={cn(field, 'mt-1')} />
            </label>
            <label className="block text-sm font-medium">{t('Hazard')}
              <select value={hazard} onChange={(e) => setHazard(e.target.value)} className={cn(field, 'mt-1')}>
                <option value="">{t('Choose the hazard')}</option>
                {HAZARD_GROUPS.map((g) => (
                  <optgroup key={g.group} label={t(g.group)}>
                    {g.hazards.map((h) => <option key={h} value={h}>{t(h)}</option>)}
                  </optgroup>
                ))}
                {/* An older call keeps its 2012 name until the desk picks the new one. */}
                {facts.hazard && !HAZARDS.includes(facts.hazard) ? (
                  <optgroup label={t('Earlier names (2012 plan)')}><option value={facts.hazard}>{facts.hazard}</option></optgroup>
                ) : null}
              </select>
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
    </Fold>
  );
}
