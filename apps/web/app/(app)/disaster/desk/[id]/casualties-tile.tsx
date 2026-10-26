'use client';

import { useRef, useState, useTransition } from 'react';
import { Lock, Plus, UserRound } from 'lucide-react';
import { CallButton } from '@/components/disaster/call-button';
import { useT } from '@/components/i18n';
import { cn } from '@/lib/utils';
import { recordCasualtyAction, updateCasualtyAction } from '../actions';

/**
 * Injured, deceased and missing people (0113). Every field is optional; a
 * person not identified is described. Personal information: shown only to
 * the Disaster desk and command (the database decides, and logs each read);
 * everyone else sees the counts.
 */

export type BoardCasualty = {
  id: string; kind: 'Injured' | 'Deceased' | 'Missing'; name: string | null; phone: string | null; address: string | null;
  gender: string | null; age: string | null; description: string | null; condition: string | null; takenTo: string | null; notes: string | null;
};

const KINDS = ['Injured', 'Deceased', 'Missing'] as const;
const KIND_TONE: Record<BoardCasualty['kind'], string> = {
  Injured: 'bg-severity-medium/15 text-severity-medium-ink', Deceased: 'bg-severity-critical/15 text-severity-critical-ink', Missing: 'bg-sky-500/15 text-sky-300',
};
const blank = { kind: 'Injured' as BoardCasualty['kind'], name: '', phone: '', address: '', gender: '', age: '', description: '', condition: '', taken_to: '', notes: '' };

