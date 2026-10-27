'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { HAZARD_GROUPS } from '@criticom/db/disaster-plan';
import { LEVEL_TRIGGERS } from '@criticom/db/disaster-joc';
import { CritiMascot } from '@/components/criti/mascot';
import { useT } from '@/components/i18n';
import { cn } from '@/lib/utils';
import { guideStatusAction, practiceStepAction, startPracticeAction } from '../guide-actions';

type Practice = {
  id: string; title: string; hazard: string; severity: string; place: string | null; ward: number | null;
  level: string; status: string; steps: string[];
};

const STAGES = [
  { key: 'added', label: 'Add the incident' },
  { key: 'escalate', label: 'Move it up a level' },
  { key: 'update', label: 'Log what came in' },
  { key: 'relief', label: 'Relief for a ward' },
  { key: 'stand_down', label: 'Stand it down' },
] as const;

/** Criti's words for each stage, and where the same thing is on a real incident. */
const SAYS: Record<string, { text: string; real: string }> = {
  added: {
    text: 'Let’s add an incident. Give it a short title, choose the hazard (the top ten risks are first), and say where it is and what happened.',
    real: 'On a real call: Disaster desk, then Add an incident. Calls from EMACC arrive by themselves.',
  },
  escalate: {
    text: 'Every incident starts at Bronze, with the services on scene. Several agencies now need one command at the site: tick why, then move it to Silver. Without a reason ticked, it will not move.',
    real: 'On a real incident: the level card, then Escalate to Silver or Activate JOC (Gold).',
  },
  update: {
    text: 'A sitrep came in by radio. Write it down as it was said: who, what, and what they need.',
    real: 'On a real incident: Log what came in. It goes on the timeline and Criti reads it.',
  },
  relief: {
    text: 'Families in a ward need help. Record the ward and how many people were helped. Relief always goes through the ward councillor.',
    real: 'On a real incident: Needs assessment and relief, then Add ward beneficiaries.',
  },
  stand_down: {
    text: 'The water has gone down and the services are leaving. Stand the incident down, and say why.',
    real: 'On a real incident: the Status bar, then Stand down. It moves to Recovery and review.',
  },
};

export function PracticeWizard({ practice }: { practice: Practice | null }) {
  const { t } = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [again, setAgain] = useState(false);
  const active = practice && practice.status === 'Active' ? practice : null;
  const finished = practice && practice.status !== 'Active' && !again ? practice : null;
  const wasFinished = practice && practice.status !== 'Active';
  const done = new Set(active?.steps ?? finished?.steps ?? []);
  const next = active ? (STAGES.find((s) => !done.has(s.key))?.key ?? 'stand_down') : 'added';

  // Finishing a practice marks it done on the account (the tour stops asking).
  useEffect(() => {
    if (wasFinished) void guideStatusAction('disaster.practice', 'done');
  }, [wasFinished]);

  const run = (fn: () => Promise<{ error: string } | object>) => start(async () => {
    setError(null);
    const res = await fn();
    if ('error' in res && typeof res.error === 'string') { setError(res.error); return; }
    setAgain(false);
    router.refresh();
  });

  return (
    <div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
      <ol className="space-y-2">
        {STAGES.map((s, n) => {
          const ok = done.has(s.key) || Boolean(finished);
          const here = !finished && s.key === next;
          return (
            <li key={s.key} className={cn('flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm',
              here ? 'border-accent bg-accent/10 font-semibold' : 'border-border bg-bg-card')}>
              <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold',
                ok ? 'bg-severity-low text-white' : here ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground')}>
                {ok ? <Check className="h-4 w-4" aria-hidden /> : n + 1}
              </span>
              {t(s.label)}
            </li>
          );
        })}
      </ol>

      <section className="space-y-4 rounded-2xl border border-border bg-bg-card p-5 shadow-sm">
        {active ? (
          <p className="text-sm text-muted-foreground">
            {t('Practice incident: {title} · {level}', { title: active.title, level: active.level })}{active.ward ? ` · ${t('Ward {w}', { w: active.ward })}` : ''}
          </p>
        ) : null}
        {finished ? (
          <div className="space-y-4">
            <Criti text={t('Well done. You added an incident, moved it up a level with its reason, logged what came in, recorded relief for a ward and stood it down. That is the desk’s day.')} />
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setAgain(true)}
                className="h-12 rounded-md border border-border px-5 font-semibold hover:bg-muted">{t('Practise again')}</button>
              <Link href="/disaster/desk" className="inline-flex h-12 items-center rounded-md bg-primary px-5 font-semibold text-primary-foreground">{t('Go to the Disaster desk')}</Link>
            </div>
          </div>
        ) : (
          <>
            <Criti text={t(SAYS[next]!.text)} />
            <p className="text-xs text-muted-foreground">{t(SAYS[next]!.real)}</p>
            {error ? <p role="alert" className="rounded-md border border-severity-critical px-3 py-2 text-sm font-medium text-severity-critical-ink">{error}</p> : null}
            {next === 'added' ? <AddForm pending={pending} onSave={(v) => run(() => startPracticeAction(v))} /> : null}
            {active && next === 'escalate' ? <EscalateForm pending={pending} onSave={(triggers) => run(() => practiceStepAction(active.id, 'escalate', { to: 'Silver', triggers }))} /> : null}
            {active && next === 'update' ? <TextForm pending={pending} label={t('What came in')} placeholder={t('For example: Fire Station 3 on scene, 20 homes flooded, need a hall for 60 people')}
              button={t('Log update')} onSave={(text) => run(() => practiceStepAction(active.id, 'update', { text }))} /> : null}
            {active && next === 'relief' ? <ReliefForm pending={pending} ward={active.ward} onSave={(ward, people) => run(() => practiceStepAction(active.id, 'relief', { ward, people }))} /> : null}
            {active && next === 'stand_down' ? <TextForm pending={pending} label={t('Why does it stand down?')} placeholder={t('For example: water down, services left, families in the hall')}
              button={t('Stand down')} onSave={(reason) => run(() => practiceStepAction(active.id, 'stand_down', { reason }))} /> : null}
          </>
        )}
      </section>
    </div>
  );
}

