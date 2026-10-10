import Link from 'next/link';
import { listOpenDisasterIncidents, listPostMortems } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';
import { PostMortemForm } from './post-mortem-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Post-Mortem Reports · HikTech' };

const DEPLOYED = ['Dispatched', 'En Route', 'Arrived', 'On Scene', 'Transporting', 'Active'];
const COMMAND = ['Supervisor', 'Admin', 'SystemAdmin', 'SuperAdmin'];

export default async function PostMortemPage({ searchParams }: { searchParams: Promise<{ incident?: string }> }) {
  const { supabase, fullName, role } = await getSession();
  const params = await searchParams;
  const [reports, open] = await Promise.all([
    listPostMortems(supabase),
    listOpenDisasterIncidents(supabase).catch(() => []),
  ]);
  // Command closes out deployed incidents here; officers file from the scene on the phone.
  const canFile = COMMAND.includes(role);
  const deployed = open.filter((i) => DEPLOYED.includes(i.status)).map((i) => ({
    id: i.id, number: i.incident_number, type: i.disaster_type || i.incident_type, location: i.location_address,
    started: i.call_timestamp ?? i.incident_created_at,
  }));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Post-mortem reports</h1>
        <p className="text-muted-foreground">Official After-Action Reports. Filing one resolves the incident.</p>
      </header>

      {canFile ? (
        deployed.length ? (
          <PostMortemForm incidents={deployed} officer={fullName} initialId={params.incident} />
        ) : (
          <Card><CardContent className="p-6 text-sm text-muted-foreground">No deployed incident is waiting for a post-mortem.</CardContent></Card>
        )
      ) : null}

      <Card>
        <CardHeader><CardTitle>{reports.length} filed</CardTitle></CardHeader>
        <CardContent className="p-0">
          <SimpleTable
            headers={['Report', 'Type', 'Location', 'Duration (h)', 'Injuries', 'Fatalities', 'Displaced', 'Officer', 'Filed', '']}
            empty="No post-mortems filed."
          >
            {reports.map((r) => (
              <Tr key={r.id}>
                <Td className="font-mono text-xs">{r.report_number ?? r.incident_number}</Td>
                <Td>{r.incident_type ?? '—'}</Td>
                <Td className="max-w-[200px] truncate">{r.location ?? '—'}</Td>
                <Td className="font-mono">{r.total_duration_hours ?? '—'}</Td>
                <Td className="font-mono">{r.injuries}</Td>
                <Td className="font-mono">{r.fatalities}</Td>
                <Td className="font-mono">{r.displaced_people}</Td>
                <Td>{r.reporting_officer ?? '—'}</Td>
                <Td className="whitespace-nowrap text-xs text-muted-foreground">{formatSaTime(r.report_filed_at)}</Td>
                <Td>{r.incident_id ? <Link href={`/incidents/${r.incident_id}`} className="text-accent hover:underline">Open</Link> : null}</Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
