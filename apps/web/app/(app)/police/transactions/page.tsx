import Link from 'next/link';
import { listCharges, listFines, listTransactions } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { requireFeaturePage } from '@/lib/features';
import { getSession } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';
import { recordTransactionAction } from '../enforcement-actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Charge Transactions · HikTech' };

export default async function TransactionsPage() {
  await requireFeaturePage('web.enforcement');
  const { supabase } = await getSession();
  const [txs, charges, fines] = await Promise.all([
    listTransactions(supabase),
    listCharges(supabase),
    listFines(supabase),
  ]);

  const chargeNo = new Map(charges.map((c) => [c.id, c.charge_number]));
  const fineNo = new Map(fines.map((f) => [f.id, f.fine_number]));
  const takings = txs.reduce(
    (sum, t) => sum + (t.tx_type === 'Refund' ? -Number(t.amount) : Number(t.amount)), 0,
  );

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Charge transactions</h1>
        <p className="text-muted-foreground">
          The money that moves against fines and charges — {txs.length} entries, net R{takings.toFixed(2)}.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Record a transaction</CardTitle>
          <CardDescription>Pick the document it settles against — a charge or a fine, never neither.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={recordTransactionAction} className="grid gap-3 md:grid-cols-3">
            <select name="charge_id" className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm">
              <option value="">No charge</option>
              {charges.map((c) => (
                <option key={c.id} value={c.id}>{c.charge_number} — {c.accused_name}</option>
              ))}
            </select>
            <select name="fine_id" className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm">
              <option value="">No fine</option>
              {fines.map((f) => (
                <option key={f.id} value={f.id}>{f.fine_number} — {f.offender_name}</option>
              ))}
            </select>
            <select name="tx_type" className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm">
              <option>Payment</option><option>Bail</option><option>Court Fee</option>
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
              className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm md:col-span-2" />
            <button type="submit" className="h-10 rounded-md bg-primary px-4 text-sm font-semibold">Record</button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ledger</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['When', 'Against', 'Type', 'Amount', 'Method', 'Reference', 'By']} empty="No transactions recorded.">
            {txs.map((t) => (
              <Tr key={t.id}>
                <Td className="text-xs text-muted-foreground">{formatSaTime(t.recorded_at)}</Td>
                <Td className="font-mono text-xs">
                  {t.charge_id ? (
                    <Link href={`/police/charges/${t.charge_id}`} className="text-accent hover:underline">
                      {chargeNo.get(t.charge_id) ?? 'Charge'}
                    </Link>
                  ) : (fineNo.get(t.fine_id ?? '') ?? '—')}
                </Td>
                <Td className="text-xs font-semibold">{t.tx_type}</Td>
                <Td className="font-mono">R{Number(t.amount).toFixed(2)}</Td>
                <Td className="text-xs">{t.method}</Td>
                <Td className="text-xs text-muted-foreground">{t.reference ?? '—'}</Td>
                <Td className="text-xs">{t.recorded_name ?? '—'}</Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
