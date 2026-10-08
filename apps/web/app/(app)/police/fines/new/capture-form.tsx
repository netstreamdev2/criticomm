'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  discountFor, ID_TYPES, isValidRsaId, LICENCE_CODES, MAX_CHARGES, NOTICE_TYPES, noticeInfo, rand,
  type FineOffence,
} from '@criticom/db/fines';
import type { FineNoticeType } from '@criticom/db/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { captureFineAction, type CaptureInput } from '../actions';

const FIELD = 'mt-1 h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm';
const LABEL = 'text-xs font-semibold uppercase tracking-wide text-muted-foreground';

const nowLocal = () => {
  // SAST, as the datetime-local field shows it.
  const d = new Date(Date.now() + 2 * 3600_000);
  return d.toISOString().slice(0, 16);
};

const blank = (): CaptureInput => ({
  noticeType: 'AARTO 01', noticeNumber: '', servedAt: nowLocal(),
  surname: '', firstNames: '', idType: 'RSA ID', idNumber: '', licenceCode: '', phone: '', address: '',
  reg: '', make: '', model: '', colour: '', street: '', streetB: '', suburb: '', place: '',
  courtName: 'Durban Magistrate’s Court', courtDate: '', notes: '',
  charges: [{ offenceId: '', description: '', amount: '' }],
});

function Text({ label, value, onChange, ...rest }: { label: string; value: string; onChange: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'>) {
  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      <input {...rest} value={value} onChange={(e) => onChange(e.target.value)} className={rest.className ?? FIELD} />
    </label>
  );
}

