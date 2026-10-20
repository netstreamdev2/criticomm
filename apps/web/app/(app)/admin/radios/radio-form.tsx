'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { RADIO_KINDS, type RadioKind, type RadioProvider } from '@criticom/api/radio';
import { saveRadioAction } from './actions';
import { useT } from '@/components/i18n';

export type RadioDraft = {
  id: string;
  provider: RadioProvider;
  kind: RadioKind;
  account: string;
  label: string;
  providerUserId: string;
  imei: string;
  silo: string;
  personnelId: string;
  apparatusId: string;
  notes: string;
  active: boolean;
};

type Option = { id: string; label: string };
const field = 'mt-1 block h-10 w-full rounded-md border border-border bg-bg-soft/80 px-3 text-sm';
const label = 'text-xs font-semibold uppercase text-muted-foreground';

/** Add a radio, or change one: the platform, the account, and whose it is. */
export function RadioForm({ draft, departments, people, vehicles }: {
  draft: RadioDraft;
  departments: Option[];
  people: Option[];
  vehicles: Option[];
}) {
  const { t } = useT();
  const [state, action, pending] = useActionState(saveRadioAction, null);
  return (
    <form action={action} className="frost space-y-3 rounded-xl border border-border p-4 lg:sticky lg:top-4 lg:self-start">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold">{draft.id ? 'Change this radio' : 'Add a radio'}</h2>
        {draft.id ? <Link href="/admin/radios" className="text-xs font-semibold text-accent hover:underline">{t('Add a new one instead')}</Link> : null}
      </div>
      <input type="hidden" name="id" value={draft.id} />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label} htmlFor="kind">{t('Kind')}</label>
          <select id="kind" name="kind" defaultValue={draft.kind} className={field}>
            {RADIO_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="silo">{t('Department')}</label>
          <select id="silo" name="silo" defaultValue={draft.silo} required className={field}>
            <option value="" disabled>{t('Choose')}</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className={label} htmlFor="account">{t('Radio name or Radio ID')}</label>
        <input id="account" name="account" defaultValue={draft.account} required maxLength={80} placeholder={t('e.g. FIRE ALPHA')} className={field} />
      </div>
      <div>
        <label className={label} htmlFor="label">{t('Name shown')}{' '}<span className="font-normal normal-case">{t('(optional)')}</span></label>
        <input id="label" name="label" defaultValue={draft.label} maxLength={80} placeholder={t('e.g. Station 3 spare')} className={field} />
      </div>

      <div>
        <label className={label} htmlFor="personnel_id">{t('Belongs to')}</label>
        <select id="personnel_id" name="personnel_id" defaultValue={draft.personnelId} className={field}>
          <option value="">{t('Nobody (a pool radio)')}</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </div>
      <div>
        <label className={label} htmlFor="apparatus_id">{t('Vehicle')}{' '}<span className="font-normal normal-case">{t('(optional)')}</span></label>
        <select id="apparatus_id" name="apparatus_id" defaultValue={draft.apparatusId} className={field}>
          <option value="">{t('None')}</option>
          {vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label} htmlFor="imei">IMEI <span className="font-normal normal-case">{t('(optional)')}</span></label>
          <input id="imei" name="imei" defaultValue={draft.imei} inputMode="numeric" maxLength={20} className={field} />
        </div>
        <div>
          <label className={label} htmlFor="provider_user_id">{t('Device number')}{' '}<span className="font-normal normal-case">{t('(optional)')}</span></label>
          <input id="provider_user_id" name="provider_user_id" defaultValue={draft.providerUserId} maxLength={40} className={field} />
        </div>
      </div>
      <div>
        <label className={label} htmlFor="notes">{t('Notes')}{' '}<span className="font-normal normal-case">{t('(optional)')}</span></label>
        <textarea id="notes" name="notes" defaultValue={draft.notes} maxLength={500} rows={2} className="mt-1 block w-full rounded-md border border-border bg-bg-soft/80 px-3 py-2 text-sm" />
      </div>
      {draft.id ? (
        <div>
          <label className={label} htmlFor="active">{t('Status')}</label>
          <select id="active" name="active" defaultValue={draft.active ? 'true' : 'false'} className={field}>
            <option value="true">{t('In service')}</option>
            <option value="false">{t('Retired (kept on record)')}</option>
          </select>
        </div>
      ) : null}

      {state?.error ? <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-500">{state.error}</p> : null}
      {state?.done ? <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-500">{state.done}</p> : null}
      <button type="submit" disabled={pending} className="h-10 w-full rounded-md bg-primary text-sm font-semibold disabled:opacity-60">
        {pending ? 'Saving…' : draft.id ? 'Save' : 'Add to the register'}
      </button>
    </form>
  );
}
