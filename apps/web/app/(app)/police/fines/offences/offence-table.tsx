'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { rand, type FineOffence } from '@criticom/db/fines';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { saveFineOffenceAction, type OffenceInput } from '../actions';
import { useT } from '@/components/i18n';

const FIELD = 'h-9 w-full rounded-md border border-border bg-bg-soft px-2 text-sm';

const toInput = (o?: FineOffence): OffenceInput => ({
  id: o?.id,
  regime: o?.regime ?? 'AARTO',
  code: o?.code ?? '',
  description: o?.description ?? '',
  legalRef: o?.legal_ref ?? '',
  penaltyAmount: o?.penalty_amount === null || o?.penalty_amount === undefined ? '' : String(o.penalty_amount),
  demeritPoints: String(o?.demerit_points ?? 0),
  active: o?.active ?? true,
  verified: o?.verified ?? false,
});

function Row({ offence, canEdit }: { offence: FineOffence; canEdit: boolean }) {
  const { t } = useT();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [d, setD] = useState<OffenceInput>(() => toInput(offence));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (patch: Partial<OffenceInput> = {}) => {
    setBusy(true); setError(null);
    const res = await saveFineOffenceAction({ ...d, ...patch });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setEditing(false);
    router.refresh();
  };

  if (editing) {
    return (
      <tr className="bg-muted/40">
        <td className="px-3 py-2 align-top"><input className={`${FIELD} font-mono`} value={d.code} onChange={(e) => setD({ ...d, code: e.target.value })} placeholder={t('Code')} /></td>
        <td className="px-3 py-2 align-top">
          <input className={FIELD} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} />
          <input className={`${FIELD} mt-1.5`} value={d.legalRef} onChange={(e) => setD({ ...d, legalRef: e.target.value })} placeholder={t('Legal reference, e.g. NRTA s59(4)')} />
          {error ? <p className="mt-1 text-xs text-severity-critical-ink">{error}</p> : null}
        </td>
        <td className="px-3 py-2 align-top"><input className={`${FIELD} font-mono`} inputMode="decimal" value={d.penaltyAmount} onChange={(e) => setD({ ...d, penaltyAmount: e.target.value.replace(/[^0-9.]/g, '') })} placeholder="R" /></td>
        <td className="px-3 py-2 align-top"><input className={FIELD} type="number" min={0} max={6} value={d.demeritPoints} onChange={(e) => setD({ ...d, demeritPoints: e.target.value })} /></td>
        <td className="px-3 py-2 align-top">
          <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} /> {' '}{t('In use')}</label>
          <label className="mt-1 flex items-center gap-1.5 text-xs"><input type="checkbox" checked={d.verified} onChange={(e) => setD({ ...d, verified: e.target.checked })} /> {' '}{t('Verified')}</label>
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-right align-top">
          <button type="button" disabled={busy} onClick={() => void save()} className="h-8 rounded-md bg-accent px-3 text-xs font-semibold text-bg disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
          <button type="button" onClick={() => { setEditing(false); setD(toInput(offence)); setError(null); }} className="ml-2 h-8 rounded-md border border-border px-3 text-xs font-semibold">{t('Cancel')}</button>
        </td>
      </tr>
    );
  }

  return (
    <tr className={offence.active ? '' : 'opacity-50'}>
      <td className="border-b border-border px-3 py-2.5 font-mono text-xs">{offence.code ?? <span className="text-severity-medium-ink">—</span>}</td>
      <td className="border-b border-border px-3 py-2.5">
        <span className="text-sm font-medium">{offence.description}</span>
        <div className="text-xs text-muted-foreground">{offence.legal_ref ?? 'No legal reference yet'}</div>
      </td>
      <td className="whitespace-nowrap border-b border-border px-3 py-2.5 font-mono text-sm">
        {offence.penalty_amount === null ? <span className="text-severity-medium-ink">{t('Officer enters')}</span> : rand(offence.penalty_amount)}
      </td>
      <td className="border-b border-border px-3 py-2.5 text-sm">{offence.demerit_points}</td>
      <td className="border-b border-border px-3 py-2.5">
        {offence.verified
          ? <span className="rounded-full bg-severity-low/15 px-2 py-0.5 text-[10px] font-bold uppercase text-severity-low-ink" title={`${offence.verified_by_name ?? ''} ${offence.verified_at ?? ''}`}>{t('Verified')}</span>
          : <span className="rounded-full bg-severity-medium/15 px-2 py-0.5 text-[10px] font-bold uppercase text-severity-medium-ink">{t('Unverified')}</span>}
        {!offence.active ? <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">{t('Retired')}</span> : null}
      </td>
      <td className="whitespace-nowrap border-b border-border px-3 py-2.5 text-right">
        {canEdit ? <button type="button" onClick={() => setEditing(true)} className="h-8 rounded-md border border-border px-3 text-xs font-semibold hover:bg-muted">{t('Edit')}</button> : null}
      </td>
    </tr>
  );
}

