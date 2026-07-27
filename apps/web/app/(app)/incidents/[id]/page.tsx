import { notFound } from 'next/navigation';
import { getIncident, getIncidentUpdates, listIncidentAttachments } from '@criticom/api';
import { CASE_MANAGER_ROLES } from '@criticom/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { getSession } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';
import {
  addUpdateAction, closeCaseAction, requestCitizenLocationAction, setStatusAction,
} from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Incident · Criticom' };

const NEXT_STATUSES = ['Dispatched', 'En Route', 'Arrived', 'On Scene', 'Transporting', 'Resolved'] as const;

export default async function IncidentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, role } = await getSession();

  const incident = await getIncident(supabase, id).catch(() => null);
  if (!incident) notFound();
  const [updates, attachments] = await Promise.all([
    getIncidentUpdates(supabase, id),
    listIncidentAttachments(supabase, id),
  ]);

  const isClosed = incident.status === 'Closed' || incident.status === 'Resolved';
  const canClose = CASE_MANAGER_ROLES.includes(role);

  // Lifecycle milestones (ReportsController.IncidentLifecycle)
  const lifecycle = [
    { label: 'Call received', at: incident.call_timestamp },
    { label: 'Incident created', at: incident.incident_created_at },
    { label: 'Unit dispatched', at: incident.dispatch_time },
    { label: 'Arrived on scene', at: incident.arrived_timestamp },
    { label: 'Closed', at: incident.closed_at },
  ];

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="font-mono text-2xl font-bold">{incident.incident_number}</h1>
          <p className="text-muted-foreground">
            {incident.incident_type} · {incident.silo} ·{' '}
            <span className="severity-pill" data-sev={incident.incident_severity}>
              {incident.incident_severity}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/api/pdf/incident/${incident.id}`}
            className="no-print rounded-md border border-border bg-bg-soft px-3 py-1.5 text-sm hover:bg-muted"
          >
            ⬇ Case PDF
          </a>
          <span className="status-badge" data-status={incident.status}>{incident.status}</span>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <p className="text-xs uppercase text-muted-foreground">Caller</p>
              <p>{incident.caller_name} · {incident.caller_number}</p>
              {!isClosed && (
                <form action={requestCitizenLocationAction} className="mt-2">
                  <input type="hidden" name="incident_id" value={incident.id} />
                  <input type="hidden" name="silo" value={incident.silo} />
                  <input type="hidden" name="phone" value={incident.caller_number} />
                  <button
                    type="submit"
                    className="rounded-md border border-accent/50 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/20"
                  >
                    📍 Request citizen GPS via SMS
                  </button>
                </form>
              )}
            </div>
            <div><p className="text-xs uppercase text-muted-foreground">Location</p><p>{incident.location_address}{incident.suburb ? `, ${incident.suburb}` : ''}</p></div>
            <div className="sm:col-span-2"><p className="text-xs uppercase text-muted-foreground">Description</p><p>{incident.call_description}</p></div>
            {incident.notes && (
              <div className="sm:col-span-2"><p className="text-xs uppercase text-muted-foreground">Notes</p><p>{incident.notes}</p></div>
            )}
            <div><p className="text-xs uppercase text-muted-foreground">Responding officer</p><p>{incident.responding_officer ?? '—'}</p></div>
            <div><p className="text-xs uppercase text-muted-foreground">Unit type</p><p>{incident.unit_type ?? '—'}</p></div>
            {incident.number_of_victims != null && (
              <div><p className="text-xs uppercase text-muted-foreground">Victims</p><p>{incident.number_of_victims}</p></div>
            )}
            <div><p className="text-xs uppercase text-muted-foreground">Coordinates</p><p className="font-mono">{incident.location_lat.toFixed(5)}, {incident.location_lng.toFixed(5)}</p></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lifecycle</CardTitle>
            <CardDescription>Milestones from call to close.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3 text-sm">
              {lifecycle.map((m) => (
                <li key={m.label} className="flex items-center justify-between gap-3">
                  <span className={m.at ? '' : 'text-muted-foreground'}>{m.label}</span>
                  <span className="font-mono text-xs text-muted-foreground">{m.at ? formatSaTime(m.at) : 'pending'}</span>
                </li>
              ))}
            </ol>

            {!isClosed && (
              <div className="mt-5 border-t border-border pt-4">
                <p className="mb-2 text-xs uppercase text-muted-foreground">Set status</p>
                <div className="flex flex-wrap gap-2">
                  {NEXT_STATUSES.map((s) => (
                    <form key={s} action={setStatusAction}>
                      <input type="hidden" name="incident_id" value={incident.id} />
                      <input type="hidden" name="silo" value={incident.silo} />
                      <input type="hidden" name="status" value={s} />
                      <button type="submit" className="rounded-md border border-border bg-bg-soft px-2.5 py-1.5 text-xs hover:bg-muted">
                        {s}
                      </button>
                    </form>
                  ))}
                </div>
              </div>
            )}

            {!isClosed && canClose && (
              <form action={closeCaseAction} className="mt-5 border-t border-border pt-4">
                <input type="hidden" name="incident_id" value={incident.id} />
                <input type="hidden" name="silo" value={incident.silo} />
                <p className="mb-2 text-xs uppercase text-muted-foreground">Close case</p>
                <Textarea name="reason" rows={2} placeholder="Closure reason…" />
                <button type="submit" className="mt-2 w-full rounded-md bg-severity-critical/90 px-3 py-2 text-sm font-semibold hover:bg-severity-critical">
                  Close case
                </button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Updates ({updates.length})</CardTitle>
            <CardDescription>Chronological dispatcher/responder log.</CardDescription>
          </CardHeader>
          <CardContent>
            {!isClosed && (
              <form action={addUpdateAction} className="mb-4 flex gap-2">
                <input type="hidden" name="incident_id" value={incident.id} />
                <input type="hidden" name="silo" value={incident.silo} />
                <input
                  name="message" required placeholder="Add an update…"
                  className="h-10 flex-1 rounded-md border border-border bg-bg-soft px-3 text-sm"
                />
                <button type="submit" className="h-10 rounded-md bg-primary px-4 text-sm font-semibold">Post</button>
              </form>
            )}
            <ul className="space-y-3 text-sm">
              {updates.length === 0 && <li className="text-muted-foreground">No updates logged.</li>}
              {updates.map((u) => (
                <li key={u.id} className="rounded-md border border-border/60 bg-bg-soft p-3">
                  <p>{u.message}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {u.created_by_name ?? 'System'} · {formatSaTime(u.timestamp)}
                  </p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Evidence ({attachments.length})</CardTitle>
            <CardDescription>Images, audio and documents uploaded from the scene.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {attachments.length === 0 && <li className="text-muted-foreground">No attachments.</li>}
              {attachments.map((a) => (
                <li key={a.id} className="flex items-center justify-between rounded-md border border-border/60 bg-bg-soft p-3">
                  <div>
                    <p className="font-mono text-xs">{a.storage_path.split('/').pop()}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.kind} · {a.uploaded_by_name ?? 'Unknown'} · {formatSaTime(a.created_at)}
                    </p>
                  </div>
                  <span className="rounded bg-muted px-2 py-0.5 text-xs uppercase">{a.kind}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
