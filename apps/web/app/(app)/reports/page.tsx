import Link from 'next/link';
import { listAllIncidents } from '@criticom/api';
import type { Silo } from '@criticom/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession, siloFilter } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Reports Archive · HikTech' };

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { supabase, silo } = await getSession();
  const params = await searchParams;

  // Asked for by status, so the archive is not the closed slice of the latest 300 calls.
  const archive = await listAllIncidents(supabase, {
    silo: siloFilter(silo) as Silo | undefined,
    statuses: ['Closed', 'Resolved'],
    search: params.q,
    limit: 500,
  });

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Reports archive</h1>
        <p className="text-muted-foreground">
          Closed and resolved incidents. Open one to review its lifecycle and evidence.
        </p>
      </header>

      <form method="get" className="flex items-end gap-3">
        <input
          name="q" defaultValue={params.q}
          placeholder="Search incident #, caller, address…"
          className="h-10 w-72 rounded-md border border-border bg-bg-soft px-3 text-sm"
        />
        <button type="submit" className="h-10 rounded-md bg-primary px-4 text-sm font-semibold">Search</button>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>{archive.length} archived reports</CardTitle>
          <CardDescription>Case-manager PDF export lands with the Edge Function phase.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable
            headers={['Incident #', 'Silo', 'Type', 'Severity', 'Closed', '']}
            empty="No archived reports yet."
          >
            {archive.map((i) => (
              <Tr key={i.id}>
                <Td className="font-mono">{i.incident_number}</Td>
                <Td>{i.silo}</Td>
                <Td>{i.incident_type}</Td>
                <Td><span className="severity-pill" data-sev={i.incident_severity}>{i.incident_severity}</span></Td>
                <Td className="text-muted-foreground">{formatSaTime(i.closed_at)}</Td>
                <Td><Link href={`/incidents/${i.id}`} className="text-accent hover:underline">Open</Link></Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
