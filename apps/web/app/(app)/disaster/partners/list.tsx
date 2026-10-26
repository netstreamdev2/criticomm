'use client';

import { useState, useTransition } from 'react';
import { Pencil, Plus, Search } from 'lucide-react';
import { PARTNER_SECTORS, PARTNER_TYPES } from '@criticom/db/disaster-plan';
import { CallButton } from '@/components/disaster/call-button';
import { useT } from '@/components/i18n';
import { cn } from '@/lib/utils';
import { savePartnerAction } from '../desk/actions';

type Partner = {
  id: string; name: string; type: string; phone: string | null; radio: string | null; commander: string | null;
  sector: string | null; verified: boolean; notes: string | null; active: boolean; sort: number;
};

/** The partner list, grouped by type, each with its number to press and whether it has been checked. */
export function PartnerList({ partners, canEdit }: { partners: Partner[]; canEdit: boolean }) {
  const { t } = useT();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [showOff, setShowOff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needle = q.trim().toLowerCase();
  const shown = partners
    .filter((p) => (p.active || showOff) && (!needle || `${p.name} ${p.type} ${p.commander ?? ''} ${p.notes ?? ''}`.toLowerCase().includes(needle)))
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  const types = [...PARTNER_TYPES, ...new Set(shown.map((p) => p.type).filter((x) => !(PARTNER_TYPES as readonly string[]).includes(x)))];
  const unchecked = partners.filter((p) => p.active && !p.verified).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="relative block w-full sm:w-96">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search: Eskom, SASSA, Ugu…')}
            className="h-11 w-full rounded-md border border-border bg-bg-card pl-9 pr-3 text-sm" />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          {canEdit && unchecked ? <span className="text-sm font-medium text-severity-medium-ink">{t('{n} numbers still to check', { n: unchecked })}</span> : null}
          {canEdit ? (
            <>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} className="h-4 w-4" />{t('Show switched off')}</label>
              <button type="button" onClick={() => setEditing('new')} className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground">
                <Plus className="h-4 w-4" aria-hidden />{t('Add partner')}
              </button>
            </>
          ) : null}
        </div>
      </div>
      {error ? <p role="alert" className="rounded-lg border border-severity-critical bg-bg-card px-4 py-3 text-sm font-medium text-severity-critical-ink">{error}</p> : null}
      {editing === 'new' ? <PartnerForm partner={null} onDone={() => setEditing(null)} onError={setError} /> : null}

      {types.map((type) => {
        const group = shown.filter((p) => p.type === type);
        if (group.length === 0) return null;
        return (
          <section key={type} className="space-y-3">
            <h2 className="text-lg font-semibold">{t(type)} <span className="text-sm font-normal text-muted-foreground">({group.length})</span></h2>
            <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {group.map((p) => editing === p.id ? (
                <li key={p.id} className="md:col-span-2 xl:col-span-3"><PartnerForm partner={p} onDone={() => setEditing(null)} onError={setError} /></li>
              ) : (
                <li key={p.id} className={cn('flex flex-col gap-2 rounded-xl border border-border bg-bg-card p-4 shadow-sm', !p.active && 'opacity-60')}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold leading-tight">{p.name}</p>
                      <p className="text-sm text-muted-foreground">{[p.commander, p.sector].filter(Boolean).join(' · ')}</p>
                    </div>
                    {canEdit ? (
                      <button type="button" onClick={() => setEditing(p.id)} aria-label={t('Change')} className="rounded-md p-2 text-muted-foreground hover:bg-muted">
                        <Pencil className="h-4 w-4" aria-hidden />
                      </button>
                    ) : null}
                  </div>
                  {p.notes ? <p className="text-sm text-muted-foreground">{p.notes}</p> : null}
                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                    <CallButton number={p.phone} />
                    {p.radio ? <span className="font-mono text-xs text-muted-foreground">{p.radio}</span> : null}
                    {!p.verified ? <span className="rounded-full border border-severity-medium px-2 py-0.5 text-xs font-semibold text-severity-medium-ink">{t('Check this number')}</span> : null}
                    {!p.active ? <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{t('Switched off')}</span> : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {shown.length === 0 ? <p className="rounded-xl border border-border bg-bg-card p-8 text-center text-sm text-muted-foreground shadow-sm">{t('No partner matches.')}</p> : null}
    </div>
  );
}

function PartnerForm({ partner, onDone, onError }: { partner: Partner | null; onDone: () => void; onError: (e: string | null) => void }) {
  const { t } = useT();
  const [v, setV] = useState({
    agency_name: partner?.name ?? '', resource_type: partner?.type ?? 'eThekwini services', contact_number: partner?.phone ?? '',
    radio_frequency: partner?.radio ?? '', commander_name: partner?.commander ?? '', sector: partner?.sector ?? 'eThekwini', notes: partner?.notes ?? '',
  });
  const [verified, setVerified] = useState(partner?.verified ?? true);
  const [active, setActive] = useState(partner?.active ?? true);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof v, x: string) => setV({ ...v, [k]: x });
  const save = () => start(async () => {
    onError(null);
    const res = await savePartnerAction(partner?.id ?? null, { ...v, verified, is_active: active });
    if ('error' in res) onError(res.error);
    else onDone();
  });
  const field = 'mt-1 h-11 w-full rounded-md border border-border bg-bg-soft px-3 text-sm';
  return (
    <div className="rounded-xl border border-accent bg-bg-card p-6 shadow-sm">
      <h3 className="text-lg font-semibold">{partner ? t('Change partner') : t('Add partner')}</h3>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block text-sm font-medium sm:col-span-2">{t('Organisation')}<input value={v.agency_name} onChange={(e) => set('agency_name', e.target.value)} maxLength={200} className={field} /></label>
        <label className="block text-sm font-medium">{t('Type')}
          <select value={v.resource_type} onChange={(e) => set('resource_type', e.target.value)} className={field}>
            {[...new Set([...PARTNER_TYPES, v.resource_type])].map((x) => <option key={x} value={x}>{t(x)}</option>)}
          </select></label>
        <label className="block text-sm font-medium">{t('Number')}<input value={v.contact_number} onChange={(e) => set('contact_number', e.target.value)} maxLength={60} inputMode="tel" className={field} /></label>
        <label className="block text-sm font-medium">{t('Radio channel')}<input value={v.radio_frequency} onChange={(e) => set('radio_frequency', e.target.value)} maxLength={60} className={field} /></label>
        <label className="block text-sm font-medium">{t('Who answers')}<input value={v.commander_name} onChange={(e) => set('commander_name', e.target.value)} maxLength={120} className={field} /></label>
        <label className="block text-sm font-medium">{t('Sector')}
          <select value={v.sector} onChange={(e) => set('sector', e.target.value)} className={field}>{PARTNER_SECTORS.map((x) => <option key={x} value={x}>{t(x)}</option>)}</select></label>
        <label className="block text-sm font-medium sm:col-span-2">{t('Note')}<input value={v.notes} onChange={(e) => set('notes', e.target.value)} maxLength={300} className={field} /></label>
      </div>
      <div className="mt-4 flex flex-wrap gap-5 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} className="h-4 w-4" />{t('Number checked')}</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4" />{t('On the list')}</label>
      </div>
      <div className="mt-5 flex gap-2">
        <button type="button" onClick={save} disabled={pending || !v.agency_name.trim()}
          className="h-11 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60">{pending ? t('Saving…') : t('Save')}</button>
        <button type="button" onClick={onDone} className="h-11 rounded-md border border-border px-5 text-sm hover:bg-muted">{t('Cancel')}</button>
      </div>
    </div>
  );
}
