'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import type { FirePremises } from '@criticom/api';
import {
  FIRE_INSPECTION_GROUPS, FIRE_INSPECTION_ITEMS, INSPECTION_KINDS, INSTRUCTIONS, NOTICE_DAYS, OCCUPANCIES, RISKS, SERVED,
  daysWords, failingItems, followUp, inspectionPayload, inspectionProblems, noticeDays, outcomeOf, usualRisk,
  type InspectionAnswer, type InspectionDraft,
} from '@criticom/db/fire-inspection';
import { useT } from '@/components/i18n';
import { cn } from '@/lib/utils';
import { fileSiteInspectionAction } from '../actions';

const field = 'mt-1 h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm';
const label = 'text-xs font-bold uppercase tracking-wider text-muted-foreground';

/**
 * A site inspection filed from the console (0106): the same checks, rules and
 * dates as the phone's. Kept in the page while it is filled in, so nothing is
 * lost when the server says something needs fixing.
 */
export function InspectionForm({ premises, lastNotice, clientRef }: {
  premises: FirePremises | null;
  /** The faults the last notice named, checked again first. */
  lastNotice: string[];
  clientRef: string;
}) {
  const { t } = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<string[]>([]);
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [riskChosen, setRiskChosen] = useState(false);
  const [draft, setDraft] = useState<InspectionDraft>({
    premises_id: premises?.id ?? null,
    kind: premises?.last_outcome && premises.last_outcome !== 'Compliant' ? 'Re-inspection' : 'Routine',
    contact_person: premises?.contact_person ?? '',
    contact_number: premises?.contact_number ?? '',
  });
  const set = <K extends keyof InspectionDraft>(k: K, v: InspectionDraft[K]) => setDraft((cur) => ({ ...cur, [k]: v }));
  const onNotice = useMemo(() => new Set(lastNotice), [lastNotice]);
  const failing = failingItems(draft.checklist);
  const outcome = outcomeOf(draft);
  const dates = followUp({ ...draft, risk: premises?.risk ?? draft.risk });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const problems = inspectionProblems(draft);
    setMarked(new Set(problems.flatMap((p) => p.keys)));
    if (problems.length) { setErrors(problems.map((p) => t(p.message))); return; }
    setErrors([]);
    start(async () => {
      const res = await fileSiteInspectionAction(clientRef, inspectionPayload(draft));
      if (res.ok) router.push(`/fire/inspections/${res.id}`);
      else setErrors([res.error]);
    });
  };

  const choice = (on: boolean, text: string, onClick: () => void, tone = 'bg-accent text-white border-accent', bad = false) => (
    <button
      key={text}
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn('rounded-full border px-3 py-1.5 text-sm font-semibold', on ? tone : 'border-border bg-bg-soft hover:bg-muted', bad && !on && 'border-severity-critical')}
    >
      {text}
    </button>
  );

  return (
    <form onSubmit={submit} className="space-y-4">
      <section className="rounded-lg border border-border bg-bg-card p-5">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">{t('Site')}</h2>
        {premises ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <div><p className="text-lg font-bold">{premises.name}</p><p className="text-sm text-muted-foreground">{premises.address}</p></div>
            <div className="text-sm">
              <p>{t('Used as')}: <strong>{t(premises.occupancy)}</strong> · {t('Risk')}: <strong>{t(premises.risk)}</strong></p>
              <p className="text-muted-foreground">{premises.last_outcome ? t(premises.last_outcome) : t('Never inspected')}{premises.next_due ? ` · ${t('due {date}', { date: premises.next_due })}` : ''}</p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block"><span className={label}>{t('Business or site name')}</span>
              <input className={cn(field, marked.has('name') && 'border-severity-critical')} value={draft.name ?? ''} onChange={(e) => set('name', e.target.value)} /></label>
            <label className="block"><span className={label}>{t('Address')}</span>
              <input className={cn(field, marked.has('address') && 'border-severity-critical')} value={draft.address ?? ''} onChange={(e) => set('address', e.target.value)} /></label>
            <label className="block"><span className={label}>{t('Used as')}</span>
              <select className={cn(field, marked.has('occupancy') && 'border-severity-critical')} value={draft.occupancy ?? ''}
                onChange={(e) => setDraft((cur) => ({ ...cur, occupancy: e.target.value, risk: riskChosen ? cur.risk : usualRisk(e.target.value) }))}>
                <option value="">{t('Choose')}</option>
                {OCCUPANCIES.map((o) => <option key={o} value={o}>{t(o)}</option>)}
              </select></label>
            <label className="block"><span className={label}>{t('Risk')}</span>
              <select className={cn(field, marked.has('risk') && 'border-severity-critical')} value={draft.risk ?? ''}
                onChange={(e) => { setRiskChosen(true); set('risk', e.target.value); }}>
                <option value="">{t('Choose')}</option>
                {RISKS.map((r) => <option key={r} value={r}>{t(r)}</option>)}
              </select></label>
          </div>
        )}
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="block"><span className={label}>{t('Why')}</span>
            <select className={cn(field, marked.has('kind') && 'border-severity-critical')} value={draft.kind ?? ''} onChange={(e) => set('kind', e.target.value)}>
              {INSPECTION_KINDS.map((k) => <option key={k} value={k}>{t(k)}</option>)}
            </select></label>
          <label className="block"><span className={label}>{t('Contact person')}</span>
            <input className={field} value={draft.contact_person ?? ''} onChange={(e) => set('contact_person', e.target.value)} /></label>
          <label className="block"><span className={label}>{t('Contact number')}</span>
            <input className={cn(field, marked.has('contact_number') && 'border-severity-critical')} value={draft.contact_number ?? ''} onChange={(e) => set('contact_number', e.target.value)} /></label>
        </div>
      </section>

      {FIRE_INSPECTION_GROUPS.map((g) => (
        <section key={g.id} className="rounded-lg border border-border bg-bg-card">
          <header className="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">{t(g.title)}</h2>
            <button type="button" className="text-sm font-semibold text-accent hover:underline"
              onClick={() => setDraft((cur) => ({ ...cur, checklist: { ...(cur.checklist ?? {}), ...Object.fromEntries(g.items.map((i) => [i.key, 'yes'])) } }))}>
              {t('All yes')}</button>
          </header>
          <ul className="divide-y divide-border">
            {g.items.map((i) => {
              const a = draft.checklist?.[i.key];
              return (
                <li key={i.key} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-[240px] flex-1">
                    <p className={cn('text-sm font-semibold', marked.has(i.key) && !a && 'text-severity-critical-ink')}>{t(i.label)}</p>
                    <p className="text-xs text-muted-foreground">{i.section}{onNotice.has(i.key) ? <span className="ml-2 font-bold text-severity-high-ink">{t('On the last notice')}</span> : null}</p>
                  </div>
                  <div className="flex gap-1.5">
                    {(['yes', 'no', ...(i.na ? ['na'] : [])] as InspectionAnswer[]).map((v) => choice(
                      a === v, v === 'yes' ? t('Yes') : v === 'no' ? t('No') : t('N/A'),
                      () => setDraft((cur) => ({ ...cur, checklist: { ...(cur.checklist ?? {}), [i.key]: v } })),
                      v === 'yes' ? 'bg-severity-low text-white border-severity-low' : v === 'no' ? 'bg-severity-critical text-white border-severity-critical' : 'bg-muted border-border',
                      marked.has(i.key) && !a,
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <section className={cn('rounded-lg border bg-bg-card p-5', failing.length ? 'border-severity-high/50' : 'border-severity-low/50')}>
        <h2 className="text-lg font-bold">{failing.length ? t('Compliance notice') : t('Compliant')}</h2>
        {failing.length ? (
          <>
            <p className="text-sm text-muted-foreground">{t('Choose how long the owner has to put each fault right.')}</p>
            <ul className="mt-3 divide-y divide-border">
              {noticeDays(draft).map(({ item, days }) => (
                <li key={item.key} className="flex flex-wrap items-center gap-3 py-2">
                  <div className="min-w-[240px] flex-1">
                    <p className="text-sm font-semibold">{t(item.label)}</p>
                    <p className="text-xs text-muted-foreground">{item.section} · {t(item.remedy)}</p>
                  </div>
                  <select className="h-9 rounded-md border border-border bg-bg-soft px-2 text-sm" value={days}
                    onChange={(e) => setDraft((cur) => ({ ...cur, days: { ...(cur.days ?? {}), [item.key]: Number(e.target.value) } }))}>
                    {NOTICE_DAYS.map((d) => <option key={d} value={d}>{t(daysWords(d))}</option>)}
                  </select>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm">{t('Put right by')} <strong>{dates.complyBy}</strong> · {t('back to check on')} <strong>{dates.reinspectOn}</strong></p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t('Every check passed so far. Next visit due {date}.', { date: dates.nextDue })}</p>
        )}
        <div className="mt-4">
          <p className={label}>{t('A danger that cannot wait?')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {choice(!draft.instruction, t('No'), () => set('instruction', null))}
            {INSTRUCTIONS.map((i) => choice(draft.instruction === i, t(i), () => set('instruction', i), 'bg-severity-critical text-white border-severity-critical'))}
          </div>
          {draft.instruction ? (
            <label className="mt-3 block"><span className={label}>{t('Why')}</span>
              <textarea rows={2} className={cn('mt-1 w-full rounded-md border border-border bg-bg-soft px-3 py-2 text-sm', marked.has('instruction_reason') && 'border-severity-critical')}
                value={draft.instruction_reason ?? ''} onChange={(e) => set('instruction_reason', e.target.value)} /></label>
          ) : null}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-bg-card p-5">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">{t('Sign off')}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {outcome !== 'Compliant' ? (
            <label className="block"><span className={label}>{t('How the notice was served')}</span>
              <select className={cn(field, marked.has('served') && 'border-severity-critical')} value={draft.served ?? ''} onChange={(e) => set('served', e.target.value)}>
                <option value="">{t('Choose')}</option>
                {SERVED.map((s) => <option key={s} value={s}>{t(s)}</option>)}
              </select></label>
          ) : null}
          <label className="block"><span className={label}>{outcome === 'Compliant' ? t('Person in charge (optional)') : t('Person in charge')}</span>
            <input className={cn(field, marked.has('person_in_charge') && 'border-severity-critical')} value={draft.person_in_charge ?? ''} onChange={(e) => set('person_in_charge', e.target.value)} /></label>
          <label className="block sm:col-span-2"><span className={label}>{t('Notes (optional)')}</span>
            <textarea rows={3} className="mt-1 w-full rounded-md border border-border bg-bg-soft px-3 py-2 text-sm" value={draft.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></label>
        </div>
      </section>

      {errors.length ? (
        <div role="alert" className="rounded-lg border border-severity-critical/40 bg-severity-critical/10 px-4 py-3 text-sm text-severity-critical-ink">
          {errors.map((e) => <p key={e}>{e}</p>)}
        </div>
      ) : null}
      <p className="text-sm text-muted-foreground">{t('{answered} of {total} checked', { answered: FIRE_INSPECTION_ITEMS.filter((i) => draft.checklist?.[i.key]).length, total: FIRE_INSPECTION_ITEMS.length })}</p>
      <button type="submit" disabled={pending} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-semibold disabled:opacity-60">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{t('File inspection')}
      </button>
    </form>
  );
}
