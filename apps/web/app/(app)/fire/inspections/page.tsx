import Link from 'next/link';
import { Search } from 'lucide-react';
import { listFireInspections } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormSection, SelectField, TextAreaField, TextField } from '@/components/fields';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';
import { fileInspectionAction } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Fire Safety Inspections · HikTech' };

type Params = { q?: string; result?: string; error?: string; filed?: string };
const FILERS = ['Firefighter', 'FireChief', 'Admin', 'SystemAdmin', 'SuperAdmin'];
const field = 'h-9 rounded-md border border-border bg-bg-soft px-2.5 text-sm';

export default async function FireInspectionsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { supabase, role, silo } = await getSession();
  const params = await searchParams;
  // Empty until migration 0066 is run.
  const rows = await listFireInspections(supabase, params).catch(() => []);
  const canFile = FILERS.includes(role) && silo === 'MetroFire';
  const filtered = Boolean(params.q || params.result);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Fire Safety Inspections</h1>
        <p className="text-muted-foreground">Business and site inspections, newest first.</p>
      </header>

      {params.error ? (
        <div role="alert" className="rounded-lg border border-severity-critical/40 bg-severity-critical/10 px-4 py-3 text-sm text-severity-critical-ink">
          {params.error}
        </div>
      ) : null}
      {params.filed ? (
        <div className="rounded-lg border border-severity-low/40 bg-severity-low/10 px-4 py-3 text-sm text-severity-low-ink">
          Inspection {params.filed} filed.
        </div>
      ) : null}

      {canFile ? (
        <form action={fileInspectionAction} className="space-y-4">
          <FormSection title="New inspection">
            <TextField name="business_name" label="Business / Site Name" required placeholder="e.g. Skyline Mall" />
            <TextField name="contact_person" label="Contact Person" required placeholder="Manager Name" />
            <TextField name="address" label="Site Address" required placeholder="123 Main Street" />
            <SelectField name="extinguishers" label="Extinguishers Present & Serviced?" required options={[
              { value: 'Yes', label: 'Yes - Compliant' }, { value: 'No', label: 'No - Violation' }, { value: 'N/A', label: 'Not Applicable' },
            ]} />
            <SelectField name="exits" label="Emergency Exits Clear?" required options={[
              { value: 'Yes', label: 'Yes - Compliant' }, { value: 'No', label: 'No - Blocked / Violation' },
            ]} />
            <SelectField name="result" label="Final Inspection Result" required options={[
              { value: 'PASS', label: 'PASS - Premises is Safe' }, { value: 'FAIL', label: 'FAIL - Major Hazards Present' },
            ]} />
            <TextAreaField name="notes" label="Additional Inspector Notes" placeholder="Detail any violations, hazards, or warnings issued..." className="sm:col-span-2 lg:col-span-3" />
          </FormSection>
          <button type="submit" className="h-11 w-full rounded-md bg-primary text-sm font-semibold">File inspection</button>
        </form>
      ) : null}

      <form method="get" className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-bg-card px-3 py-2.5">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input name="q" defaultValue={params.q} placeholder="Search business, address, contact or reference" aria-label="Search inspections" className={`${field} w-full pl-8`} />
        </div>
        <select name="result" defaultValue={params.result ?? ''} aria-label="Result" className={field}>
          <option value="">All results</option>
          <option value="PASS">PASS</option>
          <option value="FAIL">FAIL</option>
        </select>
        <button type="submit" className="h-9 rounded-md bg-accent px-4 text-sm font-semibold">Apply</button>
        {filtered ? <Link href="/fire/inspections" className="text-sm text-accent hover:underline">Clear</Link> : null}
      </form>

      <Card>
        <CardHeader><CardTitle>{rows.length} inspection{rows.length === 1 ? '' : 's'}</CardTitle></CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['Reference', 'Business / Site', 'Address', 'Extinguishers', 'Exits', 'Result', 'Inspector', 'Inspected']}
            empty={filtered ? 'No inspections match.' : 'No inspections yet.'}>
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td className="font-mono text-xs">{r.inspection_ref}</Td>
                <Td className="font-semibold">{r.business_name}<div className="text-xs font-normal text-muted-foreground">{r.contact_person}</div></Td>
                <Td className="max-w-[220px] truncate">{r.address}</Td>
                <Td>{r.extinguishers}</Td>
                <Td>{r.exits}</Td>
                <Td>
                  <span className={r.result === 'FAIL' ? 'font-bold text-severity-critical-ink' : 'font-bold text-severity-low-ink'}>{r.result}</span>
                  {r.notes ? <div className="max-w-[240px] whitespace-pre-wrap text-xs text-muted-foreground">{r.notes}</div> : null}
                </Td>
                <Td className="text-xs">{r.inspector_name ?? '—'}</Td>
                <Td className="whitespace-nowrap text-xs text-muted-foreground">{formatSaTime(r.inspected_at)}</Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
