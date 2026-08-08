import { notFound } from 'next/navigation';
import { getCharge, listTransactions } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { requireFeaturePage } from '@/lib/features';
import { getSession } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';
import { recordTransactionAction, setChargeStatusAction } from '../../enforcement-actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Charge · Criticomm' };

export default async function ChargeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireFeaturePage('web.enforcement');
  const { supabase } = await getSession();
  const { id } = await params;
  const charge = await getCharge(supabase, id);
  if (!charge) notFound();
  const txs = await listTransactions(supabase, { chargeId: id });
  const total = txs.reduce(
    (sum, t) => sum + (t.tx_type === 'Refund' ? -Number(t.amount) : Number(t.amount)), 0,
  );

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">
          <span className="font-mono">{charge.charge_number}</span> · {charge.accused_name}
        </h1>
        <p className="text-muted-foreground">
          {charge.description} — {charge.severity}, opened {formatSaTime(charge.opened_at)}
          {charge.officer_name ? ` by ${charge.officer_name}` : ''}.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Disposition</CardTitle>
            <CardDescription>Status now: <b>{charge.status}</b>{charge.case_ref ? ` · case ${charge.case_ref}` : ''}</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={setChargeStatusAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="id" value={charge.id} />
              <select name="status" defaultValue={charge.status} className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm">
                <option>Open</option><option>Referred to Court</option><option>Withdrawn</option>
                <option>Convicted</option><option>Acquitted</option>
              </select>
              <input name="court_name" defaultValue={charge.court_name ?? ''} placeholder="Court"
                className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm" />
              <input name="court_date" type="date" defaultValue={charge.court_date ?? ''}
                className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm" />
              <button type="submit" className="h-10 rounded-md bg-primary px-4 text-sm font-semibold">Update</button>
            </form>
            {charge.notes && <p className="mt-3 text-sm text-muted-foreground">{charge.notes}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Record a transaction</CardTitle>
            <CardDescription>Bail, court fees, payments and refunds against this charge.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={recordTransactionAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="charge_id" value={charge.id} />
              <select name="tx_type" className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm">
                <option>Bail</option><option>Court Fee</option><option>Payment</option>
                <option>Refund</option><option>Adjustment</option>
              </select>
              <input name="amount" required type="number" min={0.01} step="0.01" placeholder="Amount (R)"
                className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm" />
              <select name="method" className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm">
                <option>EFT</option><option>Cash</option><option>Card</option><option>Other</option>
              </select>
              <input name="reference" placeholder="Receipt / reference"
                className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm" />
              <input name="note" placeholder="Note (optional)"
                className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm" />
              <button type="submit" className="h-10 rounded-md bg-primary px-4 text-sm font-semibold">Record</button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ledger</CardTitle>
          <CardDescription>{txs.length} transactions · net R{total.toFixed(2)}.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['When', 'Type', 'Amount', 'Method', 'Reference', 'By', 'Note']} empty="Nothing recorded.">
            {txs.map((t) => (
              <Tr key={t.id}>
                <Td className="text-xs text-muted-foreground">{formatSaTime(t.recorded_at)}</Td>
                <Td className="text-xs font-semibold">{t.tx_type}</Td>
                <Td className="font-mono">R{Number(t.amount).toFixed(2)}</Td>
                <Td className="text-xs">{t.method}</Td>
                <Td className="text-xs text-muted-foreground">{t.reference ?? '—'}</Td>
                <Td className="text-xs">{t.recorded_name ?? '—'}</Td>
                <Td className="text-xs text-muted-foreground">{t.note ?? '—'}</Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
