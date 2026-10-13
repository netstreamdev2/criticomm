import { Suspense } from 'react';
import Link from 'next/link';
import { listActiveIncidents, listFirefighterReports, listHydrants, listPublicIncidentReports } from '@criticom/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { IncidentLive } from '@/components/incident-live';
import { getSession } from '@/lib/session';
import { timeAgo } from '@/lib/utils';
import { CritiTiles } from '@/components/criti/insight-tiles';
import { AttendanceNow } from '@/components/schedule/attendance-now';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Fire & Rescue · HikTech' };

/** The crew's place on an incident, in the words the desk uses. */
const STATUS_LABEL: Record<string, string> = {
  Dispatched: 'Waiting for a crew', 'En Route': 'Crew en route', Arrived: 'Crew on scene', 'On Scene': 'Crew on scene',
  Transporting: 'Transporting', Active: 'Active',
};

/**
 * Fire & Rescue: the incidents crews are working right now — live, as they
 * press En Route, On Scene and Transporting on the phone — and the fire
 * reports that closed them, with hydrants and public releases.
 */
export default async function FirePage() {
  const { supabase, role, silo } = await getSession();
  const [active, reports, hydrants, pirs] = await Promise.all([
    listActiveIncidents(supabase, 'MetroFire').catch(() => []),
    listFirefighterReports(supabase),
    listHydrants(supabase),
    listPublicIncidentReports(supabase),
  ]);
  const operationalHydrants = hydrants.filter((h) => h.status === 'Operational').length;
  const live = active.filter((i) => !['New', 'Pending', 'Pending Dispatch', 'Pending Analysis'].includes(i.status));
  const count = (s: string[]) => live.filter((i) => s.includes(i.status)).length;
  const today = new Date(Date.now() + 2 * 3600_000).toISOString().slice(0, 10);
  const filedToday = reports.filter((r) => (r.report_submission_date ?? '').slice(0, 10) === today).length;

  return (
    <div className="space-y-6">
      {/* Crews' status changes re-render this page. */}
      <IncidentLive />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Fire & Rescue</h1>
          <p className="text-muted-foreground">Live incidents, fire reports, hydrants and public releases.</p>
        </div>
        <Link href="/fire/reports/new" className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-semibold hover:bg-muted">
          + Capture a fire report
        </Link>
      </header>

      {/* Criti: what needs attention now, for this person. */}
      <CritiTiles />
      <Suspense fallback={null}><AttendanceNow viewerRole={role} ownSilo={silo} silo={'MetroFire'} /></Suspense>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          { label: 'Waiting for a crew', value: count(['Dispatched']), tone: 'text-severity-medium-ink' },
          { label: 'En route', value: count(['En Route']), tone: 'text-accent' },
          { label: 'On scene', value: count(['Arrived', 'On Scene']), tone: 'text-severity-low-ink' },
          { label: 'Transporting', value: count(['Transporting']), tone: 'text-severity-high-ink' },
          { label: 'Reports filed today', value: filedToday, tone: '' },
        ].map((t) => (
          <Card key={t.label}><CardContent className="p-4">
            <p className="text-xs uppercase text-muted-foreground">{t.label}</p>
            <p className={`mt-2 text-3xl font-bold ${t.tone}`}>{t.value}</p>
          </CardContent></Card>
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Live Fire incidents ({live.length})</CardTitle>
          <CardDescription>Updates by itself as crews move. A Fire incident is resolved when its fire report is filed.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['Incident', 'Type', 'Severity', 'Crew', 'Lead', 'Location', 'Dispatched', '']} empty="No live Fire incidents.">
            {live.map((i) => (
              <Tr key={i.id}>
                <Td className="font-mono">{i.incident_number}</Td>
                <Td>{i.incident_type}</Td>
                <Td><span className="severity-pill" data-sev={i.incident_severity}>{i.incident_severity}</span></Td>
                <Td><span className="status-badge" data-status={i.status}>{STATUS_LABEL[i.status] ?? i.status}</span></Td>
                <Td className="text-xs">{i.responding_officer ?? '—'}</Td>
                <Td className="max-w-[220px] truncate">{i.location_address}</Td>
                <Td className="text-xs text-muted-foreground">{timeAgo(i.dispatch_time ?? i.incident_created_at)}</Td>
                <Td><Link href={`/incidents/${i.id}`} className="text-accent hover:underline">Open</Link></Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>

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
          <SimpleTable headers={['Report #', 'Date', 'Type', 'Location', 'Casualties', 'Filed by', '']} empty="No fire reports yet.">
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
                <Td className="text-xs">{r.reporting_officer_name ?? '—'}</Td>
                <Td>
                  <Link href={r.incident_id ? `/incidents/${r.incident_id}` : `/fire/reports/${r.id}`} className="text-accent hover:underline">Open</Link>
                </Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
