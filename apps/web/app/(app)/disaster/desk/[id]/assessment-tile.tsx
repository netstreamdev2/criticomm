'use client';

import { useRef, useState, useTransition } from 'react';
import { ClipboardList } from 'lucide-react';
import { useT } from '@/components/i18n';
import { fileAssessmentAction } from '../actions';

/**
 * The assessment on site (0107), filed by the desk for the Disaster
 * Management officer who reports it by phone or radio (0112): one per place
 * assessed, permanent, on the timeline with who reported it.
 */

const WHAT = ['Flooding', 'Storm or wind', 'Fire', 'Landslide', 'Building collapse', 'Hazardous spill', 'Major accident', 'Other'];
const COUNTS: Array<[string, string]> = [
  ['households_affected', 'Households affected'], ['people_affected', 'People affected'], ['people_displaced', 'People displaced'],
  ['homes_destroyed', 'Homes destroyed'], ['homes_damaged', 'Homes damaged'], ['injured', 'Injured'], ['deaths', 'Dead'], ['missing', 'Missing'],
];
const newRef = () => crypto.randomUUID();

export type BoardAssessment = { id: string; place: string; householdsAffected: number; peopleDisplaced: number; homesDestroyed: number; reportedBy: string | null; at: string };

export function AssessmentTile({ incidentId, officers, assessments, live, onError }: {
  incidentId: string; officers: string[]; assessments: BoardAssessment[]; live: boolean; onError: (e: string) => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState('');
  const [ward, setWard] = useState('');
  const [what, setWhat] = useState('');
  const [by, setBy] = useState('');
  const [n, setN] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [pending, start] = useTransition();
  const ref = useRef(newRef());
  const submit = () => start(async () => {
    const fields: Record<string, unknown> = { place, ward, hazard: what, reported_by: by, notes };
    for (const [k] of COUNTS) fields[k] = n[k] || '0';
    const res = await fileAssessmentAction({ incidentId, clientRef: ref.current, fields });
    if ('error' in res) { onError(res.error); return; }
    ref.current = newRef();
    setPlace(''); setWard(''); setWhat(''); setN({}); setNotes(''); setOpen(false);
  });
  const field = 'h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm';
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-bg-card shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h2 className="flex items-center gap-2 font-semibold"><ClipboardList className="h-4 w-4 text-accent" aria-hidden />
          {t('Assessment on site ({n})', { n: assessments.length })}</h2>
        {live && !open ? (
          <button type="button" onClick={() => setOpen(true)} className="h-9 rounded-md border border-border px-3 text-sm font-semibold hover:bg-muted">
            {t('File an assessment')}
          </button>
        ) : null}
      </div>
      <div className="space-y-4 p-5">
        {assessments.length === 0 && !open ? <p className="text-sm text-muted-foreground">{t('No place assessed yet.')}</p> : null}
        <ul className="space-y-2">
          {assessments.map((a) => (
            <li key={a.id} className="rounded-lg border border-border bg-bg-soft px-3 py-2 text-sm">
              <p className="font-semibold">{a.place}</p>
              <p className="text-muted-foreground">
                {t('{h} households · {d} displaced · {x} homes destroyed', { h: a.householdsAffected, d: a.peopleDisplaced, x: a.homesDestroyed })}
                {a.reportedBy ? ` · ${t('reported by {name}', { name: a.reportedBy })}` : ''}
              </p>
            </li>
          ))}
        </ul>
        {open ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium">{t('Where (street, block or hall)')}
                <input value={place} onChange={(e) => setPlace(e.target.value)} maxLength={200} className={`${field} mt-1`} /></label>
              <label className="block text-sm font-medium">{t('Ward')}
                <input value={ward} onChange={(e) => setWard(e.target.value)} maxLength={40} className={`${field} mt-1`} /></label>
              <label className="block text-sm font-medium">{t('What happened')}
                <select value={what} onChange={(e) => setWhat(e.target.value)} className={`${field} mt-1`}>
                  <option value="">{t('Choose')}</option>
                  {WHAT.map((w) => <option key={w} value={w}>{t(w)}</option>)}
                </select></label>
              <label className="block text-sm font-medium">{t('Reported by')}
                <input value={by} onChange={(e) => setBy(e.target.value)} list="desk-officers" maxLength={160} className={`${field} mt-1`} />
                <datalist id="desk-officers">{officers.map((o) => <option key={o} value={o} />)}</datalist></label>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {COUNTS.map(([k, label]) => (
                <label key={k} className="text-xs text-muted-foreground">{t(label)}
                  <input value={n[k] ?? ''} onChange={(e) => setN({ ...n, [k]: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                    inputMode="numeric" className="h-10 w-full rounded-md border border-border bg-bg-soft px-2 text-center text-sm" />
                </label>
              ))}
            </div>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} placeholder={t('What they need, what they saw')}
              className="w-full rounded-md border border-border bg-bg-soft px-3 py-2 text-sm" />
            <div className="flex gap-2">
              <button type="button" onClick={submit} disabled={pending || !place.trim() || !what}
                className="h-11 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60">{pending ? t('Filing…') : t('File assessment')}</button>
              <button type="button" onClick={() => setOpen(false)} className="h-11 rounded-md border border-border px-5 text-sm hover:bg-muted">{t('Cancel')}</button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
