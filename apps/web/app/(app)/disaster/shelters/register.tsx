'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Home, Pencil, Plus } from 'lucide-react';
import { MUNICIPALITIES, SHELTER_KINDS } from '@criticom/db/disaster-plan';
import { CallButton } from '@/components/disaster/call-button';
import { useT } from '@/components/i18n';
import { cn } from '@/lib/utils';
import { saveShelterAction } from '../desk/actions';

type Hall = {
  id: string; name: string; kind: string; municipality: string; ward: string | null; address: string | null; capacity: number;
  keyHolder: string | null; keyHolderPhone: string | null; notes: string | null; active: boolean; people: number;
  calls: Array<{ id: string; number: string; people: number }>;
};

/** The register: each hall as a tile, the space left at a glance, add and change in place. */
export function ShelterRegister({ halls, canEdit }: { halls: Hall[]; canEdit: boolean }) {
  const { t } = useT();
  const [editing, setEditing] = useState<string | null>(null);
  const [muni, setMuni] = useState('');
  const [error, setError] = useState<string | null>(null);
  const shown = halls.filter((h) => (!muni || h.municipality === muni) && (h.active || editing === h.id));
  const people = halls.reduce((n, h) => n + h.people, 0);
  const space = halls.filter((h) => h.active).reduce((n, h) => n + Math.max(0, h.capacity - h.people), 0);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-3">
          {[
            [t('Facilities'), halls.filter((h) => h.active).length], [t('People sheltered now'), people], [t('Places free'), space],
          ].map(([label, v]) => (
            <div key={String(label)} className="min-w-[8rem] rounded-xl border border-border bg-bg-card px-4 py-2 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
              <p className="text-2xl font-bold tabular-nums">{v}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <select value={muni} onChange={(e) => setMuni(e.target.value)} aria-label={t('Municipality')}
            className="h-11 rounded-md border border-border bg-bg-card px-3 text-sm">
            <option value="">{t('All municipalities')}</option>
            {MUNICIPALITIES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          {canEdit ? (
            <button type="button" onClick={() => setEditing('new')}
              className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground">
              <Plus className="h-4 w-4" aria-hidden />{t('Add facility')}
            </button>
          ) : null}
        </div>
      </div>
      {error ? <p role="alert" className="rounded-lg border border-severity-critical bg-bg-card px-4 py-3 text-sm font-medium text-severity-critical-ink">{error}</p> : null}
      {editing === 'new' ? <HallForm hall={null} onDone={() => setEditing(null)} onError={setError} /> : null}

      {shown.length === 0 && editing !== 'new' ? (
        <div className="rounded-xl border border-border bg-bg-card p-8 text-center shadow-sm">
          <p className="font-semibold">{t('No facilities recorded.')}</p>
          <p className="text-sm text-muted-foreground">{t('Add council halls with their key holders so the desk can open them for a call.')}</p>
        </div>
      ) : null}
      <ul className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((h) => editing === h.id ? (
          <li key={h.id} className="md:col-span-2 xl:col-span-3"><HallForm hall={h} onDone={() => setEditing(null)} onError={setError} /></li>
        ) : (
          <li key={h.id} className={cn('flex flex-col gap-3 rounded-xl border border-border bg-bg-card p-5 shadow-sm', !h.active && 'opacity-60')}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-lg font-semibold"><Home className="h-4 w-4 shrink-0 text-accent" aria-hidden />{h.name}</p>
                <p className="text-sm text-muted-foreground">{[h.kind, h.municipality, h.ward ? t('ward {w}', { w: h.ward }) : null].filter(Boolean).join(' · ')}</p>
                {h.address ? <p className="text-sm text-muted-foreground">{h.address}</p> : null}
              </div>
              {canEdit ? (
                <button type="button" onClick={() => setEditing(h.id)} aria-label={t('Change')} className="rounded-md p-2 text-muted-foreground hover:bg-muted">
                  <Pencil className="h-4 w-4" aria-hidden />
                </button>
              ) : null}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Figure label={t('Capacity')} value={h.capacity} />
              <Figure label={t('In now')} value={h.people} />
              <Figure label={t('Free')} value={Math.max(0, h.capacity - h.people)} tone={h.capacity > 0 && h.people >= h.capacity ? 'text-severity-critical-ink' : 'text-severity-low-ink'} />
            </div>
            {h.calls.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {h.calls.map((c) => (
                  <li key={c.id}><Link href={`/disaster/desk/${c.id}`} className="rounded-full bg-muted px-2.5 py-1 font-mono text-xs hover:underline">{c.number} · {c.people}</Link></li>
                ))}
              </ul>
            ) : null}
            <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-sm">
              <span className="text-muted-foreground">{h.keyHolder ? t('Key holder: {name}', { name: h.keyHolder }) : t('No key holder recorded')}</span>
              <CallButton number={h.keyHolderPhone} size="sm" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg-soft py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('text-xl font-bold tabular-nums', tone)}>{value}</p>
    </div>
  );
}

function HallForm({ hall, onDone, onError }: { hall: Hall | null; onDone: () => void; onError: (e: string | null) => void }) {
  const { t } = useT();
  const [v, setV] = useState({
    name: hall?.name ?? '', kind: hall?.kind ?? 'Community hall', municipality: hall?.municipality ?? 'eThekwini Metro',
    ward: hall?.ward ?? '', address: hall?.address ?? '', capacity: String(hall?.capacity ?? ''), key_holder: hall?.keyHolder ?? '',
    key_holder_phone: hall?.keyHolderPhone ?? '', notes: hall?.notes ?? '',
  });
  const [active, setActive] = useState(hall?.active ?? true);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof v, x: string) => setV({ ...v, [k]: x });
  const save = () => start(async () => {
    onError(null);
    const res = await saveShelterAction(hall?.id ?? null, { ...v, capacity: v.capacity || '0', is_active: active });
    if ('error' in res) onError(res.error);
    else onDone();
  });
  const field = 'mt-1 h-11 w-full rounded-md border border-border bg-bg-soft px-3 text-sm';
  return (
    <div className="rounded-xl border border-accent bg-bg-card p-6 shadow-sm">
      <h2 className="text-lg font-semibold">{hall ? t('Change facility') : t('Add facility')}</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block text-sm font-medium sm:col-span-2">{t('Name')}<input value={v.name} onChange={(e) => set('name', e.target.value)} maxLength={200} className={field} /></label>
        <label className="block text-sm font-medium">{t('Type')}
          <select value={v.kind} onChange={(e) => set('kind', e.target.value)} className={field}>{SHELTER_KINDS.map((k) => <option key={k} value={k}>{t(k)}</option>)}</select></label>
        <label className="block text-sm font-medium">{t('Municipality')}
          <select value={v.municipality} onChange={(e) => set('municipality', e.target.value)} className={field}>{MUNICIPALITIES.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
        <label className="block text-sm font-medium">{t('Ward')}<input value={v.ward} onChange={(e) => set('ward', e.target.value)} maxLength={40} className={field} /></label>
        <label className="block text-sm font-medium">{t('Capacity (people)')}<input value={v.capacity} onChange={(e) => set('capacity', e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" className={field} /></label>
        <label className="block text-sm font-medium sm:col-span-2">{t('Address')}<input value={v.address} onChange={(e) => set('address', e.target.value)} maxLength={300} className={field} /></label>
        <label className="block text-sm font-medium">{t('Key holder')}<input value={v.key_holder} onChange={(e) => set('key_holder', e.target.value)} maxLength={120} className={field} /></label>
        <label className="block text-sm font-medium">{t('Key holder phone')}<input value={v.key_holder_phone} onChange={(e) => set('key_holder_phone', e.target.value)} maxLength={60} inputMode="tel" className={field} /></label>
        <label className="block text-sm font-medium sm:col-span-2">{t('Notes')}<input value={v.notes} onChange={(e) => set('notes', e.target.value)} maxLength={1000} placeholder={t('Kitchen, toilets, wheelchair access…')} className={field} /></label>
      </div>
      {hall ? (
        <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4" />{t('Can be used as a shelter')}</label>
      ) : null}
      <div className="mt-5 flex gap-2">
        <button type="button" onClick={save} disabled={pending || !v.name.trim()}
          className="h-11 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60">{pending ? t('Saving…') : t('Save')}</button>
        <button type="button" onClick={onDone} className="h-11 rounded-md border border-border px-5 text-sm hover:bg-muted">{t('Cancel')}</button>
      </div>
    </div>
  );
}
