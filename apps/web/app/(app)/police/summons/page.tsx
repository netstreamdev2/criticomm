import { listSummonses } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { requireFeaturePage } from '@/lib/features';
import { getSession } from '@/lib/session';
import { cn, formatSaTime } from '@/lib/utils';
import { issueSummonsAction, setSummonsStatusAction } from '../enforcement-actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Summons · HikTech' };

const STATUS_TONE: Record<string, string> = {
  Issued: 'bg-severity-medium/15 text-severity-medium-ink',
  Served: 'bg-accent/15 text-accent',
  'Court Date Set': 'bg-accent/15 text-accent',
  Concluded: 'bg-severity-low/15 text-severity-low-ink',
  Withdrawn: 'bg-muted text-muted-foreground',
};

export default async function SummonsPage() {
  await requireFeaturePage('web.enforcement');
  const { supabase } = await getSession();
  const summonses = await listSummonses(supabase);
  const outstanding = summonses.filter((s) => s.status === 'Issued').length;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Summons</h1>
        <p className="text-muted-foreground">{summonses.length} on record · {outstanding} awaiting service.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Issue a summons</CardTitle>
          <CardDescription>It gets the next SM- number. Service is recorded from the register below.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={issueSummonsAction} className="grid gap-3 md:grid-cols-4">
            <input name="recipient_name" required placeholder="Recipient name"
              className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm" />
            <input name="recipient_id_number" placeholder="ID number"
              className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm" />
            <input name="offence" required placeholder="Offence"
              className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm md:col-span-2" />
            <input name="court_name" placeholder="Court"
              className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm" />
            <input name="court_date" type="date" className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm" />
            <input name="address" placeholder="Service address"
              className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm md:col-span-2" />
            <input name="notes" placeholder="Notes (optional)"
              className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm md:col-span-3" />
            <button type="submit" className="h-10 rounded-md bg-primary px-4 text-sm font-semibold">Issue</button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Register</CardTitle>
          <CardDescription>Serving stamps the moment and the server.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable
            headers={['#', 'Recipient', 'Offence', 'Court', 'Court date', 'Status', 'Set status']}
            empty="No summonses on record."
          >
            {summonses.map((s) => (
              <Tr key={s.id}>
                <Td className="font-mono text-xs">{s.summons_number}</Td>
                <Td>
                  <span className="font-medium">{s.recipient_name}</span>
                  <div className="text-xs text-muted-foreground">
                    {[s.recipient_id_number, s.address].filter(Boolean).join(' · ')}
                  </div>
                </Td>
                <Td className="max-w-56 text-sm">{s.offence}</Td>
                <Td className="text-xs text-muted-foreground">{s.court_name ?? '—'}</Td>
                <Td className="text-xs text-muted-foreground">{s.court_date ?? '—'}</Td>
                <Td>
                  <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase', STATUS_TONE[s.status])}>
                    {s.status}
                  </span>
                  {s.served_at && (
                    <div className="text-[10px] text-muted-foreground">
                      {formatSaTime(s.served_at)}{s.served_by ? ` · ${s.served_by}` : ''}
                    </div>
                  )}
                </Td>
                <Td>
                  {s.status !== 'Concluded' && s.status !== 'Withdrawn' ? (
                    <form action={setSummonsStatusAction} className="flex items-center gap-1.5">
                      <input type="hidden" name="id" value={s.id} />
                      <select name="status" className="h-8 rounded-md border border-border bg-bg-soft px-1.5 text-xs">
                        <option>Served</option><option>Court Date Set</option>
                        <option>Concluded</option><option>Withdrawn</option>
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
