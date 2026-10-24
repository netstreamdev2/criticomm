'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import type { FirePremises } from '@criticom/api';
import { OCCUPANCIES, RISKS, usualRisk } from '@criticom/db/fire-inspection';
import { useT } from '@/components/i18n';
import { savePremisesAction } from '../../actions';

const field = 'mt-1 h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm';
const label = 'text-xs font-bold uppercase tracking-wider text-muted-foreground';

/** Add a site to the register, or change one (0106): fire command only; the server checks the same. */
export function PremisesForm({ premises }: { premises?: FirePremises | null }) {
  const { t } = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    name: premises?.name ?? '', address: premises?.address ?? '', occupancy: premises?.occupancy ?? '',
    risk: premises?.risk ?? '', contact_person: premises?.contact_person ?? '', contact_number: premises?.contact_number ?? '',
  });
  const set = (k: keyof typeof f, v: string) => setF((cur) => ({ ...cur, [k]: v }));

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await savePremisesAction(premises?.id ?? null, f);
      if (!res.ok) { setError(res.error); return; }
      if (!premises) setF({ name: '', address: '', occupancy: '', risk: '', contact_person: '', contact_number: '' });
      router.push('/fire/inspections/premises');
      router.refresh();
    });
  };

  return (
    <form onSubmit={save} className="rounded-lg border border-border bg-bg-card p-5">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">{premises ? t('Change {name}', { name: premises.name }) : t('Add a site')}</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block"><span className={label}>{t('Business or site name')}</span>
          <input required className={field} value={f.name} onChange={(e) => set('name', e.target.value)} /></label>
        <label className="block"><span className={label}>{t('Address')}</span>
          <input required className={field} value={f.address} onChange={(e) => set('address', e.target.value)} /></label>
        <label className="block"><span className={label}>{t('Used as')}</span>
          <select required className={field} value={f.occupancy} onChange={(e) => setF((cur) => ({ ...cur, occupancy: e.target.value, risk: cur.risk || usualRisk(e.target.value) }))}>
            <option value="">{t('Choose')}</option>
            {OCCUPANCIES.map((o) => <option key={o} value={o}>{t(o)}</option>)}
          </select></label>
        <label className="block"><span className={label}>{t('Risk (high every 6 months, moderate yearly, low every 2 years)')}</span>
          <select required className={field} value={f.risk} onChange={(e) => set('risk', e.target.value)}>
            <option value="">{t('Choose')}</option>
            {RISKS.map((r) => <option key={r} value={r}>{t(r)}</option>)}
          </select></label>
        <label className="block"><span className={label}>{t('Contact person')}</span>
          <input className={field} value={f.contact_person} onChange={(e) => set('contact_person', e.target.value)} /></label>
        <label className="block"><span className={label}>{t('Contact number')}</span>
          <input className={field} value={f.contact_number} onChange={(e) => set('contact_number', e.target.value)} /></label>
      </div>
      {error ? <p role="alert" className="mt-3 text-sm text-severity-critical-ink">{error}</p> : null}
      <button type="submit" disabled={pending} className="mt-4 inline-flex h-10 items-center gap-2 rounded-md bg-primary px-5 text-sm font-semibold disabled:opacity-60">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{premises ? t('Save') : t('Add to the register')}
      </button>
    </form>
  );
}
