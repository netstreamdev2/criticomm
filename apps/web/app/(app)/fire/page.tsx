import Link from 'next/link';
import { listFirefighterReports, listHydrants, listPublicIncidentReports } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Fire & Rescue · Criticom' };

export default async function FirePage() {
  const { supabase } = await getSession();
  const [reports, hydrants, pirs] = await Promise.all([
    listFirefighterReports(supabase),
    listHydrants(supabase),
    listPublicIncidentReports(supabase),
  ]);
  const operationalHydrants = hydrants.filter((h) => h.status === 'Operational').length;

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Fire & Rescue</h1>
          <p className="text-muted-foreground">Incident reports, hydrants and public releases.</p>
        </div>
        <Link href="/fire/reports/new" className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold">
          + New fire report
        </Link>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Fire reports</p>
          <p className="mt-2 text-3xl font-bold">{reports.length}</p>
          <Link href="/fire/reports" className="text-sm text-accent hover:underline">View all →</Link>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Hydrants operational</p>
          <p className="mt-2 text-3xl font-bold text-severity-low-ink">{operationalHydrants}/{hydrants.length}</p>
          <Link href="/fire/hydrants" className="text-sm text-accent hover:underline">Hydrant register →</Link>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Public reports (PIR)</p>
          <p className="mt-2 text-3xl font-bold">{pirs.length}</p>
          <Link href="/fire/pir" className="text-sm text-accent hover:underline">PIR desk →</Link>
        </CardContent></Card>
      </section>

      <Card>
        <CardHeader><CardTitle>Recent fire reports</CardTitle></CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['Report #', 'Date', 'Type', 'Location', 'Casualties', '']} empty="No fire reports yet.">
            {reports.slice(0, 10).map((r) => (
              <Tr key={r.id}>
                <Td className="font-mono">{r.report_number}</Td>
                <Td>{r.date_of_incident}</Td>
                <Td>{r.type_of_incident ?? '—'}</Td>
                <Td className="max-w-[240px] truncate">{r.location ?? '—'}</Td>
                <Td>
                  {r.civilian_injuries + r.firefighter_injuries} inj ·{' '}
                  {r.civilian_fatalities + r.firefighter_fatalities} fat
                </Td>
                <Td><Link href={`/fire/reports/${r.id}`} className="text-accent hover:underline">Open</Link></Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