function AddOffence() {
  const { t } = useT();
  const router = useRouter();
  const [d, setD] = useState<OffenceInput>(toInput());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setDone(null);
    const res = await saveFineOffenceAction(d);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setDone(`${d.description} added.`);
    setD(toInput());
    router.refresh();
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>{t('Add an offence')}</CardTitle>
        <CardDescription>{t('Officers see it on the phone the next time the app has signal.')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-3 md:grid-cols-12">
          <select className={`${FIELD} h-10 md:col-span-2`} value={d.regime} onChange={(e) => setD({ ...d, regime: e.target.value as OffenceInput['regime'] })} aria-label={t('Regime')}>
            <option value="AARTO">{t('AARTO (road traffic)')}</option>
            <option value="By-law">{t('By-law')}</option>
          </select>
          <input className={`${FIELD} h-10 font-mono md:col-span-1`} value={d.code} onChange={(e) => setD({ ...d, code: e.target.value })} placeholder={t('Code')} aria-label={t('Code')} />
          <input className={`${FIELD} h-10 md:col-span-4`} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} placeholder={t('Offence, as officers will read it')} required aria-label={t('Description')} />
          <input className={`${FIELD} h-10 md:col-span-2`} value={d.legalRef} onChange={(e) => setD({ ...d, legalRef: e.target.value })} placeholder={t('Legal reference')} aria-label={t('Legal reference')} />
          <input className={`${FIELD} h-10 font-mono md:col-span-1`} inputMode="decimal" value={d.penaltyAmount} onChange={(e) => setD({ ...d, penaltyAmount: e.target.value.replace(/[^0-9.]/g, '') })} placeholder="R" aria-label={t('Penalty')} />
          <input className={`${FIELD} h-10 md:col-span-1`} type="number" min={0} max={6} value={d.demeritPoints} onChange={(e) => setD({ ...d, demeritPoints: e.target.value })} aria-label={t('Demerit points')} />
          <button type="submit" disabled={busy} className="h-10 rounded-md bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50 md:col-span-1">{busy ? '…' : 'Add'}</button>
          {error ? <p className="text-sm text-severity-critical-ink md:col-span-12">{error}</p> : null}
          {done ? <p className="text-sm text-severity-low-ink md:col-span-12">{done}</p> : null}
        </form>
      </CardContent>
    </Card>
  );
}

export function OffenceTable({ offences, canEdit }: { offences: FineOffence[]; canEdit: boolean }) {
  const { t } = useT();
  const groups: Array<{ regime: FineOffence['regime']; title: string; note: string }> = [
    { regime: 'AARTO', title: 'Road traffic (AARTO 01)', note: 'National Road Traffic Act offences, served on an AARTO 01 notice.' },
    { regime: 'By-law', title: 'Municipal by-laws (Section 56 / 341)', note: 'eThekwini by-law offences, served on a Criminal Procedure Act notice.' },
  ];
  return (
    <div className="space-y-5">
      {canEdit ? <AddOffence /> : null}
      {groups.map((g) => {
        const rows = offences.filter((o) => o.regime === g.regime);
        return (
          <Card key={g.regime}>
            <CardHeader className="pb-2">
              <CardTitle>{g.title} · {rows.length}</CardTitle>
              <CardDescription>{g.note}</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="border-b border-border px-3 py-2">{t('Code')}</th>
                    <th className="border-b border-border px-3 py-2">{t('Offence')}</th>
                    <th className="border-b border-border px-3 py-2">{t('Penalty')}</th>
                    <th className="border-b border-border px-3 py-2">{t('Points')}</th>
                    <th className="border-b border-border px-3 py-2">{t('State')}</th>
                    <th className="border-b border-border px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o) => <Row key={o.id} offence={o} canEdit={canEdit} />)}
                  {rows.length === 0 ? <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">{t('No offences yet.')}</td></tr> : null}
                </tbody>
              </table>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
