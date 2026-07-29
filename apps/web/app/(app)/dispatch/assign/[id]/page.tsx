import { getIncident } from '@criticom/api';
import { AssignForm } from './assign-form';
import { notFound } from 'next/navigation';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dispatch · Criticom' };

export default async function AssignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, fullName } = await getSession();
  const incident = await getIncident(supabase, id).catch(() => null);
  if (!incident) notFound();

  const { data: vehicles = [] } = await supabase
    .from('apparatus')
    .select('id, unit_number, name, type, status, silo')
    .eq('status', 'Available')
    .order('silo');

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Dispatch unit</h1>
        <p className="text-muted-foreground">
          Incident <span className="font-mono">{incident.incident_number}</span> ·{' '}
          <span className="severity-pill" data-sev={incident.incident_severity}>{incident.incident_severity}</span>
        </p>
      </header>

      <div className="rounded-lg border border-border bg-bg-card p-4 text-sm">
        <p><span className="text-muted-foreground">Type:</span> {incident.incident_type}</p>
        <p><span className="text-muted-foreground">Caller:</span> {incident.caller_name} ({incident.caller_number})</p>
        <p><span className="text-muted-foreground">Location:</span> {incident.location_address}</p>
        <p className="mt-2 whitespace-pre-wrap">{incident.call_description}</p>
      </div>

      <AssignForm incidentId={incident.id} silo={incident.silo} vehicles={vehicles ?? []} dispatchedBy={fullName} />
    </div>
  );
}