function Criti({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-accent/10 p-4">
      <CritiMascot className="h-12 w-12 shrink-0" />
      <p className="text-[15px] leading-relaxed">{text}</p>
    </div>
  );
}

const field = 'mt-1 h-12 w-full rounded-md border border-border bg-bg-soft px-3 text-[15px]';

function AddForm({ pending, onSave }: { pending: boolean; onSave: (v: Record<string, string>) => void }) {
  const { t } = useT();
  const [v, setV] = useState({ title: 'Practice: flooding in Umlazi', hazard: 'Floods', severity: 'High', place: 'Umlazi J Section', ward: '88', first_report: 'Water in homes after heavy rain' });
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">{t('Short title')}<input value={v.title} maxLength={80} onChange={(e) => setV({ ...v, title: e.target.value })} className={field} /></label>
        <label className="block text-sm font-medium">{t('Hazard')}
          <select value={v.hazard} onChange={(e) => setV({ ...v, hazard: e.target.value })} className={field}>
            {HAZARD_GROUPS.map((g) => <optgroup key={g.group} label={t(g.group)}>{g.hazards.map((h) => <option key={h} value={h}>{t(h)}</option>)}</optgroup>)}
          </select>
        </label>
        <label className="block text-sm font-medium">{t('Where')}<input value={v.place} maxLength={200} onChange={(e) => setV({ ...v, place: e.target.value })} className={field} /></label>
        <label className="block text-sm font-medium">{t('Ward')}<input value={v.ward} inputMode="numeric" maxLength={3} onChange={(e) => setV({ ...v, ward: e.target.value.replace(/\D/g, '') })} className={field} /></label>
      </div>
      <label className="block text-sm font-medium">{t('First report')}
        <textarea value={v.first_report} maxLength={2000} rows={3} onChange={(e) => setV({ ...v, first_report: e.target.value })}
          className="mt-1 w-full rounded-md border border-border bg-bg-soft px-3 py-2 text-[15px]" />
      </label>
      <button type="button" disabled={pending || !v.title.trim()} onClick={() => onSave(v)}
        className="h-12 rounded-md bg-primary px-6 font-semibold text-primary-foreground disabled:opacity-50">{t('Add the practice incident')}</button>
    </div>
  );
}

function EscalateForm({ pending, onSave }: { pending: boolean; onSave: (triggers: string[]) => void }) {
  const { t } = useT();
  const [ticks, setTicks] = useState<string[]>([]);
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold">{t('Why does it move up? Tick at least one.')}</p>
      {LEVEL_TRIGGERS.Silver.map((x) => (
        <label key={x.key} className="flex min-h-12 cursor-pointer items-start gap-3 rounded-md border border-border px-3 py-2 hover:bg-muted">
          <input type="checkbox" checked={ticks.includes(x.key)} className="mt-0.5 h-5 w-5 shrink-0"
            onChange={(e) => setTicks(e.target.checked ? [...ticks, x.key] : ticks.filter((k) => k !== x.key))} />
          <span className="text-sm">{t(x.label)}</span>
        </label>
      ))}
      <button type="button" disabled={pending || ticks.length === 0} onClick={() => onSave(ticks)}
        className="h-12 rounded-md bg-primary px-6 font-semibold text-primary-foreground disabled:opacity-50">{t('Escalate to Silver')}</button>
    </div>
  );
}

function TextForm({ pending, label, placeholder, button, onSave }: { pending: boolean; label: string; placeholder: string; button: string; onSave: (text: string) => void }) {
  const [text, setText] = useState('');
  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium">{label}
        <textarea value={text} maxLength={2000} rows={3} placeholder={placeholder} onChange={(e) => setText(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-bg-soft px-3 py-2 text-[15px]" />
      </label>
      <button type="button" disabled={pending || !text.trim()} onClick={() => onSave(text)}
        className="h-12 rounded-md bg-primary px-6 font-semibold text-primary-foreground disabled:opacity-50">{button}</button>
    </div>
  );
}

function ReliefForm({ pending, ward, onSave }: { pending: boolean; ward: number | null; onSave: (ward: string, people: string) => void }) {
  const { t } = useT();
  const [v, setV] = useState({ ward: ward ? String(ward) : '', people: '' });
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">{t('Ward')}<input value={v.ward} inputMode="numeric" maxLength={3} onChange={(e) => setV({ ...v, ward: e.target.value.replace(/\D/g, '') })} className={field} /></label>
        <label className="block text-sm font-medium">{t('People helped')}<input value={v.people} inputMode="numeric" maxLength={6} onChange={(e) => setV({ ...v, people: e.target.value.replace(/\D/g, '') })} className={field} /></label>
      </div>
      <button type="button" disabled={pending || !v.ward || !v.people} onClick={() => onSave(v.ward, v.people)}
        className="h-12 rounded-md bg-primary px-6 font-semibold text-primary-foreground disabled:opacity-50">{t('Record the relief')}</button>
    </div>
  );
}
