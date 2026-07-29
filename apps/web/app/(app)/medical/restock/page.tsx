import { listRestocks, listApparatus } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';
import { addRestockAction } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ambulance Restock · Criticom' };

export default async function RestockPage() {
  const { supabase } = await getSession();
  const [restocks, units] = await Promise.all([
    listRestocks(supabase),
    listApparatus(supabase, 'Medical'),
  ]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Ambulance inventory & restock</h1>
        <p className="text-muted-foreground">Drug and consumable usage per unit.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Log usage</CardTitle>
          <CardDescription>Recorded against your name automatically.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={addRestockAction} className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs uppercase text-muted-foreground" htmlFor="unit_id">Unit</label>
              <select id="unit_id" name="unit_id" required className="mt-1 block h-10 rounded-md border border-border bg-bg-soft px-3 text-sm">
                {units.map((u) => <option key={u.id} value={u.id}>{u.unit_number} — {u.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs uppercase text-muted-foreground" htmlFor="drug_name">Item / drug</label>
              <input id="drug_name" name="drug_name" required className="mt-1 block h-10 w-52 rounded-md border border-border bg-bg-soft px-3 text-sm" />
            </div>
            <div>
              <label className="text-xs uppercase text-muted-foreground" htmlFor="qty_used">Used</label>
              <input id="qty_used" name="qty_used" type="number" min={0} defaultValue={0} className="mt-1 block h-10 w-24 rounded-md border border-border bg-bg-soft px-3 text-sm" />
            </div>
            <div>
              <label className="text-xs uppercase text-muted-foreground" htmlFor="qty_remaining">Remaining</label>
              <input id="qty_remaining" name="qty_remaining" type="number" min={0} defaultValue={0} className="mt-1 block h-10 w-24 rounded-md border border-border bg-bg-soft px-3 text-sm" />
            </div>
            <button type="submit" className="h-10 rounded-md bg-primary px-4 text-sm font-semibold">Log</button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{restocks.length} entries</CardTitle></CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['Unit', 'Item', 'Used', 'Remaining', 'Checked by', 'Date']} empty="No restock entries.">
            {restocks.map((r) => (
              <Tr key={r.id}>
                <Td>{(r as { unit?: { unit_number?: string } }).unit?.unit_number ?? '—'}</Td>
                <Td>{r.drug_name}</Td>
                <Td className="font-mono">{r.qty_used}</Td>
                <Td className={`font-mono ${r.qty_remaining <= 2 ? 'text-severity-critical-ink' : ''}`}>{r.qty_remaining}</Td>
                <Td>{r.last_checked_by}</Td>
                <Td className="text-muted-foreground">{formatSaTime(r.restock_date)}</Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
