'use client';

import { useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { Home } from 'lucide-react';
import { RELIEF_ITEMS } from '@criticom/db/disaster-plan';
import { CallButton } from '@/components/disaster/call-button';
import { useT } from '@/components/i18n';
import { Fold } from '@/components/disaster/fold';
import { cn } from '@/lib/utils';
import { SUPPLY_STATES, WATER_SUPPLY } from '@criticom/db/disaster-departments';
import { closeShelterAction, openShelterAction, shelterServicesAction, updateShelterAction } from '../actions';

/**
 * Reception centres for the call (0112): council halls opened for the people
 * displaced. Who came and left, who they are, what was handed out, the space
 * left. A hall is closed once everyone has left.
 */

export type BoardOpening = {
  id: string; shelterId: string; name: string; capacity: number; free: number; keyHolder: string | null; keyHolderPhone: string | null;
  peopleNow: number; peak: number; households: number; children: number; elderly: number; disabled: number;
  relief: Record<string, number>; openedAt: string; closedAt: string | null;
  /** Supplies (0113). */
  food: string | null; toiletries: string | null; water: string | null; toilets: number; temporaryToilets: number;
};
export type BoardShelter = { id: string; name: string; municipality: string; ward: string | null; capacity: number; free: number };

const newRef = () => crypto.randomUUID();
const num = (v: string) => v.replace(/\D/g, '').slice(0, 6);

export function SheltersTile({ incidentId, openings, register, live, onError }: {
  incidentId: string; openings: BoardOpening[]; register: BoardShelter[]; live: boolean; onError: (e: string) => void;
}) {
  const { t } = useT();
  const open = openings.filter((o) => !o.closedAt);
  const closed = openings.filter((o) => o.closedAt);
  const people = open.reduce((n, o) => n + o.peopleNow, 0);
  return (
    <Fold id="board.shelters" icon={Home} title={t('Reception centres ({n} open, {p} people)', { n: open.length, p: people })} defaultOpen={false}
      info={t('Halls opened for this incident: people in now, places left, and the relief handed out.')}
      actions={<Link href="/disaster/shelters" className="text-sm font-semibold text-accent hover:underline">{t('Shelter register')}</Link>}>
      <div className="space-y-4 p-5">
        {open.length === 0 ? <p className="text-sm text-muted-foreground">{t('No shelter open for this call.')}</p> : null}
        {open.map((o) => <OpenShelter key={o.id} incidentId={incidentId} o={o} live={live} onError={onError} />)}
        {live ? <OpenForm incidentId={incidentId} register={register.filter((s) => !open.some((o) => o.shelterId === s.id))} onError={onError} /> : null}
        {closed.length ? (
          <ul className="space-y-1 border-t border-border pt-3 text-sm text-muted-foreground">
            {closed.map((o) => <li key={o.id}>{t('{name}: closed, most at once {peak}', { name: o.name, peak: o.peak })}</li>)}
          </ul>
        ) : null}
      </div>
    </Fold>
  );
}

function OpenShelter({ incidentId, o, live, onError }: { incidentId: string; o: BoardOpening; live: boolean; onError: (e: string) => void }) {
  const { t } = useT();
  const [pending, start] = useTransition();
  const [arrived, setArrived] = useState('');
  const [left, setLeft] = useState('');
  const [relief, setRelief] = useState<Record<string, string>>({});
  const [who, setWho] = useState({ households: String(o.households || ''), children: String(o.children || ''), elderly: String(o.elderly || ''), disabled: String(o.disabled || '') });
  const [note, setNote] = useState('');
  const ref = useRef(newRef());
  const full = o.capacity > 0 && o.free <= 0;
  const save = () => start(async () => {
    const res = await updateShelterAction({ incidentId, openingId: o.id, clientRef: ref.current, arrived, left, relief, note, ...who });
    if ('error' in res) { onError(res.error); return; }
    ref.current = newRef();
    setArrived(''); setLeft(''); setRelief({}); setNote('');
  });
  const close = () => start(async () => {
    const res = await closeShelterAction({ incidentId, openingId: o.id });
    if ('error' in res) onError(res.error);
  });
  const small = 'h-10 w-full rounded-md border border-border bg-bg-soft px-2 text-center text-sm';
  const given = RELIEF_ITEMS.filter((r) => (o.relief[r.key] ?? 0) > 0).map((r) => `${o.relief[r.key]} ${r.label.toLowerCase()}`);
  return (
    <div className="rounded-lg border border-border bg-bg-soft p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-base font-semibold">{o.name}</p>
          <p className={cn('text-sm', full ? 'font-semibold text-severity-critical-ink' : 'text-muted-foreground')}>
            {o.capacity > 0 ? t('{now} people here · {free} places free of {cap}', { now: o.peopleNow, free: Math.max(0, o.free), cap: o.capacity })
              : t('{now} people here', { now: o.peopleNow })}
          </p>
          {given.length ? <p className="text-xs text-muted-foreground">{t('Given so far: {list}', { list: given.join(', ') })}</p> : null}
        </div>
        {o.keyHolderPhone ? <CallButton number={o.keyHolderPhone} label={o.keyHolder ? t('Key holder: {name}', { name: o.keyHolder }) : t('Key holder')} size="sm" /> : null}
      </div>
      {live ? (
        <div className="mt-3 space-y-3">
          <Supplies incidentId={incidentId} o={o} onError={onError} />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
            <label className="text-xs text-muted-foreground">{t('Arrived')}<input value={arrived} onChange={(e) => setArrived(num(e.target.value))} inputMode="numeric" className={small} /></label>
            <label className="text-xs text-muted-foreground">{t('Left')}<input value={left} onChange={(e) => setLeft(num(e.target.value))} inputMode="numeric" className={small} /></label>
            <label className="text-xs text-muted-foreground">{t('Households')}<input value={who.households} onChange={(e) => setWho({ ...who, households: num(e.target.value) })} inputMode="numeric" className={small} /></label>
            <label className="text-xs text-muted-foreground">{t('Children')}<input value={who.children} onChange={(e) => setWho({ ...who, children: num(e.target.value) })} inputMode="numeric" className={small} /></label>
            <label className="text-xs text-muted-foreground">{t('Elderly')}<input value={who.elderly} onChange={(e) => setWho({ ...who, elderly: num(e.target.value) })} inputMode="numeric" className={small} /></label>
            <label className="text-xs text-muted-foreground">{t('Disabled')}<input value={who.disabled} onChange={(e) => setWho({ ...who, disabled: num(e.target.value) })} inputMode="numeric" className={small} /></label>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('Handed out now')}</p>
            <div className="mt-1 grid grid-cols-3 gap-2 sm:grid-cols-6">
              {RELIEF_ITEMS.map((r) => (
                <label key={r.key} className="text-xs text-muted-foreground">{t(r.label)}
                  <input value={relief[r.key] ?? ''} onChange={(e) => setRelief({ ...relief, [r.key]: num(e.target.value) })} inputMode="numeric" className={small} />
                </label>
              ))}
            </div>
          </div>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder={t('Note (optional)')}
            className="h-10 w-full rounded-md border border-border bg-bg-card px-3 text-sm" />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={save} disabled={pending}
              className="h-11 rounded-md bg-accent px-5 text-sm font-semibold text-accent-foreground disabled:opacity-60">{pending ? t('Saving…') : t('Save')}</button>
            <button type="button" onClick={close} disabled={pending || o.peopleNow > 0} title={o.peopleNow > 0 ? t('Log everyone leaving first') : undefined}
              className="h-11 rounded-md border border-border px-5 text-sm hover:bg-muted disabled:opacity-50">{t('Close the shelter')}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function OpenForm({ incidentId, register, onError }: { incidentId: string; register: BoardShelter[]; onError: (e: string) => void }) {
  const { t } = useT();
  const [shelterId, setShelterId] = useState('');
  const [people, setPeople] = useState('');
  const [households, setHouseholds] = useState('');
  const [pending, start] = useTransition();
  const ref = useRef(newRef());
  const submit = () => start(async () => {
    const res = await openShelterAction({ incidentId, shelterId, clientRef: ref.current, people, households });
    if ('error' in res) { onError(res.error); return; }
    ref.current = newRef();
    setShelterId(''); setPeople(''); setHouseholds('');
  });
  if (register.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('Add halls to the shelter register to open one here.')}</p>;
  }
  return (
    <div className="grid gap-2 border-t border-border pt-4 sm:grid-cols-[1fr_6rem_7rem_auto]">
      <select value={shelterId} onChange={(e) => setShelterId(e.target.value)} aria-label={t('Shelter')}
        className="h-11 rounded-md border border-border bg-bg-soft px-3 text-sm">
        <option value="">{t('Open a shelter…')}</option>
        {register.map((s) => (
          <option key={s.id} value={s.id}>{s.name}{s.ward ? ` · ward ${s.ward}` : ''} · {s.capacity ? `${Math.max(0, s.free)} free` : s.municipality}</option>
        ))}
      </select>
      <input value={people} onChange={(e) => setPeople(num(e.target.value))} inputMode="numeric" placeholder={t('People')} aria-label={t('People')}
        className="h-11 rounded-md border border-border bg-bg-soft px-3 text-sm" />
      <input value={households} onChange={(e) => setHouseholds(num(e.target.value))} inputMode="numeric" placeholder={t('Households')} aria-label={t('Households')}
        className="h-11 rounded-md border border-border bg-bg-soft px-3 text-sm" />
      <button type="button" onClick={submit} disabled={pending || !shelterId}
        className="h-11 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60">{t('Open')}</button>
    </div>
  );
}

/** Food, drinking water, toilets and toiletries at the shelter, as the people there report them. */
function Supplies({ incidentId, o, onError }: { incidentId: string; o: BoardOpening; onError: (e: string) => void }) {
  const { t } = useT();
  const [v, setV] = useState({ food: o.food ?? '', water: o.water ?? '', toiletries: o.toiletries ?? '', toilets: String(o.toilets || ''), temporary_toilets: String(o.temporaryToilets || '') });
  const [pending, start] = useTransition();
  const changed = v.food !== (o.food ?? '') || v.water !== (o.water ?? '') || v.toiletries !== (o.toiletries ?? '')
    || v.toilets !== String(o.toilets || '') || v.temporary_toilets !== String(o.temporaryToilets || '');
  const save = () => start(async () => {
    const res = await shelterServicesAction(incidentId, o.id, v);
    if ('error' in res) onError(res.error);
  });
  const sel = 'h-10 w-full rounded-md border border-border bg-bg-card px-2 text-sm';
  const tone = (x: string) => (x === 'None' ? 'text-severity-critical-ink' : x === 'Running low' ? 'text-severity-medium-ink' : '');
  return (
    <div className="rounded-lg border border-border bg-bg-card p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('Supplies')}</p>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <label className={cn('text-xs text-muted-foreground', tone(v.food))}>{t('Food')}
          <select value={v.food} onChange={(e) => setV({ ...v, food: e.target.value })} className={sel}>
            <option value="">{t('Not said')}</option>{SUPPLY_STATES.map((x) => <option key={x} value={x}>{t(x)}</option>)}
          </select></label>
        <label className={cn('text-xs text-muted-foreground', v.water === 'None' && 'text-severity-critical-ink')}>{t('Drinking water')}
          <select value={v.water} onChange={(e) => setV({ ...v, water: e.target.value })} className={sel}>
            <option value="">{t('Not said')}</option>{WATER_SUPPLY.map((x) => <option key={x} value={x}>{t(x)}</option>)}
          </select></label>
        <label className={cn('text-xs text-muted-foreground', tone(v.toiletries))}>{t('Toiletries')}
          <select value={v.toiletries} onChange={(e) => setV({ ...v, toiletries: e.target.value })} className={sel}>
            <option value="">{t('Not said')}</option>{SUPPLY_STATES.map((x) => <option key={x} value={x}>{t(x)}</option>)}
          </select></label>
        <label className="text-xs text-muted-foreground">{t('Toilets')}
          <input value={v.toilets} onChange={(e) => setV({ ...v, toilets: num(e.target.value) })} inputMode="numeric" className={sel} /></label>
        <label className="text-xs text-muted-foreground">{t('Temporary toilets')}
          <input value={v.temporary_toilets} onChange={(e) => setV({ ...v, temporary_toilets: num(e.target.value) })} inputMode="numeric" className={sel} /></label>
      </div>
      {changed ? (
        <button type="button" onClick={save} disabled={pending} className="mt-2 h-9 rounded-md bg-accent px-4 text-sm font-semibold text-accent-foreground disabled:opacity-60">
          {pending ? t('Saving…') : t('Save supplies')}
        </button>
      ) : null}
    </div>
  );
}