export function CasualtiesTile({ incidentId, people, counts, live, onError }: {
  incidentId: string; people: BoardCasualty[] | null; counts: { injured: number; deceased: number; missing: number }; live: boolean;
  onError: (e: string) => void;
}) {
  const { t } = useT();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h2 className="flex items-center gap-2 font-semibold"><UserRound className="h-4 w-4 text-accent" aria-hidden />{t('Casualties')}</h2>
        <p className="flex gap-3 text-sm">
          <span>{t('{n} injured', { n: counts.injured })}</span>
          <span className="text-severity-critical-ink">{t('{n} deceased', { n: counts.deceased })}</span>
          <span>{t('{n} missing', { n: counts.missing })}</span>
        </p>
      </div>
      <div className="space-y-3 p-5">
        {people === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Lock className="h-4 w-4" aria-hidden />{t('Personal details are kept for the Disaster desk and command.')}</p>
        ) : (
          <>
            {people.length === 0 && editing !== 'new' ? <p className="text-sm text-muted-foreground">{t('Nobody recorded.')}</p> : null}
            <ul className="space-y-2">
              {people.map((p) => editing === p.id ? (
                <li key={p.id}><CasualtyForm incidentId={incidentId} person={p} onDone={() => setEditing(null)} onError={onError} /></li>
              ) : (
                <li key={p.id} className="flex flex-wrap items-start gap-3 rounded-lg border border-border bg-bg-soft px-3 py-2.5 text-sm">
                  <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', KIND_TONE[p.kind])}>{t(p.kind)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{p.name || t('Not identified')}{p.gender || p.age ? <span className="ml-2 font-normal text-muted-foreground">{[p.gender, p.age].filter(Boolean).join(', ')}</span> : null}</p>
                    {p.description ? <p className="text-muted-foreground">{p.description}</p> : null}
                    <p className="text-muted-foreground">{[p.condition, p.takenTo ? t('taken to {place}', { place: p.takenTo }) : null, p.address].filter(Boolean).join(' · ')}</p>
                  </div>
                  <CallButton number={p.phone} size="sm" />
                  {live ? <button type="button" onClick={() => setEditing(p.id)} className="h-8 rounded-md px-2 text-sm text-accent hover:bg-muted">{t('Change')}</button> : null}
                </li>
              ))}
            </ul>
            {editing === 'new' ? <CasualtyForm incidentId={incidentId} person={null} onDone={() => setEditing(null)} onError={onError} /> : null}
            {live && editing === null ? (
              <button type="button" onClick={() => setEditing('new')} className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-sm font-semibold hover:bg-muted">
                <Plus className="h-4 w-4" aria-hidden />{t('Record a person')}
              </button>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function CasualtyForm({ incidentId, person, onDone, onError }: {
  incidentId: string; person: BoardCasualty | null; onDone: () => void; onError: (e: string) => void;
}) {
  const { t } = useT();
  const [v, setV] = useState(person ? {
    kind: person.kind, name: person.name ?? '', phone: person.phone ?? '', address: person.address ?? '', gender: person.gender ?? '',
    age: person.age ?? '', description: person.description ?? '', condition: person.condition ?? '', taken_to: person.takenTo ?? '', notes: person.notes ?? '',
  } : blank);
  const [pending, start] = useTransition();
  const ref = useRef(crypto.randomUUID());
  const set = (k: keyof typeof v, x: string) => setV({ ...v, [k]: x });
  const save = () => start(async () => {
    const res = person ? await updateCasualtyAction(incidentId, person.id, v) : await recordCasualtyAction(incidentId, ref.current, v);
    if ('error' in res) onError(res.error);
    else onDone();
  });
  const field = 'mt-1 h-10 w-full rounded-md border border-border bg-bg-card px-3 text-sm';
  return (
    <div className="space-y-3 rounded-lg border border-accent bg-bg-soft p-4">
      <div className="flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <button key={k} type="button" aria-pressed={v.kind === k} onClick={() => setV({ ...v, kind: k })}
            className={cn('h-10 rounded-md border px-4 text-sm font-semibold', v.kind === k ? 'border-accent bg-accent/15 text-accent' : 'border-border text-muted-foreground hover:bg-muted')}>{t(k)}</button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t('Fill in only what is known.')}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-sm font-medium sm:col-span-2">{t('Name')}<input value={v.name} onChange={(e) => set('name', e.target.value)} maxLength={160} className={field} /></label>
        <label className="block text-sm font-medium">{t('Phone')}<input value={v.phone} onChange={(e) => set('phone', e.target.value)} maxLength={60} inputMode="tel" className={field} /></label>
        <label className="block text-sm font-medium">{t('Age (about)')}<input value={v.age} onChange={(e) => set('age', e.target.value)} maxLength={30} className={field} /></label>
        <label className="block text-sm font-medium sm:col-span-2">{t('Address')}<input value={v.address} onChange={(e) => set('address', e.target.value)} maxLength={300} className={field} /></label>
        <label className="block text-sm font-medium">{t('Gender')}
          <select value={v.gender} onChange={(e) => set('gender', e.target.value)} className={field}>
            <option value="">{t('Not known')}</option><option value="Female">{t('Female')}</option><option value="Male">{t('Male')}</option><option value="Unknown">{t('Unknown')}</option>
          </select></label>
        <label className="block text-sm font-medium">{t('Taken to')}<input value={v.taken_to} onChange={(e) => set('taken_to', e.target.value)} maxLength={200} placeholder={t('Hospital or mortuary')} className={field} /></label>
        <label className="block text-sm font-medium sm:col-span-2 lg:col-span-4">{t('Description')}
          <input value={v.description} onChange={(e) => set('description', e.target.value)} maxLength={1000}
            placeholder={t('When not identified: appearance and clothing, for example blue jeans and a grey jacket')} className={field} /></label>
        <label className="block text-sm font-medium sm:col-span-2">{t('Condition')}<input value={v.condition} onChange={(e) => set('condition', e.target.value)} maxLength={300} className={field} /></label>
        <label className="block text-sm font-medium sm:col-span-2">{t('Notes')}<input value={v.notes} onChange={(e) => set('notes', e.target.value)} maxLength={1000} className={field} /></label>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={pending} className="h-10 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60">{pending ? t('Saving…') : t('Save')}</button>
        <button type="button" onClick={onDone} className="h-10 rounded-md border border-border px-5 text-sm hover:bg-muted">{t('Cancel')}</button>
      </div>
    </div>
  );
}
