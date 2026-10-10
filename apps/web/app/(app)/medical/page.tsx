import Link from 'next/link';
import { listActiveIncidents, listPcrs } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { IncidentLive } from '@/components/incident-live';
import { getSession } from '@/lib/session';
import { formatSaTime, timeAgo } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'EMS · HikTech' };

const STATUS_LABEL: Record<string, string> = {
  Dispatched: 'Waiting for a crew', 'En Route': 'Crew en route', Arrived: 'Crew on scene', 'On Scene': 'Crew on scene',
  Transporting: 'Transporting', Active: 'Active',
};

/** EMS: the calls crews are working now, ambulances off road, and the clinical archive. */
export default async function MedicalPage() {
  const { supabase } = await getSession();
  const [active, pcrs, offRoad] = await Promise.all([
    listActiveIncidents(supabase, 'Medical').catch(() => []),
    listPcrs(supabase).catch(() => []),
    supabase.from('apparatus').select('id, unit_number, status_note').eq('silo', 'Medical').eq('status', 'Out of Service'),
  ]);
  const live = active.filter((i) => !['New', 'Pending', 'Pending Dispatch', 'Pending Analysis'].includes(i.status));
  const count = (s: string[]) => live.filter((i) => s.includes(i.status)).length;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(new Date());
  const day = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(new Date(iso));
  const filedToday = pcrs.filter((p) => day(p.filed_at ?? p.created_at) === today).length;
  const cleaning = (offRoad.data ?? []).filter((a) => /cleaning/i.test(a.status_note ?? ''));

  return (
    <div className="space-y-6">
      <IncidentLive />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Emergency Medical Services</h1>
          <p className="text-muted-foreground">Live calls, ambulances and patient care reports.</p>
        </div>
        <Link href="/medical/pcr/new" className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-semibold hover:bg-muted">
          + New Manual Entry
        </Link>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          { label: 'Waiting for a crew', value: count(['Dispatched']), tone: 'text-severity-medium-ink' },
          { label: 'En route', value: count(['En Route']), tone: 'text-accent' },
          { label: 'On scene', value: count(['Arrived', 'On Scene']), tone: 'text-severity-low-ink' },
          { label: 'Transporting', value: count(['Transporting']), tone: 'text-severity-high-ink' },
          { label: 'Patient reports today', value: filedToday, tone: '' },
        ].map((t) => (
          <Card key={t.label}><CardContent className="p-4">
            <p className="text-xs uppercase text-muted-foreground">{t.label}</p>
            <p className={`mt-2 text-3xl font-bold ${t.tone}`}>{t.value}</p>
          </CardContent></Card>
        ))}
      </section>

      <Card>
        <CardHeader><CardTitle>Live EMS calls ({live.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['Incident', 'Type', 'Priority', 'Severity', 'Crew', 'Lead', 'Location', 'Dispatched', '']} empty="No live EMS calls.">
            {live.map((i) => (
              <Tr key={i.id}>
                <Td className="font-mono">{i.incident_number}</Td>
                <Td>{i.incident_type}</Td>
                <Td className="text-xs">{i.medical_type ?? '—'}</Td>
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
          <p className="text-xs uppercase text-muted-foreground">Clinical archive</p>
          <p className="mt-2 text-3xl font-bold">{pcrs.length}</p>
          <Link href="/medical/pcr" className="text-sm text-accent hover:underline">View all →</Link>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Ambulances off road for cleaning</p>
          <p className="mt-2 text-3xl font-bold text-severity-high-ink">{cleaning.length}</p>
          {cleaning.length ? <p className="mt-1 text-xs text-muted-foreground">{cleaning.map((a) => a.unit_number).join(', ')}</p> : null}
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Ambulance restock</p>
          <Link href="/medical/restock" className="mt-2 block text-sm text-accent hover:underline">Inventory →</Link>
        </CardContent></Card>
      </section>

      <Card>
        <CardHeader><CardTitle>Recent patient care reports</CardTitle></CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['Incident Ref', 'Patient Name', 'Arrival Time', 'Destination', 'Care Level', 'Paramedic(s)', '']} empty="No clinical records found in the archive.">
            {pcrs.slice(0, 10).map((p) => (
              <Tr key={p.id}>
                <Td className="font-mono text-xs">{p.report_number ?? 'Manual entry'}</Td>
                <Td>{p.patient_name || 'Unknown Patient'}</Td>
                <Td className="text-xs">{p.time_of_arrival ? formatSaTime(p.time_of_arrival) : 'Time Not Logged'}</Td>
                <Td>{p.destination_hospital ?? <span className="text-muted-foreground">Not Transported</span>}</Td>
                <Td>{p.level_of_care ?? '—'}</Td>
                <Td className="text-xs">{p.paramedic_names ?? '—'}</Td>
                <Td><Link href={`/medical/pcr/${p.id}`} className="text-accent hover:underline">Open</Link></Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
