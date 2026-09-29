import Link from 'next/link';
import { listMetroReports } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Police Records · HikTech' };

export default async function PoliceRecordsPage() {
  const { supabase } = await getSession();
  const reports = await listMetroReports(supabase);

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Metro police records</h1>
          <p className="text-muted-foreground">All filed reports, newest first.</p>
        </div>
        <Link href="/police/reports/new" className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold">
          + New report
        </Link>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{reports.length} reports</CardTitle>
          <CardDescription>Offense wizard entries and field reports.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable
            headers={['Case #', 'Category', 'Date', 'Officer', 'Offender', 'Arrest', 'Fine', '']}
            empty="No reports filed."
          >
            {reports.map((r) => (
              <Tr key={r.id}>
                <Td className="font-mono">{r.case_number}</Td>
                <Td>{r.incident_category ?? '—'}</Td>
                <Td>{r.date_of_offense}</Td>
                <Td>{r.officer_name ?? '—'}</Td>
                <Td>{r.offender_name ?? r.suspect_name ?? '—'}</Td>
                <Td>{r.arrest_made ?? 'No'}</Td>
                <Td className="font-mono">{r.fine_amount ? `R${r.fine_amount}` : '—'}</Td>
                <Td><Link href={`/police/reports/${r.id}`} className="text-accent hover:underline">Open</Link></Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
