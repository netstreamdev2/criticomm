import { listFines, listTransactions } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { requireFeaturePage } from '@/lib/features';
import { getSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { issueFineAction, recordTransactionAction, setFineStatusAction } from '../enforcement-actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Fines · HikTech' };

const STATUS_TONE: Record<string, string> = {
  Unpaid: 'bg-severity-medium/15 text-severity-medium-ink',
  'Partially Paid': 'bg-severity-medium/15 text-severity-medium-ink',
  Paid: 'bg-severity-low/15 text-severity-low-ink',
  Disputed: 'bg-severity-critical/15 text-severity-critical-ink',
  Cancelled: 'bg-muted text-muted-foreground',
};

export default async function FinesPage() {
  await requireFeaturePage('web.enforcement');
  const { supabase } = await getSession();
  const [fines, txs] = await Promise.all([listFines(supabase), listTransactions(supabase)]);

  const paidAgainst = (fineId: string) =>
    txs.filter((t) => t.fine_id === fineId && (t.tx_type === 'Payment' || t.tx_type === 'Adjustment'))
      .reduce((sum, t) => sum + Number(t.amount), 0);

  const outstanding = fines
    .filter((f) => f.status === 'Unpaid' || f.status === 'Partially Paid')
    .reduce((sum, f) => sum + Math.max(0, Number(f.amount) - paidAgainst(f.id)), 0);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Fines</h1>
        <p className="text-muted-foreground">
          {fines.length} on record · R{outstanding.toFixed(2)} outstanding. Numbers are FN- and never reused.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Issue a fine</CardTitle>
          <CardDescription>It gets the next FN- number and lands on the audit trail.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={issueFineAction} className="grid gap-3 md:grid-cols-4">
            <input name="offender_name" required placeholder="Offender name"
              className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm" />
            <input name="offender_id_number" placeholder="ID number"
              className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm" />
            <input name="vehicle_reg" placeholder="Vehicle registration"
              className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm" />
            <input name="offence_code" placeholder="Offence code"
              className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm" />
            <input name="offence_description" required placeholder="Offence description"
              className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm md:col-span-2" />
            <input name="amount" required type="number" min={0} step="0.01" placeholder="Amount (R)"
              className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm" />
            <input name="due_date" type="date" className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm" />
            <input name="location" placeholder="Location"
              className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm md:col-span-2" />
            <input name="notes" placeholder="Notes (optional)"
              className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm" />
            <button type="submit" className="h-10 rounded-md bg-primary px-4 text-sm font-semibold">Issue fine</button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Register</CardTitle>
          <CardDescription>Record a payment inline — the ledger drives Partially Paid / Paid.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable
            headers={['#', 'Offender', 'Offence', 'Amount', 'Paid', 'Status', 'Payment', 'Set status']}
            empty="No fines on record."
          >
            {fines.map((f) => {
              const paid = paidAgainst(f.id);
              return (
                <Tr key={f.id}>
                  <Td className="font-mono text-xs">{f.fine_number}</Td>
                  <Td>
                    <span className="font-medium">{f.offender_name}</span>
                    <div className="text-xs text-muted-foreground">
                      {[f.offender_id_number, f.vehicle_reg].filter(Boolean).join(' · ')}
                    </div>
                  </Td>
                  <Td className="max-w-56">
                    <span className="text-sm">{f.offence_description}</span>
                    <div className="text-xs text-muted-foreground">{[f.offence_code, f.location].filter(Boolean).join(' · ')}</div>
                  </Td>
                  <Td className="font-mono">R{Number(f.amount).toFixed(2)}</Td>
                  <Td className="font-mono text-xs">{paid > 0 ? `R${paid.toFixed(2)}` : '—'}</Td>
                  <Td>
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase', STATUS_TONE[f.status])}>
                      {f.status}
                    </span>
                  </Td>
                  <Td>
                    {f.status !== 'Paid' && f.status !== 'Cancelled' ? (
                      <form action={recordTransactionAction} className="flex items-center gap-1.5">
                        <input type="hidden" name="fine_id" value={f.id} />
                        <input type="hidden" name="tx_type" value="Payment" />
                        <input name="amount" type="number" min={0.01} step="0.01"
                          defaultValue={Math.max(0, Number(f.amount) - paid).toFixed(2)}
                          aria-label="Payment amount"
                          className="h-8 w-24 rounded-md border border-border bg-bg-soft px-2 text-xs" />
                        <select name="method" className="h-8 rounded-md border border-border bg-bg-soft px-1.5 text-xs">
                          <option>EFT</option><option>Cash</option><option>Card</option><option>Other</option>
                        </select>
                        <button type="submit" className="h-8 rounded-md bg-accent px-2.5 text-xs font-semibold">Record</button>
                      </form>
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </Td>
                  <Td>
                    <form action={setFineStatusAction} className="flex items-center gap-1.5">
                      <input type="hidden" name="id" value={f.id} />
                      <select name="status" defaultValue={f.status} className="h-8 rounded-md border border-border bg-bg-soft px-1.5 text-xs">
                        <option>Unpaid</option><option>Partially Paid</option><option>Paid</option>
                        <option>Disputed</option><option>Cancelled</option>
                      </select>
                      <button type="submit" className="h-8 rounded-md bg-muted px-2.5 text-xs font-semibold hover:bg-accent/20">Set</button>
                    </form>
                  </Td>
                </Tr>
              );
            })}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
