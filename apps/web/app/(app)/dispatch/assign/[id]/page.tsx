import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Ambulance, ArrowUpRight, FileText, Headset, MapPin, Paperclip, Phone, User,
} from 'lucide-react';
import {
  deskTags, getIncident, getIncidentUpdates, getOperationalSettings, listIncidentAttachments, listOnDutyOfficers,
} from '@criticom/api';
import { DEPARTMENT_NAMES, departmentName, detailsToFollow, type Silo } from '@criticom/db';
import { DetailsToFollow } from '@/components/details-to-follow';
import { IncidentLive } from '@/components/incident-live';
import { LeafletMap } from '@/components/leaflet-map';
import { DispatchMapButton } from '@/components/dispatch-map-button';
import { AssignForm } from './assign-form';
import { SendToDesk } from './send-to-desk';
import { getSession } from '@/lib/session';
import { escapeHtml, formatSaTime, timeAgo } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dispatch · HikTech' };

/** Read-only field styled like the intake console, so the two screens rhyme. */
function Field({ label, value, mono, span }: {
  label: string; value: React.ReactNode; mono?: boolean; span?: boolean;
}) {
  return (
    <div className={span ? 'sm:col-span-2' : undefined}>
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className={`min-h-11 w-full rounded-lg border border-border bg-bg-soft px-3 py-2.5 text-sm ${mono ? 'font-mono text-xs' : ''}`}>
        {value ?? '—'}
      </div>
    </div>
  );
}

