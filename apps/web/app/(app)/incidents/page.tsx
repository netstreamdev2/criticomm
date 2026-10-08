import Link from 'next/link';
import { listAllIncidents } from '@criticom/api';
import type { IncidentStatus, Silo } from '@criticom/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession, siloFilter } from '@/lib/session';
import { IncidentLive } from '@/components/incident-live';
import { timeAgo } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Incidents · HikTech' };

const STATUSES: IncidentStatus[] = [
  'New', 'Pending', 'Pending Dispatch', 'Pending Analysis', 'Dispatched',
  'En Route', 'Arrived', 'On Scene', 'Transporting', 'Active', 'Closed', 'Resolved',
];
const SILOS: Silo[] = ['Ethekwini', 'MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster'];

export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; silo?: string }>;
}) {
  const { supabase, silo } = await getSession();
  const params = await searchParams;

  const incidents = await listAllIncidents(supabase, {
    silo: (params.silo as Silo | undefined) ?? siloFilter(silo),
    status: params.status as IncidentStatus | undefined,
    search: params.q,
  });

  return (
    <div className="space-y-4">
      {/* Status changes from the field re-render the list. */}
      <IncidentLive />
      <header>
        <h1 className="text-2xl font-bold">All incidents</h1>
        <p className="text-muted-foreground">Every logged call across your visible silos.</p>
      </header>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs uppercase text-muted-foreground" htmlFor="q">Search</label>
          <input
            id="q" name="q" defaultValue={params.q}
            placeholder="Incident #, caller, address…"
            className="mt-1 block h-10 w-64 rounded-md border border-border bg-bg-soft px-3 text-sm"
          />
        </div>
        <div>
          <label className="text-xs uppercase text-muted-foreground" htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={params.status ?? ''} className="mt-1 block h-10 rounded-md border border-border bg-bg-soft px-3 text-sm">
            <option value="">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        {silo === 'Ethekwini' && (
          <div>
            <label className="text-xs uppercase text-muted-foreground" htmlFor="silo">Silo</label>
            <select id="silo" name="silo" defaultValue={params.silo ?? ''} className="mt-1 block h-10 rounded-md border border-border bg-bg-soft px-3 text-sm">
              <option value="">All</option>
              {SILOS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}
        <button type="submit" className="h-10 rounded-md bg-primary px-4 text-sm font-semibold">Filter</button>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>{incidents.length} incidents</CardTitle>
          <CardDescription>Click a row for the full lifecycle.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable
            headers={['Incident #', 'Silo', 'Severity', 'Status', 'Type', 'Location', 'Logged', '']}
            empty="No incidents match your filters."
          >
            {incidents.map((i) => (
              <Tr key={i.id}>
                <Td className="font-mono">{i.incident_number}</Td>
                <Td>{i.silo}</Td>
                <Td><span className="severity-pill" data-sev={i.incident_severity}>{i.incident_severity}</span></Td>
                <Td>{i.status}</Td>
                <Td>{i.incident_type}</Td>
                <Td className="max-w-[260px] truncate">{i.location_address}</Td>
                <Td className="text-muted-foreground">{timeAgo(i.incident_created_at)}</Td>
                <Td>
                  <Link href={`/incidents/${i.id}`} className="text-accent hover:underline">Open</Link>
                </Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
