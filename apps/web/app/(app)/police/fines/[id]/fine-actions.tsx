'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { rand, type FineStatus } from '@criticom/db/fines';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cancelFineAction, recordFinePaymentAction, setFineNoticeNumberAction, setFineStatusAction } from '../actions';

type ChargeRef = { id: string; fineNumber: string; status: FineStatus; noticeNumber: string | null; due: number };

const FIELD = 'mt-1 h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm';
const LABEL = 'text-xs font-semibold uppercase tracking-wide text-muted-foreground';

/**
 * What may still change on a served notice: money in, a representation, a
 * cancellation, and the official number once. Each goes through a database
 * function that checks the caller and writes the audit trail.
 */
export function FineActions({ charges, canManage, canNumber }: { charges: ChargeRef[]; canManage: boolean; canNumber: boolean }) {
  const router = useRouter();
  const open = charges.filter((c) => c.status !== 'Cancelled');
  const [target, setTarget] = useState(open[0]?.id ?? charges[0]?.id ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const today = new Date(Date.now() + 2 * 3600_000).toISOString().slice(0, 10);
  const [pay, setPay] = useState({ txType: 'Payment' as 'Payment' | 'Refund' | 'Adjustment', amount: '', method: 'EFT' as 'Cash' | 'Card' | 'EFT' | 'Other', reference: '', note: '', paidOn: today });
  const [reason, setReason] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const [number, setNumber] = useState('');

  const charge = charges.find((c) => c.id === target);
  const run = async (key: string, work: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) => {
    setBusy(key); setError(null); setDone(null);
    const res = await work();
    setBusy(null);
    if (!res.ok) { setError(res.error); return false; }
    setDone(success);
    router.refresh();
    return true;
  };

  if (!canManage && !(canNumber && charges.some((c) => !c.noticeNumber))) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Actions</CardTitle>
        <CardDescription>Nothing that was served can be edited. These are kept on the record.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {charges.length > 1 ? (
          <label className="block">
            <span className={LABEL}>Charge</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)} className={FIELD}>
              {charges.map((c) => <option key={c.id} value={c.id}>{c.fineNumber} · {c.status}</option>)}
            </select>
          </label>
        ) : null}

        {error ? <p role="alert" className="rounded-md border border-severity-critical/40 bg-severity-critical/10 p-3 text-sm text-severity-critical-ink">{error}</p> : null}
        {done ? <output className="block rounded-md border border-severity-low/40 bg-severity-low/10 p-3 text-sm text-severity-low-ink">{done}</output> : null}

        {canManage && charge && charge.status !== 'Cancelled' ? (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run('pay', () => recordFinePaymentAction({ fineId: charge.id, ...pay }), `${pay.txType} recorded on ${charge.fineNumber}.`)
                .then((ok) => { if (ok) setPay({ ...pay, amount: '', reference: '', note: '', paidOn: today }); });
            }}
          >
            <p className="text-sm font-bold">Record money</p>
            <p className="text-xs text-muted-foreground">{charge.fineNumber}: {rand(charge.due)} due now.</p>
            <div className="grid grid-cols-2 gap-2">
              <label><span className={LABEL}>Type</span>
                <select className={FIELD} value={pay.txType} onChange={(e) => setPay({ ...pay, txType: e.target.value as typeof pay.txType })}>
                  <option>Payment</option><option>Refund</option><option>Adjustment</option>
                </select>
              </label>
              <label><span className={LABEL}>Method</span>
                <select className={FIELD} value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value as typeof pay.method })}>
                  <option>EFT</option><option>Cash</option><option>Card</option><option>Other</option>
                </select>
              </label>
              <label><span className={LABEL}>Amount (R)</span>
                <input className={FIELD} inputMode="decimal" value={pay.amount} placeholder={charge.due.toFixed(2)} onChange={(e) => setPay({ ...pay, amount: e.target.value.replace(/[^0-9.]/g, '') })} />
              </label>
              <label><span className={LABEL}>Receipt / reference</span>
                <input className={FIELD} value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} />
              </label>
            </div>
            <label className="block"><span className={LABEL}>Date on the receipt</span>
              <input className={FIELD} type="date" max={today} value={pay.paidOn} onChange={(e) => setPay({ ...pay, paidOn: e.target.value })} />
            </label>
            <p className="text-xs text-muted-foreground">Paid inside the 32 days keeps the AARTO discount, even when captured later.</p>
            <input className={FIELD} placeholder="Note (optional)" value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} />
            <button type="submit" disabled={busy !== null} className="h-10 w-full rounded-md bg-accent text-sm font-semibold text-bg disabled:opacity-50">
              {busy === 'pay' ? 'Recording…' : 'Record'}
            </button>
          </form>
        ) : null}

        {canManage && charge && (charge.status === 'Unpaid' || charge.status === 'Partially Paid' || charge.status === 'Disputed') ? (
          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-sm font-bold">Representation</p>
            <p className="text-xs text-muted-foreground">
              {charge.status === 'Disputed'
                ? 'A representation is lodged. Set back to Unpaid if it was decided against the infringer.'
                : 'Mark Disputed when the infringer lodges a representation (AARTO 08) or the matter is contested.'}
            </p>
            <input className={FIELD} placeholder="Note, e.g. the representation reference" value={statusNote} onChange={(e) => setStatusNote(e.target.value)} />
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void run('status', () => setFineStatusAction(charge.id, charge.status === 'Disputed' ? 'Unpaid' : 'Disputed', statusNote), 'Status changed.').then((ok) => { if (ok) setStatusNote(''); })}
              className="h-10 w-full rounded-md border border-border text-sm font-semibold hover:bg-muted disabled:opacity-50"
            >
              {charge.status === 'Disputed' ? 'Set back to Unpaid' : 'Mark Disputed'}
            </button>
          </div>
        ) : null}

        {canNumber && charge && !charge.noticeNumber ? (
          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-sm font-bold">Official notice number</p>
            <p className="text-xs text-muted-foreground">Add the AARTO or book number once it is known. It can be written only once.</p>
            <input className={FIELD} value={number} onChange={(e) => setNumber(e.target.value.toUpperCase())} placeholder="e.g. 12-3456-789012345-6" />
            <button
              type="button"
              disabled={busy !== null || !number.trim()}
              onClick={() => void run('number', () => setFineNoticeNumberAction(charge.id, number), 'Notice number added.').then((ok) => { if (ok) setNumber(''); })}
              className="h-10 w-full rounded-md border border-border text-sm font-semibold hover:bg-muted disabled:opacity-50"
            >
              Add number
            </button>
          </div>
        ) : null}

        {canManage && charge && charge.status !== 'Cancelled' && charge.status !== 'Paid' ? (
          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-sm font-bold text-severity-critical-ink">Cancel {charge.fineNumber}</p>
            <p className="text-xs text-muted-foreground">For a notice issued in error. It stays on the register, marked cancelled, with your reason. Refund any money first.</p>
            <textarea
              className="mt-1 min-h-20 w-full rounded-md border border-border bg-bg-soft p-3 text-sm"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why it is cancelled (at least 10 characters)"
            />
            <button
              type="button"
              disabled={busy !== null || reason.trim().length < 10}
              onClick={() => {
                if (!window.confirm(`Cancel ${charge.fineNumber}? This cannot be undone.`)) return;
                void run('cancel', () => cancelFineAction(charge.id, reason), `${charge.fineNumber} cancelled.`).then((ok) => { if (ok) setReason(''); });
              }}
              className="h-10 w-full rounded-md bg-severity-critical text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy === 'cancel' ? 'Cancelling…' : 'Cancel this fine'}
            </button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
