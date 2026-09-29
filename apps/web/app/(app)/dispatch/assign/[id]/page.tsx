import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Ambulance, ArrowUpRight, FileText, Headset, MapPin, Paperclip, Phone, User,
} from 'lucide-react';
import { getIncident, getIncidentUpdates, listIncidentAttachments } from '@criticom/api';
import { LeafletMap } from '@/components/leaflet-map';
import { AssignForm } from './assign-form';
import { getSession } from '@/lib/session';
import { formatSaTime, timeAgo } from '@/lib/utils';

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
  const { supabase, fullName } = await getSession();
  const incident = await getIncident(supabase, id).catch(() => null);
  if (!incident) notFound();

  const [{ data: vehicles = [] }, attachments, updates] = await Promise.all([
    supabase
      .from('apparatus')
      .select('id, unit_number, name, type, status, silo')
      .eq('status', 'Available')
      .order('silo'),
    listIncidentAttachments(supabase, id).catch(() => []),
    getIncidentUpdates(supabase, id).catch(() => []),
  ]);

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
          <h1 className="text-2xl font-bold">Dispatch unit</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            Incident <span className="font-mono text-fg">{incident.incident_number}</span>
            <span className="severity-pill" data-sev={incident.incident_severity}>{incident.incident_severity}</span>
            <span className="status-badge" data-status={incident.status}>{incident.status}</span>
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
                <a href={`tel:${incident.caller_number.replace(/\s+/g, '')}`} className="inline-flex items-center gap-2 text-accent hover:underline">
                  <Phone className="h-3.5 w-3.5" />{incident.caller_number}
                </a>
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
              <div className="rounded-lg border border-border bg-bg-soft px-3 py-2.5 text-sm">
                {incident.location_address}
              </div>
              {hasPoint ? (
                <div className="mt-2 overflow-hidden rounded-lg border border-border">
                  <LeafletMap
                    markers={[{
                      id: incident.id,
                      lat: incident.location_lat,
                      lng: incident.location_lng,
                      kind: pinKind,
                      popupHtml: `<strong>${incident.incident_number}</strong><br/>${incident.location_address}`,
                    }]}
                    center={[incident.location_lat, incident.location_lng]}
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
              <Field label="Owning department" value={incident.silo} />
              <Field label="Incident type (10-code)" value={incident.incident_type} span />
              <Field label="Category" value={incident.incident_category} />
              <Field label="Source" value={incident.source} />
            </div>

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
        silo={incident.silo}
        severity={incident.incident_severity}
        vehicles={vehicles ?? []}
        dispatchedBy={fullName}
      />
    </div>
  );
}
