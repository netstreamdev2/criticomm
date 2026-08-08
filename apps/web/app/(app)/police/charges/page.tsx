import Link from 'next/link';
import { listCharges } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { requireFeaturePage } from '@/lib/features';
import { getSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { openChargeAction } from '../enforcement-actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Charges · Criticomm' };

const STATUS_TONE: Record<string, string> = {
  Open: 'bg-severity-medium/15 text-severity-medium-ink',
  'Referred to Court': 'bg-accent/15 text-accent',
  Withdrawn: 'bg-muted text-muted-foreground',
  Convicted: 'bg-severity-low/15 text-severity-low-ink',
  Acquitted: 'bg-muted text-muted-foreground',
};

export default async function ChargesPage() {
  await requireFeaturePage('web.enforcement');
  const { supabase } = await getSession();
  const charges = await listCharges(supabase);
  const open = charges.filter((c) => c.status === 'Open' || c.status === 'Referred to Court').length;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Charges</h1>
        <p className="text-muted-foreground">{charges.length} on record · {open} active. Open the ledger for bail and fees.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Open a charge</CardTitle>
          <CardDescription>It gets the next CH- number; the arresting officer is you unless noted.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={openChargeAction} className="grid gap-3 md:grid-cols-4">
            <input name="accused_name" required placeholder="Accused name"
              className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm" />
            <input name="accused_id_number" placeholder="ID number"
              className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm" />
            <input name="charge_code" placeholder="Charge code"
              className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm" />
            <select name="severity" defaultValue="Serious" className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm">
              <option>Minor</option><option>Serious</option><option>Severe</option>
            </select>
            <input name="description" required placeholder="Description of the charge"
              className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm md:col-span-2" />
            <input name="statute" placeholder="Statute / act"
              className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm" />
            <input name="case_ref" placeholder="SAPS case ref (optional)"
              className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm" />
            <input name="court_name" placeholder="Court (optional)"
              className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm" />
            <input name="court_date" type="date" className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm" />
            <input name="notes" placeholder="Notes (optional)"
              className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm" />
            <button type="submit" className="h-10 rounded-md bg-primary px-4 text-sm font-semibold">Open charge</button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Register</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable
            headers={['#', 'Accused', 'Charge', 'Severity', 'Court', 'Status', 'Ledger']}
            empty="No charges on record."
          >
            {charges.map((c) => (
              <Tr key={c.id}>
                <Td className="font-mono text-xs">{c.charge_number}</Td>
                <Td>
                  <span className="font-medium">{c.accused_name}</span>
                  <div className="text-xs text-muted-foreground">{c.accused_id_number ?? ''}</div>
                </Td>
                <Td className="max-w-64">
                  <span className="text-sm">{c.description}</span>
                  <div className="text-xs text-muted-foreground">
                    {[c.charge_code, c.statute, c.officer_name ? `off. ${c.officer_name}` : null].filter(Boolean).join(' · ')}
                  </div>
                </Td>
                <Td className="text-xs font-semibold">{c.severity}</Td>
                <Td className="text-xs text-muted-foreground">
                  {[c.court_name, c.court_date].filter(Boolean).join(' · ') || '—'}
                </Td>
                <Td>
                  <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase', STATUS_TONE[c.status])}>
                    {c.status}
                  </span>
                </Td>
                <Td>
                  <Link href={`/police/charges/${c.id}`} className="text-xs font-semibold text-accent hover:underline">
                    Open →
                  </Link>
                </Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
