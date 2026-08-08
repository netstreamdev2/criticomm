import { listWarrants } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { requireFeaturePage } from '@/lib/features';
import { getSession } from '@/lib/session';
import { cn, formatSaTime } from '@/lib/utils';
import { issueWarrantAction, setWarrantStatusAction } from '../enforcement-actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Warrants · Criticomm' };

const STATUS_TONE: Record<string, string> = {
  Active: 'bg-severity-critical/15 text-severity-critical-ink',
  Executed: 'bg-severity-low/15 text-severity-low-ink',
  Cancelled: 'bg-muted text-muted-foreground',
  Expired: 'bg-muted text-muted-foreground',
};

export default async function WarrantsPage() {
  await requireFeaturePage('web.enforcement');
  const { supabase } = await getSession();
  const warrants = await listWarrants(supabase);
  const active = warrants.filter((w) => w.status === 'Active').length;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Warrants</h1>
        <p className="text-muted-foreground">{warrants.length} on record · {active} active.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Register a warrant</CardTitle>
          <CardDescription>It gets the next WA- number. Court and expiry as issued.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={issueWarrantAction} className="grid gap-3 md:grid-cols-4">
            <input name="subject_name" required placeholder="Subject name"
              className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm" />
            <input name="subject_id_number" placeholder="ID number"
              className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm" />
            <select name="warrant_type" className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm">
              <option>Arrest</option><option>Search</option>
            </select>
            <input name="issued_by_court" placeholder="Issuing court"
              className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm" />
            <input name="expiry_date" type="date" className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm" />
            <input name="address" placeholder="Address"
              className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm md:col-span-2" />
            <input name="notes" placeholder="Notes (optional)"
              className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm" />
            <button type="submit" className="h-10 rounded-md bg-primary px-4 text-sm font-semibold md:col-start-4">
              Register
            </button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Register</CardTitle>
          <CardDescription>Executing stamps the moment and the officer.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable
            headers={['#', 'Subject', 'Type', 'Court', 'Issued', 'Expiry', 'Status', 'Set status']}
            empty="No warrants on record."
          >
            {warrants.map((w) => (
              <Tr key={w.id}>
                <Td className="font-mono text-xs">{w.warrant_number}</Td>
                <Td>
                  <span className="font-medium">{w.subject_name}</span>
                  <div className="text-xs text-muted-foreground">
                    {[w.subject_id_number, w.address].filter(Boolean).join(' · ')}
                  </div>
                </Td>
                <Td className="text-xs font-semibold">{w.warrant_type}</Td>
                <Td className="text-xs text-muted-foreground">{w.issued_by_court ?? '—'}</Td>
                <Td className="text-xs text-muted-foreground">{w.issue_date}</Td>
                <Td className="text-xs text-muted-foreground">{w.expiry_date ?? '—'}</Td>
                <Td>
                  <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase', STATUS_TONE[w.status])}>
                    {w.status}
                  </span>
                  {w.executed_at && (
                    <div className="text-[10px] text-muted-foreground">
                      {formatSaTime(w.executed_at)}{w.executing_officer ? ` · ${w.executing_officer}` : ''}
                    </div>
                  )}
                </Td>
                <Td>
                  {w.status === 'Active' ? (
                    <form action={setWarrantStatusAction} className="flex items-center gap-1.5">
                      <input type="hidden" name="id" value={w.id} />
                      <select name="status" className="h-8 rounded-md border border-border bg-bg-soft px-1.5 text-xs">
                        <option>Executed</option><option>Cancelled</option><option>Expired</option>
                      </select>
                      <button type="submit" className="h-8 rounded-md bg-accent px-2.5 text-xs font-semibold">Set</button>
                    </form>
                  ) : <span className="text-xs text-muted-foreground">—</span>}
                </Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