export function CaptureForm({ offences }: { offences: FineOffence[] }) {
  const router = useRouter();
  const [d, setD] = useState<CaptureInput>(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof CaptureInput>(k: K, v: CaptureInput[K]) => setD((cur) => ({ ...cur, [k]: v }));
  const info = noticeInfo(d.noticeType);
  const regimeOffences = useMemo(() => offences.filter((o) => o.regime === info.regime), [offences, info.regime]);

  const setCharge = (i: number, patch: Partial<CaptureInput['charges'][number]>) =>
    setD((cur) => ({ ...cur, charges: cur.charges.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));
  const amountOf = (c: CaptureInput['charges'][number]) => {
    const off = offences.find((o) => o.id === c.offenceId);
    if (off?.penalty_amount !== null && off?.penalty_amount !== undefined) return Number(off.penalty_amount);
    const n = Number(c.amount);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const total = d.charges.reduce((s, c) => s + amountOf(c), 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    const res = await captureFineAction(d);
    setBusy(false);
    if (!res.ok) { setError(res.error); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    router.push(`/police/fines/${res.id}`);
  };

  const changeType = (t: FineNoticeType) => {
    const regime = noticeInfo(t).regime;
    setD((cur) => ({
      ...cur,
      noticeType: t,
      charges: cur.charges.map((c) => {
        const off = offences.find((o) => o.id === c.offenceId);
        return off && off.regime !== regime ? { offenceId: '', description: '', amount: '' } : c;
      }),
    }));
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      {error ? <p role="alert" className="rounded-md border border-severity-critical/40 bg-severity-critical/10 p-3 text-sm font-semibold text-severity-critical-ink">{error}</p> : null}

      <Card>
        <CardHeader className="pb-3"><CardTitle>Notice</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 md:grid-cols-3">
            {NOTICE_TYPES.map((n) => (
              <button
                key={n.type}
                type="button"
                onClick={() => changeType(n.type)}
                aria-pressed={d.noticeType === n.type}
                className={`rounded-lg border p-3 text-left transition-colors ${d.noticeType === n.type ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`}
              >
                <span className="block text-sm font-bold">{n.label}</span>
                <span className="block text-xs text-muted-foreground">{n.use}</span>
              </button>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Text label="Printed notice number" value={d.noticeNumber} onChange={(v) => set('noticeNumber', v.toUpperCase())} required maxLength={30} />
            <Text label="Served (date and time)" type="datetime-local" value={d.servedAt} onChange={(v) => set('servedAt', v)} required max={nowLocal()} />
          </div>
        </CardContent>
      </Card>

      {info.personPresent ? (
        <Card>
          <CardHeader className="pb-3"><CardTitle>Infringer</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <Text label="Surname" value={d.surname} onChange={(v) => set('surname', v)} required />
            <Text label="First names" value={d.firstNames} onChange={(v) => set('firstNames', v)} />
            <label className="block">
              <span className={LABEL}>Identification</span>
              <select className={FIELD} value={d.idType} onChange={(e) => set('idType', e.target.value as CaptureInput['idType'])}>
                {ID_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>
            <div>
              <Text label="ID number" value={d.idNumber} onChange={(v) => set('idNumber', v.replace(/\s/g, '').toUpperCase())} required className={`${FIELD} font-mono`} />
              {d.idType === 'RSA ID' && d.idNumber.length === 13 ? (
                <p className={`mt-1 text-xs ${isValidRsaId(d.idNumber) ? 'text-severity-low-ink' : 'text-severity-critical-ink'}`}>
                  {isValidRsaId(d.idNumber) ? 'Valid ID number.' : 'Not a valid ID number — check each digit.'}
                </p>
              ) : null}
            </div>
            {d.noticeType === 'AARTO 01' ? (
              <label className="block">
                <span className={LABEL}>Licence code</span>
                <select className={FIELD} value={d.licenceCode} onChange={(e) => set('licenceCode', e.target.value)}>
                  <option value="">—</option>
                  {LICENCE_CODES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
            ) : null}
            <Text label="Cell number" value={d.phone} onChange={(v) => set('phone', v)} />
            <div className="md:col-span-2"><Text label="Address" value={d.address} onChange={(v) => set('address', v)} /></div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-3"><CardTitle>Vehicle and place</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <Text label="Registration" value={d.reg} onChange={(v) => set('reg', v.toUpperCase())} className={`${FIELD} font-mono font-bold`} />
          <Text label="Make" value={d.make} onChange={(v) => set('make', v)} />
          <Text label="Model" value={d.model} onChange={(v) => set('model', v)} />
          <Text label="Colour" value={d.colour} onChange={(v) => set('colour', v)} />
          <div className="md:col-span-2"><Text label="Street" value={d.street} onChange={(v) => set('street', v)} /></div>
          <Text label="Cross street" value={d.streetB} onChange={(v) => set('streetB', v)} />
          <Text label="Suburb" value={d.suburb} onChange={(v) => set('suburb', v)} />
          <div className="md:col-span-4"><Text label="Landmark / description" value={d.place} onChange={(v) => set('place', v)} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>{d.charges.length > 1 ? 'Charges' : 'Charge'}</CardTitle>
          <CardDescription>
            From the charge book where you can. When the book has an amount, that amount is charged; otherwise enter the amount written on the notice.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {d.charges.map((c, i) => {
            const off = offences.find((o) => o.id === c.offenceId);
            return (
              <div key={`c-${i}`} className="grid gap-3 rounded-lg border border-border p-3 md:grid-cols-6">
                <label className="block md:col-span-3">
                  <span className={LABEL}>Offence {d.charges.length > 1 ? i + 1 : ''}</span>
                  <select className={FIELD} value={c.offenceId} onChange={(e) => setCharge(i, { offenceId: e.target.value, description: '' })}>
                    <option value="">Not in the charge book — describe it</option>
                    {regimeOffences.map((o) => (
                      <option key={o.id} value={o.id}>{o.description}{o.code ? ` (${o.code})` : ''}{o.penalty_amount !== null ? ` — ${rand(o.penalty_amount)}` : ''}</option>
                    ))}
                  </select>
                </label>
                {!c.offenceId ? (
                  <div className="md:col-span-2"><Text label="Describe the offence" value={c.description} onChange={(v) => setCharge(i, { description: v })} /></div>
                ) : <div className="md:col-span-2" />}
                {!off || off.penalty_amount === null ? (
                  <Text label="Amount (R)" inputMode="decimal" value={c.amount} onChange={(v) => setCharge(i, { amount: v.replace(/[^0-9.]/g, '') })} />
                ) : (
                  <div>
                    <span className={LABEL}>Amount</span>
                    <p className="mt-2 font-mono text-sm font-bold">{rand(off.penalty_amount)}</p>
                  </div>
                )}
                {d.charges.length > 1 ? (
                  <button type="button" onClick={() => setD((cur) => ({ ...cur, charges: cur.charges.filter((_, j) => j !== i) }))} className="text-left text-xs font-semibold text-severity-critical-ink md:col-span-6">
                    Remove this charge
                  </button>
                ) : null}
              </div>
            );
          })}
          {d.charges.length < MAX_CHARGES ? (
            <button type="button" onClick={() => setD((cur) => ({ ...cur, charges: [...cur.charges, { offenceId: '', description: '', amount: '' }] }))} className="h-9 rounded-md border border-border px-3 text-sm font-semibold hover:bg-muted">
              Add another charge
            </button>
          ) : null}
          <p className="text-sm">
            Total <b className="font-mono">{rand(total)}</b>
            {d.noticeType === 'AARTO 01' ? <span className="text-muted-foreground"> · {rand(total - discountFor('AARTO 01', total))} if paid within 32 days</span> : null}
          </p>
        </CardContent>
      </Card>

      {d.noticeType === 'Section 56' ? (
        <Card>
          <CardHeader className="pb-3"><CardTitle>Court</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <Text label="Court" value={d.courtName} onChange={(v) => set('courtName', v)} required />
            <Text label="Date to appear" type="date" value={d.courtDate} onChange={(v) => set('courtDate', v)} required />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="pt-6">
          <Text label="Notes (optional)" value={d.notes} onChange={(v) => set('notes', v)} />
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <button type="button" onClick={() => router.push('/police/fines')} className="h-11 rounded-md border border-border px-5 text-sm font-semibold hover:bg-muted">Cancel</button>
        <button type="submit" disabled={busy} className="h-11 rounded-md bg-primary px-6 text-sm font-bold text-primary-foreground disabled:opacity-50">
          {busy ? 'Capturing…' : 'Capture notice'}
        </button>
      </div>
    </form>
  );
}
