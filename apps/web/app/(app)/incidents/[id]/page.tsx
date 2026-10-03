import { notFound } from 'next/navigation';
import { FileText, Lock } from 'lucide-react';
import {
  getIncident, getIncidentReport, getIncidentUpdates, listAuditLogs, listIncidentAttachments, listIncidentResponders,
  signIncidentMedia,
} from '@criticom/api';
import { CASE_MANAGER_ROLES } from '@criticom/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { getSession } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';
import { PoliceReportCard } from './report-card';
import {
  addUpdateAction, closeCaseAction, requestCitizenLocationAction, setStatusAction,
} from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Incident · HikTech' };

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
  const [updates, attachments, audit, report, responders] = await Promise.all([
    getIncidentUpdates(supabase, id),
    listIncidentAttachments(supabase, id),
    // Console actions log as 'incident', server RPCs as 'incidents' — the id is enough.
    listAuditLogs(supabase, { entityId: id, limit: 200 }).catch(() => []),
    getIncidentReport(supabase, id).catch(() => null),
    listIncidentResponders(supabase, id).catch(() => []),
  ]);
  const media = await signIncidentMedia(supabase, attachments.map((a) => a.storage_path)).catch(
    () => new Map<string, string>(),
  );
  const photos = attachments.filter((a) => a.kind === 'image');
  const voiceNotes = attachments.filter((a) => a.kind === 'audio');
  const otherFiles = attachments.filter((a) => a.kind !== 'image' && a.kind !== 'audio');

  const isClosed = incident.status === 'Closed' || incident.status === 'Resolved';
  const canClose = CASE_MANAGER_ROLES.includes(role);

  // Lifecycle milestones (ReportsController.IncidentLifecycle)
  const lifecycle = [
    { label: 'Call received', at: incident.call_timestamp },
    { label: 'Incident created', at: incident.incident_created_at },
    { label: 'Unit dispatched', at: incident.dispatch_time },
    { label: 'Assigned', at: incident.assigned_at },
    { label: 'Lead responding · en route', at: incident.accepted_at },
    { label: 'Arrived on scene', at: incident.arrived_timestamp },
    { label: 'Report filed · resolved', at: incident.report_filed_at ?? incident.resolved_at },
    { label: 'Closed', at: incident.closed_at },
  ];

  // Unified chronological history — milestones + operator notes + evidence +
  // audit trail, so the whole life of the incident reads in one place.
  type Ev = { at: string; kind: string; title: string; detail?: string | null; who?: string | null };
  const events: Ev[] = [
    ...lifecycle
      .filter((m): m is { label: string; at: string } => Boolean(m.at))
      .map((m) => ({ at: m.at, kind: 'milestone', title: m.label })),
    ...updates.map((u) => ({
      at: u.timestamp, kind: 'update', title: 'Update logged', detail: u.message, who: u.created_by_name,
    })),
    ...attachments.map((a) => ({
      at: a.created_at, kind: 'evidence',
      title: `Evidence uploaded (${a.kind})`,
      detail: a.caption ?? a.storage_path.split('/').pop(), who: a.uploaded_by_name,
    })),
    ...audit.map((l) => ({
      at: l.timestamp, kind: 'audit', title: l.action_type, detail: l.details, who: l.user_name,
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const EVENT_TONE: Record<string, string> = {
    milestone: 'bg-primary', update: 'bg-accent', evidence: 'bg-severity-medium', audit: 'bg-muted-foreground',
  };

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
            <div><p className="text-xs uppercase text-muted-foreground">Dispatched by</p><p>{incident.dispatched_by ?? '—'}</p></div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Assigned to</p>
              <p>
                {incident.assigned_to_name ?? (incident.dispatch_time ? 'Sent to all on duty' : '—')}
                {incident.assigned_at ? (
                  <span className="text-muted-foreground"> · {formatSaTime(incident.assigned_at)}</span>
                ) : null}
              </p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-xs uppercase text-muted-foreground">Responding ({responders.length})</p>
              {responders.length === 0 ? (
                <p>—</p>
              ) : (
                <ul className="mt-1 flex flex-wrap gap-2">
                  {responders.map((r) => (
                    <li
                      key={r.user_id}
                      className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-sm ${
                        r.role === 'lead' ? 'border-accent/50 bg-accent/10' : 'border-border bg-bg-soft'
                      }`}
                    >
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        {r.role === 'lead' ? 'Lead' : 'Backup'}
                      </span>
                      <span className="font-semibold">{r.name ?? 'Officer'}</span>
                      <span className="status-badge" data-status={r.status}>{r.status}</span>
                      <span className="text-xs text-muted-foreground">{formatSaTime(r.joined_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div><p className="text-xs uppercase text-muted-foreground">Unit status</p><p>{incident.unit_status ?? '—'}</p></div>
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
            <ol className="relative space-y-0 text-sm">
              {lifecycle.map((m, idx) => {
                const done = Boolean(m.at);
                const last = idx === lifecycle.length - 1;
                return (
                  <li key={m.label} className="relative flex gap-3 pb-4 last:pb-0">
                    {/* connector */}
                    {!last && (
                      <span
                        aria-hidden
                        className={`absolute left-[5px] top-4 h-full w-px ${done ? 'bg-primary/50' : 'bg-border'}`}
                      />
                    )}
                    <span
                      aria-hidden
                      className={`relative z-10 mt-1 h-[11px] w-[11px] shrink-0 rounded-full border-2 ${
                        done ? 'border-primary bg-primary' : 'border-border bg-bg-card'
                      }`}
                    />
                    <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
                      <span className={done ? 'font-medium' : 'text-muted-foreground'}>{m.label}</span>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {m.at ? formatSaTime(m.at) : 'pending'}
                      </span>
                    </span>
                  </li>
                );
              })}
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
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle>Evidence ({attachments.length})</CardTitle>
                <CardDescription>Photos, voice notes and files captured at the scene.</CardDescription>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-soft px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
                <Lock className="h-3 w-3" /> Cannot be deleted
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {attachments.length === 0 && <p className="text-muted-foreground">No attachments.</p>}

            {photos.length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Photos ({photos.length}/10)
                </p>
                <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {photos.map((a) => {
                    const url = media.get(a.storage_path);
                    return (
                      <li key={a.id}>
                        <a
                          href={url ?? '#'}
                          target="_blank"
                          rel="noreferrer"
                          title={`${a.uploaded_by_name ?? 'Unknown'} · ${formatSaTime(a.created_at)}`}
                          className="block aspect-square overflow-hidden rounded-md border border-border/60 bg-bg-soft"
                        >
                          {url ? (
                            <img src={url} alt={a.caption ?? 'Scene photo'} className="h-full w-full object-cover" loading="lazy" />
                          ) : (
                            <span className="flex h-full items-center justify-center text-xs text-muted-foreground">Unavailable</span>
                          )}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {voiceNotes.length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Voice notes ({voiceNotes.length})
                </p>
                <ul className="space-y-2">
                  {voiceNotes.map((a) => {
                    const url = media.get(a.storage_path);
                    return (
                      <li key={a.id} className="rounded-md border border-border/60 bg-bg-soft p-2.5">
                        {/* biome-ignore lint/a11y/useMediaCaption: field voice notes have no transcript */}
                        {url ? <audio controls preload="none" src={url} className="h-9 w-full" /> : null}
                        <p className="mt-1 text-xs text-muted-foreground">
                          {a.uploaded_by_name ?? 'Unknown'} · {formatSaTime(a.created_at)}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {otherFiles.length > 0 && (
              <ul className="space-y-2">
                {otherFiles.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 rounded-md border border-border/60 bg-bg-soft p-3">
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <a href={media.get(a.storage_path) ?? '#'} target="_blank" rel="noreferrer" className="block truncate font-mono text-xs hover:underline">
                        {a.caption ?? a.storage_path.split('/').pop()}
                      </a>
                      <p className="text-xs text-muted-foreground">
                        {a.uploaded_by_name ?? 'Unknown'} · {formatSaTime(a.created_at)}
                      </p>
                    </div>
                    <span className="rounded bg-muted px-2 py-0.5 text-xs uppercase">{a.kind}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {report ? <PoliceReportCard report={report} /> : null}

      {/* Complete life of the incident, newest first */}
      <Card>
        <CardHeader>
          <CardTitle>Complete history ({events.length})</CardTitle>
          <CardDescription>
            Every milestone, update, evidence upload and audited action — from the first call
            {isClosed ? ' through to closure.' : ' up to now.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
          ) : (
            <ol className="relative text-sm">
              {events.map((ev, idx) => (
                <li key={`${ev.at}-${idx}`} className="relative flex gap-3 pb-4 last:pb-0">
                  {idx !== events.length - 1 && (
                    <span aria-hidden className="absolute left-[5px] top-4 h-full w-px bg-border" />
                  )}
                  <span
                    aria-hidden
                    className={`relative z-10 mt-1 h-[11px] w-[11px] shrink-0 rounded-full ${EVENT_TONE[ev.kind] ?? 'bg-muted-foreground'}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="font-medium">{ev.title}</span>
                      <span className="font-mono text-xs text-muted-foreground">{formatSaTime(ev.at)}</span>
                    </div>
                    {ev.detail && <p className="mt-0.5 break-words text-muted-foreground">{ev.detail}</p>}
                    {ev.who && <p className="mt-0.5 text-xs text-muted-foreground/80">{ev.who}</p>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
