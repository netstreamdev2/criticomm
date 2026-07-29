import Link from 'next/link';
import { listMetroReports, listFirearmAuthorizations } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession } from '@/lib/session';
import { timeAgo } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Police Operations · Criticom' };

const WIZARDS = ['Arrest', 'Accident', 'Vehicle', 'Firearm', 'Incident', 'Tow', 'Dog'];

export default async function PolicePage() {
  const { supabase } = await getSession();
  const [reports, firearms] = await Promise.all([
    listMetroReports(supabase),
    listFirearmAuthorizations(supabase),
  ]);
  const outstanding = firearms.filter((f) => !f.date_received);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Police operations</h1>
        <p className="text-muted-foreground">Metro reports, offense wizards and armoury.</p>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Reports filed</p>
          <p className="mt-2 text-3xl font-bold">{reports.length}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Firearms out</p>
          <p className="mt-2 text-3xl font-bold text-severity-medium-ink">{outstanding.length}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Quick links</p>
          <div className="mt-2 flex flex-wrap gap-2 text-sm">
            <Link className="text-accent hover:underline" href="/police/reports">Records</Link>
            <Link className="text-accent hover:underline" href="/police/firearms">Armoury</Link>
            <Link className="text-accent hover:underline" href="/police/security">Security</Link>
            <Link className="text-accent hover:underline" href="/police/crime-hotspots">Hotspots</Link>
          </div>
        </CardContent></Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>New report</CardTitle>
          <CardDescription>Pick the offense wizard — same seven flows as V4.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {WIZARDS.map((w) => (
            <Link
              key={w}
              href={`/police/reports/new?type=${w}`}
              className="rounded-md border border-border bg-bg-soft px-4 py-2 text-sm font-semibold hover:bg-muted"
            >
              {w}
            </Link>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent reports</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['Case #', 'Category', 'Officer', 'Location', 'Filed', '']} empty="No reports yet.">
            {reports.slice(0, 10).map((r) => (
              <Tr key={r.id}>
                <Td className="font-mono">{r.case_number}</Td>
                <Td>{r.incident_category ?? '—'}</Td>
                <Td>{r.officer_name ?? '—'}</Td>
                <Td className="max-w-[220px] truncate">{r.location ?? '—'}</Td>
                <Td className="text-muted-foreground">{timeAgo(r.created_at)}</Td>
                <Td><Link href={`/police/reports/${r.id}`} className="text-accent hover:underline">Open</Link></Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
