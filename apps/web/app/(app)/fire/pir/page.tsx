import Link from 'next/link';
import { listPublicIncidentReports } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Public Incident Reports · HikTech' };

export default async function PirPage() {
  const { supabase } = await getSession();
  const pirs = await listPublicIncidentReports(supabase);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Public incident reports</h1>
        <p className="text-muted-foreground">
          Sanitised releases authorized by the Chief. Publish from a raw report in{' '}
          <Link href="/fire/reports" className="text-accent hover:underline">Fire reports</Link>.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{pirs.length} published</CardTitle>
          <CardDescription>These are safe for media and community distribution.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable
            headers={['PIR #', 'Date', 'Type', 'Location', 'Casualties', 'Authorized by', 'Published']}
            empty="Nothing published yet."
          >
            {pirs.map((p) => (
              <Tr key={p.id}>
                <Td className="font-mono">{p.public_report_number}</Td>
                <Td>{p.date_of_incident}</Td>
                <Td>{p.incident_type ?? '—'}</Td>
                <Td className="max-w-[220px] truncate">{p.public_location}</Td>
                <Td>
                  {p.total_civilian_injuries + p.total_responder_injuries} inj ·{' '}
                  {p.total_civilian_fatalities + p.total_responder_fatalities} fat
                </Td>
                <Td>{p.authorizing_officer_name}</Td>
                <Td className="text-muted-foreground">{formatSaTime(p.published_date)}</Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
