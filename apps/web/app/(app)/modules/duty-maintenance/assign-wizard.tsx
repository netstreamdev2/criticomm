'use client';

import { useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import type { AvailableStaff } from '@criticom/api';
import { tx } from '@criticom/db/i18n';
import { ActionForm } from '@/components/office/action-form';
import { ox } from '@/components/office/styles';
import { useT } from '@/components/i18n';
import { cn } from '@/lib/utils';
import { assignDutyAction } from './actions';

type Sign = { id: string; callSign: string; sectionId: string | null; start: string; stop: string };
type Section = { id: string; code: string; name: string };

const STEPS = [tx('Call sign & section'), tx('Dates & times'), tx('Staff member'), tx('Review & confirm')] as const;

/** The old "Assign / Update Duty" wizard: call sign and section, dates and times, staff, review. */
export function AssignWizard({ signs, sections, staff, today }: { signs: Sign[]; sections: Section[]; staff: AvailableStaff[]; today: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [post, setPost] = useState('');
  const [section, setSection] = useState('');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [rank, setRank] = useState('');
  const [force, setForce] = useState('');
  const [user, setUser] = useState('');

  const sign = signs.find((s) => s.id === post);
  const member = staff.find((s) => s.userId === user);
  const sec = sections.find((s) => s.id === section);
  const ranks = [...new Set(staff.map((s) => s.rank).filter(Boolean) as string[])].sort();
  const people = staff.filter((s) => (!rank || s.rank === rank) && (!force.trim() || (s.force ?? '').includes(force.trim())));
  const ready = [Boolean(post && section), Boolean(from && to && to >= from), Boolean(user), true];

  const reset = () => { setStep(0); setPost(''); setSection(''); setFrom(today); setTo(today); setStart(''); setEnd(''); setRank(''); setForce(''); setUser(''); };

  if (!open) {
    return (
      <div className="flex flex-col items-start gap-2 p-4">
        <p className="text-sm text-muted-foreground">{t('Book one member on one call sign, step by step.')}</p>
        <button type="button" onClick={() => setOpen(true)} className={ox.primary}><CalendarPlus className="h-4 w-4" aria-hidden /> {t('Assign / Update Duty')}</button>
      </div>
    );
  }

  return (
    <ActionForm action={assignDutyAction} success={t('Duty saved')} onDone={() => { reset(); setOpen(false); }} className="space-y-4 p-4">
      <input type="hidden" name="post" value={post} />
      <input type="hidden" name="section" value={section} />
      <input type="hidden" name="from" value={from} />
      <input type="hidden" name="to" value={to} />
      <input type="hidden" name="start" value={start} />
      <input type="hidden" name="end" value={end} />
      <input type="hidden" name="user" value={user} />

      <ol className="flex flex-wrap gap-2 text-xs">
        {STEPS.map((s, i) => (
          <li key={s} className={cn('rounded-full px-2.5 py-1 font-semibold', i === step ? 'bg-primary text-primary-foreground' : i < step ? 'bg-primary/20' : 'bg-muted text-muted-foreground')}>
            {i + 1}. {t(s)}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label><span className={ox.label}>{t('Call sign')}</span>
            <select value={post} onChange={(e) => {
              setPost(e.target.value);
              const s = signs.find((x) => x.id === e.target.value);
              if (s?.sectionId) setSection(s.sectionId);
              setStart(s?.start ?? ''); setEnd(s?.stop ?? '');
            }} className={ox.input}>
              <option value="">{t('Choose…')}</option>
              {signs.map((s) => <option key={s.id} value={s.id}>{s.callSign}</option>)}
            </select></label>
          <label><span className={ox.label}>{t('Section')}</span>
            <select value={section} onChange={(e) => setSection(e.target.value)} className={ox.input}>
              <option value="">{t('Choose…')}</option>
              {sections.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
            </select></label>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="grid gap-3 sm:grid-cols-4">
          <label><span className={ox.label}>{t('Duty from')}</span>
            <input type="date" min={today} value={from} onChange={(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }} className={ox.input} /></label>
          <label><span className={ox.label}>{t('Duty to')}</span>
            <input type="date" min={from} value={to} onChange={(e) => setTo(e.target.value)} className={ox.input} /></label>
          <label><span className={ox.label}>{t('Start time')}</span>
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={ox.input} /></label>
          <label><span className={ox.label}>{t('End time')}</span>
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={ox.input} /></label>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="grid gap-3 sm:grid-cols-[8rem_8rem_1fr]">
          <label><span className={ox.label}>{t('Rank')}</span>
            <select value={rank} onChange={(e) => setRank(e.target.value)} className={ox.input}>
              <option value="">{t('All')}</option>
              {ranks.map((r) => <option key={r} value={r}>{r}</option>)}
            </select></label>
          <label><span className={ox.label}>{t('Force no.')}</span>
            <input value={force} onChange={(e) => setForce(e.target.value)} placeholder="67" className={ox.input} /></label>
          <label><span className={ox.label}>{t('Staff no. / name')}</span>
            <select value={user} onChange={(e) => setUser(e.target.value)} className={ox.input}>
              <option value="">{t('Choose…')}</option>
              {people.map((s) => <option key={s.userId} value={s.userId}>{s.badge} — {s.name}{s.rank ? ` (${s.rank})` : ''}{s.away ? ` · ${s.away}` : ''}</option>)}
            </select></label>
        </div>
      ) : null}

      {step === 3 ? (
        <dl className="grid gap-x-6 gap-y-1.5 rounded-md bg-muted/40 p-3 text-sm sm:grid-cols-2">
          <div><dt className={ox.label}>{t('Call sign')}</dt><dd className="font-mono font-bold">{sign?.callSign}</dd></div>
          <div><dt className={ox.label}>{t('Section')}</dt><dd>{sec ? `${sec.code} — ${sec.name}` : ''}</dd></div>
          <div><dt className={ox.label}>{t('Dates')}</dt><dd className="font-mono">{from}{to !== from ? ` → ${to}` : ''}</dd></div>
          <div><dt className={ox.label}>{t('Hours')}</dt><dd className="font-mono">{start || sign?.start} – {end || sign?.stop}</dd></div>
          <div className="sm:col-span-2"><dt className={ox.label}>{t('Staff member')}</dt><dd>{member ? `${member.rank ?? ''} ${member.force ?? ''} ${member.name}`.trim() : ''}</dd></div>
        </dl>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {step > 0 ? <button type="button" onClick={() => setStep(step - 1)} className={ox.secondary}>{t('Back')}</button> : null}
        {step < 3 ? (
          <button type="button" disabled={!ready[step]} onClick={() => setStep(step + 1)} className={ox.primary}>{t('Next')}</button>
        ) : (
          <button type="submit" className={ox.primary}>{t('OK — Save Duty')}</button>
        )}
        <button type="button" onClick={() => { reset(); setOpen(false); }} className="ml-auto text-sm text-muted-foreground hover:underline">{t('Cancel')}</button>
      </div>
    </ActionForm>
  );
}
