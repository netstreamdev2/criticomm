import Link from 'next/link';
import { listOpenDisasterIncidents, listPostMortems } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';
import { PostMortemForm } from './post-mortem-form';
import { requestT } from '@/lib/i18n';
import { PageGuide } from '@/components/office/page-guide';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Post-Mortem Reports · HikTech' };

const DEPLOYED = ['Dispatched', 'En Route', 'Arrived', 'On Scene', 'Transporting', 'Active'];
const COMMAND = ['Supervisor', 'Admin', 'SystemAdmin', 'SuperAdmin'];
// The Disaster desk runs the operation and files it (0111); the database checks each one.
const DESK = ['Dispatcher', 'ControlRoom', 'Operator', 'Disaster'];

export default async function PostMortemPage({ searchParams }: { searchParams: Promise<{ incident?: string }> }) {
  const { t } = await requestT();
  const { supabase, fullName, role } = await getSession();
  const params = await searchParams;
  const [reports, open] = await Promise.all([
    listPostMortems(supabase),
    listOpenDisasterIncidents(supabase).catch(() => []),
  ]);
  // Command and the Disaster desk close out deployed incidents here.
  const canFile = COMMAND.includes(role) || DESK.includes(role);
  const deployed = open.filter((i) => DEPLOYED.includes(i.status)).map((i) => ({
    id: i.id, number: i.incident_number, type: i.disaster_type || i.incident_type, location: i.location_address,
    started: i.call_timestamp ?? i.incident_created_at,
  }));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">{t('Post-mortem reports')}</h1>
        <p className="text-muted-foreground">{t('Official After-Action Reports. Filing one resolves the incident.')}</p>
      </header>
      <PageGuide id="disaster.post-mortems" steps={[
        t('Each incident’s after-action report, filed when the response ends. Open one, or download its PDF.'),
        t('The post-incident review, with its four sign-offs, is on the incident’s board after it is stood down.'),
      ]} />

      {canFile ? (
        deployed.length ? (
          <PostMortemForm incidents={deployed} officer={fullName} initialId={params.incident} endNow={!!params.incident} />
        ) : (
          <Card><CardContent className="p-6 text-sm text-muted-foreground">{t('No deployed incident is waiting for a post-mortem.')}</CardContent></Card>
        )
      ) : null}

      <Card>
        <CardHeader><CardTitle>{t('{length} filed', { length: reports.length })}</CardTitle></CardHeader>
        <CardContent className="p-0">
          <SimpleTable
            headers={['Report', 'Type', 'Location', 'Duration (h)', 'Injuries', 'Fatalities', 'Displaced', 'Officer', 'Filed', '']}
            empty={t('No post-mortems filed.')}
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
                <Td>{r.incident_id ? <Link href={`/incidents/${r.incident_id}`} className="text-accent hover:underline">{t('Open')}</Link> : null}</Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