export default async function AssignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, role, silo: mySilo } = await getSession();
  // A call not sent to this desk is not found here: the database does not
  // return it to a department's dispatch desk (0068).
  const incident = await getIncident(supabase, id).catch(() => null);
  if (!incident) notFound();
  const deskOf = ['Dispatcher', 'ControlRoom', 'IncidentLogger'].includes(role) && mySilo !== 'Ethekwini'
    ? (mySilo as Exclude<Silo, 'Ethekwini'>) : null;
  const sentTo = deskTags(incident);

  // Who is on duty: a department's desk sees its own crews only, the control
  // room every department's. The form narrows them to the departments the
  // dispatcher routes the call to and keeps the list live.
  const fieldSilos: Silo[] = deskOf ? [deskOf] : ['MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster'];
  const [officers, settings, attachments, updates] = await Promise.all([
    listOnDutyOfficers(supabase, fieldSilos).catch(() => []),
    getOperationalSettings(supabase),
    listIncidentAttachments(supabase, id).catch(() => []),
    getIncidentUpdates(supabase, id).catch(() => []),
  ]);

  // Each department dispatches its own part (0073): one department leading
  // the call never stops another from sending its crews.
  const parts = incident.departments ?? [];
  const locked =
    incident.status === 'Resolved' || incident.status === 'Closed'
      ? `${incident.incident_number} is ${incident.status.toLowerCase()} — it can no longer be dispatched.`
      : !incident.departments && incident.accepted_by
        ? `${incident.responding_officer ?? 'An officer'} is leading this incident${incident.accepted_at ? ` (responded ${timeAgo(incident.accepted_at)})` : ''}. Other officers can still join it as backup from the app.`
        : null;

  // On-duty officers' last GPS fixes, beside the scene.
  const unitMarkers = officers.flatMap((o) =>
    o.lat !== null && o.lng !== null
      ? [{
          id: o.userId,
          lat: o.lat,
          lng: o.lng,
          kind: 'unit',
          popupHtml: `<strong>${escapeHtml(o.name)}</strong>${o.unitNumber ? ` · ${escapeHtml(o.unitNumber)}` : ''}<br/>${o.activeCalls ? `On ${o.activeCalls} incident${o.activeCalls === 1 ? '' : 's'}` : 'Available'}`,
        }]
      : []);

  const hasPoint = Boolean(incident.location_lat && incident.location_lng);
  const pinKind =
    incident.incident_severity === 'Critical' || incident.incident_severity === 'High'
      ? 'critical'
      : incident.incident_severity === 'Medium' ? 'medium' : 'low';

  return (
    <div className="w-full space-y-5 pb-10">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Dispatch call</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            Incident <span className="font-mono text-fg">{incident.incident_number}</span>
            <span className="severity-pill" data-sev={incident.incident_severity}>{incident.incident_severity}</span>
            <span className="status-badge" data-status={incident.status}>{incident.status}</span>
            <DetailsToFollow incident={incident} />
            <span>· logged {timeAgo(incident.incident_created_at)}</span>
          </p>
        </div>
        <Link
          href={`/incidents/${incident.id}`}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-bg-soft px-4 py-2 text-sm font-semibold hover:bg-muted"
        >
          Full lifecycle <ArrowUpRight className="h-4 w-4" />
        </Link>
      </header>

      <div className="grid gap-5 xl:grid-cols-2">
        {/* ══ CALLER & LOCATION — everything intake captured ══ */}
        <section className="overflow-hidden rounded-2xl border border-border bg-bg-card">
          <h2 className="border-b border-border bg-bg-soft px-5 py-3 text-center text-xs font-bold uppercase tracking-[0.18em]">
            Caller &amp; location info
          </h2>
          <div className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Caller name" value={
                <span className="inline-flex items-center gap-2"><User className="h-3.5 w-3.5 text-muted-foreground" />{incident.caller_name}</span>
              } />
              <Field label="Contact number" value={
                // A call sent early may not have the number yet (0076).
                incident.caller_number ? (
                  <a href={`tel:${incident.caller_number.replace(/\s+/g, '')}`} className="inline-flex items-center gap-2 text-accent hover:underline">
                    <Phone className="h-3.5 w-3.5" />{incident.caller_number}
                  </a>
                ) : <span className="text-muted-foreground">Not given yet</span>
              } />
              <Field label="Caller is the patient" value={
                incident.is_caller_patient === null ? 'Not recorded' : incident.is_caller_patient ? 'Yes' : 'No'
              } />
              <Field label="Patient name" value={incident.patient_name} />
              <Field label="Call timestamp" value={formatSaTime(incident.call_timestamp)} mono />
              <Field label="Call taken by" value={
                incident.call_taken_by
                  ? <span className="inline-flex items-center gap-2"><Headset className="h-3.5 w-3.5 text-muted-foreground" />{incident.call_taken_by}</span>
                  : '—'
              } />
            </div>

            {/* Scene */}
            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                <MapPin className="h-3 w-3" /> Incident location
              </p>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-soft px-3 py-2.5 text-sm">
                <span>{incident.location_address}</span>
                {hasPoint ? (
                  <DispatchMapButton
                    incident={{
                      id: incident.id, number: incident.incident_number, type: incident.incident_type,
                      severity: incident.incident_severity, address: incident.location_address,
                      lat: incident.location_lat, lng: incident.location_lng,
                    }}
                    officers={officers}
                    canAssign={!locked}
                    className="shrink-0 rounded-md border border-accent/40 px-2.5 py-1 text-xs font-semibold text-accent"
                  >
                    <MapPin className="h-3.5 w-3.5" aria-hidden /> Live map &amp; routes
                  </DispatchMapButton>
                ) : null}
              </div>
              {hasPoint ? (
                <div className="mt-2 overflow-hidden rounded-lg border border-border">
                  <LeafletMap
                    markers={[{
                      id: incident.id,
                      lat: incident.location_lat,
                      lng: incident.location_lng,
                      kind: pinKind,
                      popupHtml: `<strong>${escapeHtml(incident.incident_number)}</strong><br/>${escapeHtml(incident.location_address)}`,
                    }, ...unitMarkers]}
                    // With crews on the map, frame them all; otherwise zoom on the scene.
                    center={unitMarkers.length ? undefined : [incident.location_lat, incident.location_lng]}
                    zoom={15}
                    height={280}
                    satellite
                    pin
                  />
                </div>
              ) : (
                <p className="mt-2 rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                  No coordinates captured for this call.
                </p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Suburb" value={incident.suburb} />
              <Field label="Region" value={incident.region} />
              <Field label="City" value={incident.city} />
              <Field label="Postal code" value={incident.postal_code} />
              <Field label="Latitude" value={incident.location_lat || '—'} mono />
              <Field label="Longitude" value={incident.location_lng || '—'} mono />
            </div>
          </div>
        </section>

        {/* ══ INCIDENT DETAILS — the full capture, read-only ══ */}
        <section className="overflow-hidden rounded-2xl border border-border bg-bg-card">
          <h2 className="border-b border-border bg-bg-soft px-5 py-3 text-center text-xs font-bold uppercase tracking-[0.18em]">
            Incident details
          </h2>
          <div className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Incident ID" value={incident.incident_number} mono />
              <Field label="Owning department" value={departmentName(incident.silo)} />
              <Field label="Sent to dispatch" value={sentTo.length ? sentTo.map((d) => DEPARTMENT_NAMES[d]).join(', ') : 'Control room only'} span />
              <Field label="Incident type (10-code)" value={incident.incident_type} span />
              <Field label="Category" value={incident.incident_category} />
              <Field label="Source" value={incident.source} />
            </div>

            {incident.status !== 'Resolved' && incident.status !== 'Closed' ? (
              <SendToDesk incidentId={incident.id} sentTo={sentTo} />
            ) : null}

            <div>
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Call description / narrative
              </p>
              <div className="whitespace-pre-wrap rounded-lg border border-border bg-bg-soft px-3 py-2.5 text-sm leading-relaxed">
                {incident.call_description}
              </div>
            </div>

            {/* EMS triage as captured at intake */}
            <div className="rounded-xl border border-border bg-bg-soft/60 p-4">
              <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Ambulance className="h-4 w-4 text-severity-critical-ink" /> EMS / medical triage
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Number of victims" value={incident.number_of_victims ?? '—'} />
                <Field label="Medical severity" value={incident.medical_type} />
              </div>
            </div>

            {incident.notes ? (
              <div>
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Internal dispatch notes
                </p>
                <div className="whitespace-pre-wrap rounded-lg border border-severity-medium/40 bg-severity-medium/10 px-3 py-2.5 text-sm leading-relaxed">
                  {incident.notes}
                </div>
              </div>
            ) : null}

            {/* Evidence attached at intake or from the field */}
            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                <Paperclip className="h-3 w-3" /> Attachments ({attachments.length})
              </p>
              {attachments.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground">
                  Nothing attached to this call.
                </p>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {attachments.slice(0, 6).map((a) => (
                    <li key={a.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">
                        {a.caption ?? a.storage_path.split('/').pop()}
                      </span>
                      <span className="shrink-0 uppercase text-muted-foreground">{a.kind}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Latest movement on the call, so the dispatcher has context */}
            {updates.length > 0 ? (
              <div>
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Recent updates
                </p>
                <ul className="space-y-1.5">
                  {updates.slice(0, 3).map((u) => (
                    <li key={u.id} className="rounded-lg border border-border bg-bg-soft px-3 py-2 text-xs">
                      <p className="break-words">{u.message}</p>
                      <p className="mt-0.5 text-muted-foreground">
                        {u.created_by_name ?? 'System'} · {timeAgo(u.timestamp)}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      {/* ══ ROUTING & UNIT ══ */}
      <AssignForm
        incidentId={incident.id}
        incidentNumber={incident.incident_number}
        silo={incident.silo}
        dispatchedSilos={incident.dispatched_silos ?? []}
        severity={incident.incident_severity}
        scene={hasPoint ? [incident.location_lat, incident.location_lng] : null}
        officers={officers}
        eta={{
          speedKmh: settings['dispatch.eta_speed_kmh'],
          roadFactor: settings['dispatch.eta_road_factor'],
        }}
        locked={locked}
        parts={parts}
        awaiting={!incident.departments && incident.status === 'Dispatched' && !incident.accepted_by}
        sosRaiser={incident.source === 'Responder-Panic' ? incident.created_by : null}
        allowedSilos={deskOf ? [deskOf] : undefined}
        assignedTo={!incident.departments && incident.assigned_to && !incident.accepted_by
          ? { userId: incident.assigned_to, name: incident.assigned_to_name ?? 'an officer', at: incident.assigned_at }
          : null}
      />

      {/* Sent early: the details arrive here as the call taker adds them. */}
      {detailsToFollow(incident) ? <IncidentLive incidentId={incident.id} /> : null}
    </div>
  );
}
