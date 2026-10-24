import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FileText, Lock } from 'lucide-react';
import {
  deskTags, featureEnabled, listDisasterAssessments, getFireReportForIncident, getPcrForIncident, getPostMortemForIncident, getIncident, getIncidentReport, getIncidentUpdates, listAuditLogs, listIncidentEdits, listBookedOutBodycams,
  listIncidentAttachments, listIncidentMapZones, listIncidentResponders, partFor, partWords, searchBodycamBookings, signIncidentMedia,
  statusForPart, getOperationalSettings, listOnDutyOfficers, sortParts, type IncidentResponder,
} from '@criticom/api';
import { ResponseTracker, type TrackPart } from '@/components/response-tracker';
import { AssessmentFigures, AssessmentList } from '@/components/disaster-assessments';
import {
  DEPARTMENT_NAMES, DISPATCH_DESK_ROLES, STATUS_OVERRIDE_ROLES, departmentName, STATUS_OVERRIDE_STEPS, canAccess, canDismissSos, canWatchBodycam, caseStage, mayFinishCall,
  type Database, type Silo, type UserRole,
} from '@criticom/db';
import { windowFor } from '@criticom/db/bodycams';
import { getFeatures } from '@/lib/features';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { getSession } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';
import { DismissSos } from '@/components/sos-dismiss';
import { PoliceReportCard } from './report-card';
import { FireReportCard } from './fire-report-card';
import { PcrCard } from '@/components/pcr-card';
import { PostMortemCard } from '@/components/post-mortem-card';
import { IncidentLive } from '@/components/incident-live';
import { DetailsToFollow } from '@/components/details-to-follow';
import { CallDetails } from '@/components/call-details';
import { CallEdits } from '@/components/call-edits';
import { PatientList } from '@/components/department-pills';
import { callChannelText, readPatients } from '@criticom/db/call-facts';
import { getT } from '@/lib/i18n';
import { VoiceNote } from '@/components/voice-note';
import { IncidentZonesCard } from './zones-card';
import { IncidentBodycamsCard, type IncidentBodycamPerson } from './bodycams-card';
import { addUpdateAction, requestCitizenLocationAction } from './actions';
import { CaseReviewCard } from './case-review-card';
import { StatusOverride } from './case-forms';
import { DepartmentsCard } from './departments-card';
import { TalkPanel } from '@/components/talk/talk-panel';
import { talkChannelsFor } from '@/lib/talk';

/** A step of the crew's progress in its own colour: sent blue, on the way amber, there orange, moving purple, filed teal, done green. */
function stepTone(label: string): string {
  const l = label.toLowerCase();
  if (l.includes('en route')) return '#f59e0b';
  if (l.includes('scene') && !l.includes('closed')) return '#f97316';
  if (l.includes('arrived')) return '#f97316';
  if (l.includes('transporting')) return '#a855f7';
  if (l.includes('report')) return '#14b8a6';
  if (l.includes('closed') || l.includes('resolved')) return '#22c55e';
  return '#3b82f6';
}

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Incident · HikTech' };

export default async function IncidentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, role, silo, userId } = await getSession();
  const { t } = await getT(supabase, userId);

  const incident = await getIncident(supabase, id).catch(() => null);
  if (!incident) notFound();
  const [updates, attachments, audit, report, responders, zones, fireReport, pcr, postMortem, edits, assessments] = await Promise.all([
    getIncidentUpdates(supabase, id),
    listIncidentAttachments(supabase, id),
    // Console actions log as 'incident', server RPCs as 'incidents' — the id is enough.
    listAuditLogs(supabase, { entityId: id, limit: 200 }).catch(() => []),
    getIncidentReport(supabase, id).catch(() => null),
    listIncidentResponders(supabase, id).catch(() => []),
    // Empty until migration 0053 is run; the card then simply does not show.
    listIncidentMapZones(supabase, id).catch(() => null),
    // The firefighter's report (0059); none for other departments.
    getFireReportForIncident(supabase, id).catch(() => null),
    // The paramedic's patient care report (0063).
    getPcrForIncident(supabase, id).catch(() => null),
    // The Disaster officer's post-mortem (0065).
    getPostMortemForIncident(supabase, id).catch(() => null),
    // What the call taker and dispatchers changed, before and after (0079).
    listIncidentEdits(supabase, id),
    // Disaster Management's assessment of each place (0107); empty until it is run.
    listDisasterAssessments(supabase, id).catch(() => []),
  ]);
  const media = await signIncidentMedia(supabase, attachments.map((a) => a.storage_path)).catch(
    () => new Map<string, string>(),
  );
  const photos = attachments.filter((a) => a.kind === 'image');
  const voiceNotes = attachments.filter((a) => a.kind === 'audio');
  const otherFiles = attachments.filter((a) => a.kind !== 'image' && a.kind !== 'audio');

  // Live, awaiting review (Resolved: the report is in) or closed (0061).
  const stage = caseStage(incident.status);
  // The operational screens (GPS request, zones, bodycams) stop at Resolved;
  // the case itself stays open to notes until it is closed.
  const isClosed = stage !== 'live';
  const isCaseClosed = stage === 'closed';
  // A call shared by departments is dispatched and marked per department, on
  // the departments card (0073); a call from before 0073 as a whole.
  const parts = incident.departments ?? [];
  const canOverride = parts.length === 0 && STATUS_OVERRIDE_ROLES.includes(role) && stage === 'live' && Boolean(incident.dispatch_time);
  const canDispatch = parts.length === 0 && DISPATCH_DESK_ROLES.includes(role) && stage === 'live' && !incident.accepted_by;
  // The call logger watches every call; they add only to the calls they logged (0081).
  const canNote = !isCaseClosed && role !== 'Viewer' && (role !== 'IncidentLogger' || incident.created_by === userId);
  const [bodycams, talk] = await Promise.all([
    incidentBodycams(supabase, incident, responders, role, silo),
    // The call's own talk group (0083): whoever works the call talks on it.
    talkChannelsFor(supabase, { role, silo }, { incidentId: incident.id }).catch(() => ({ channels: [], setUp: false, installed: false })),
  ]);

  // A department's desk, command and crews follow their own department's
  // part at the top (0073); the other departments are on the departments
  // card. The control room and the organisation follow the whole call.
  const myPart = silo !== 'Ethekwini' ? partFor(parts, silo) : null;

  // Following the crews to the scene (0099): their live positions and the ETA settings.
  const crewIds = new Set(responders.map((r) => r.user_id));
  const [opsSettings, crewPositions] = await Promise.all([
    getOperationalSettings(supabase).catch(() => null),
    parts.length && crewIds.size && stage === 'live'
      ? listOnDutyOfficers(supabase).then((all) => all.filter((o) => crewIds.has(o.userId))).catch(() => [])
      : Promise.resolve([]),
  ]);
  // My own department first; the others in their usual order.
  const trackParts = sortParts(parts).sort((a, b) => Number(b.silo === myPart?.silo) - Number(a.silo === myPart?.silo)) as unknown as TrackPart[];
  const scene = incident.location_lat && incident.location_lng ? { lat: incident.location_lat, lng: incident.location_lng } : null;
  const myLabel = myPart ? DEPARTMENT_NAMES[myPart.silo] : null;

  // Transporting has no column of its own: the crew's status note records it.
  const transportingAt = updates
    .filter((u) => /^\[STATUS\] Transporting/.test(u.message ?? '') && (!myLabel || (u.message ?? '').includes(`· ${myLabel}`)))
    .map((u) => u.timestamp)
    .sort()[0] ?? null;
  const resolvedAt = incident.report_filed_at ?? incident.resolved_at;
  const ladderDone = myPart ? myPart.finished_at : resolvedAt;

  // Where the crew is, as the desk follows it live.
  const ladder = myPart ? [
    { label: 'Dispatched', at: myPart.dispatched_at },
    { label: 'En Route', at: myPart.accepted_at },
    { label: 'On Scene', at: myPart.arrived_at },
    { label: 'Transporting', at: transportingAt, optional: true },
    ...(myPart.status === 'Not needed' || myPart.status === 'Cancelled'
      ? [{ label: myPart.status, at: myPart.finished_at }]
      // The lead closes the part on scene after the report (0074).
      : [{ label: 'Report filed', at: myPart.report_filed_at }, { label: 'Closed on scene', at: myPart.closed_at }]),
  ] : [
    { label: 'Dispatched', at: incident.dispatch_time },
    { label: 'En Route', at: incident.accepted_at },
    { label: 'On Scene', at: incident.arrived_timestamp },
    { label: 'Transporting', at: transportingAt, optional: true },
    incident.report_filed_at || resolvedAt || !isCaseClosed
      ? { label: incident.report_filed_at ? 'Report filed · Resolved' : 'Resolved', at: resolvedAt }
      : { label: 'Closed without a report', at: incident.closed_at },
  ];
  const reached = ladder.filter((step) => step.at).length;

  // Lifecycle milestones (ReportsController.IncidentLifecycle)
  const lifecycle = [
    { label: 'Call logged', at: incident.incident_created_at ?? incident.call_timestamp },
    { label: 'Unit dispatched', at: incident.dispatch_time },
    { label: 'Assigned', at: incident.assigned_at },
    { label: 'Lead responding · en route', at: incident.accepted_at },
    { label: 'Arrived on scene', at: incident.arrived_timestamp },
    { label: 'Transporting', at: transportingAt },
    { label: 'Report filed · resolved', at: incident.report_filed_at ?? incident.resolved_at },
    {
      label: incident.close_kind === 'Cancelled' ? 'Closed without a report'
        : incident.close_kind === 'Reviewed' ? 'Reviewed · case closed' : 'Closed',
      at: incident.closed_at,
    },
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
            {incident.incident_type} · {departmentName(incident.silo)} ·{' '}
            <span className="severity-pill" data-sev={incident.incident_severity}>
              {incident.incident_severity}
            </span>
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {t('Sent to dispatch: {value}', { value: deskTags(incident).map((d) => DEPARTMENT_NAMES[d]).join(', ') || 'Control room only' })}
            <DetailsToFollow incident={incident} />
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {/* An SOS pressed by mistake (0093): the control room, dispatch and the system administrators. */}
          {incident.source === 'Responder-Panic' && !incident.sos_dismissed_at && incident.status !== 'Resolved' && incident.status !== 'Closed' && canDismissSos(role) ? (
            <DismissSos incidentId={incident.id} className="no-print h-9 px-3"
              label={t("{value}'s SOS", { value: incident.caller_name ?? 'the officer' })} />
          ) : null}
          {/* Sent early and not finished: the person who logged it (or the control room) carries on (0076). */}
          {mayFinishCall({ userId, role, silo }, incident) ? (
            <Link
              href={`/dispatch/log-call?resume=${incident.id}`}
              className="no-print rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent/90"
            >
              {t('Finish this call')}
            </Link>
          ) : null}
          <a
            href={`/api/pdf/incident/${incident.id}`}
            className="no-print rounded-md border border-border bg-bg-soft px-3 py-1.5 text-sm hover:bg-muted"
          >
            {t('⬇ Case PDF')}</a>
          {myPart ? (
            <span className="status-badge" data-status={statusForPart(myPart, incident.status)}>{myLabel} · {partWords(myPart)}</span>
          ) : (
            <span className="status-badge" data-status={incident.status}>{incident.status}</span>
          )}
          <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
            stage === 'review' ? 'border-accent/50 bg-accent/10 text-accent'
              : stage === 'closed' ? 'border-border bg-bg-soft text-muted-foreground'
              : 'border-severity-medium/40 bg-severity-medium/10 text-severity-medium-ink'
          }`}>
            {stage === 'review' ? 'Awaiting review' : stage === 'closed' ? 'Case closed' : 'Live call'}
          </span>
        </div>
      </header>

      {/* An SOS dismissed as a mistake (0093): said plainly, at the top. */}
      {incident.sos_dismissed_at ? (
        <p className="rounded-lg border border-border bg-bg-soft px-4 py-3 text-sm">
          <span className="font-bold">{t('SOS dismissed')}</span>
          {' · '}{incident.sos_dismissed_by_name ?? t('the control room')}{' · '}{formatSaTime(incident.sos_dismissed_at)}
          {incident.sos_dismiss_reason ? <>{' · '}{incident.sos_dismiss_reason}</> : null}
        </p>
      ) : null}

      {/* Live: a crew's En Route, On Scene, Transporting and report re-render this page. */}
      <IncidentLive incidentId={incident.id} />
      {parts.length > 0 ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('Where the crews are')}</p>
              <p className="text-xs text-muted-foreground">{t('On scene is set by the crew’s own phone reaching the scene. Click a strip to see the crew.')}</p>
            </div>
            <ResponseTracker
              scene={scene}
              parts={trackParts}
              responders={responders}
              officers={crewPositions}
              eta={{ speedKmh: opsSettings?.['dispatch.eta_speed_kmh'] ?? 42, roadFactor: opsSettings?.['dispatch.eta_road_factor'] ?? 1.35 }}
              live={stage === 'live'}
            />
          </CardContent>
        </Card>
      ) : (
      <Card>
        <CardContent className="p-4">
          {myPart ? (
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">{myLabel}</p>
          ) : null}
          <ol className={`grid grid-cols-2 gap-2 ${ladder.length > 5 ? 'sm:grid-cols-3 lg:grid-cols-6' : 'sm:grid-cols-5'}`} aria-label={t('Where the crew is')}>
            {ladder.map((step, i) => {
              const done = Boolean(step.at);
              const skipped = !done && step.optional && Boolean(ladderDone);
              const current = done && ladder.slice(i + 1).every((later) => !later.at);
              return (
                <li
                  key={step.label}
                  className="rounded-lg border p-3 transition-colors"
                  // Each step in its own colour: done steps tinted, the current one bright, the rest quiet.
                  style={current
                    ? { borderColor: stepTone(step.label), background: `${stepTone(step.label)}2e`, boxShadow: `0 0 0 1px ${stepTone(step.label)}66` }
                    : done
                      ? { borderColor: `${stepTone(step.label)}80`, background: `${stepTone(step.label)}14` }
                      : { borderColor: 'rgb(var(--c-border))', background: 'rgb(var(--c-bg-soft))' }}
                >
                  <p className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider ${done ? 'text-fg' : 'text-muted-foreground'}`}>
                    <span
                      aria-hidden
                      className={`h-2 w-2 shrink-0 rounded-full ${current ? 'animate-pulse' : ''}`}
                      style={{ background: stepTone(step.label), opacity: done ? 1 : 0.45 }}
                    />
                    {done ? '✓ ' : ''}{step.label}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {done ? formatSaTime(step.at as string) : skipped ? 'Not needed' : current ? '' : step.optional ? 'If needed' : 'Waiting'}
                  </p>
                </li>
              );
            })}
          </ol>
          <p className="mt-2 text-xs text-muted-foreground">
            {reached === 0
              ? myPart ? `${myLabel} has not been dispatched yet.` : 'Not dispatched yet.'
              : 'Updates by itself as the crew moves — no need to reload.'}
            {canDispatch && !incident.dispatch_time ? (
              <>
                {' '}
                <Link href={`/dispatch/assign/${incident.id}`} className="font-semibold text-accent hover:underline">{t('Dispatch this call →')}</Link>
              </>
            ) : null}
          </p>
        </CardContent>
      </Card>
      )}

      {parts.length > 0 ? (
        <DepartmentsCard
          incidentId={incident.id}
          incidentSilo={incident.silo}
          parts={parts}
          role={role}
          silo={silo}
          live={stage === 'live'}
          caseClosed={isCaseClosed}
        />
      ) : null}

      {talk.channels.length ? (
        <div id="talk" className="scroll-mt-20"><TalkPanel channels={talk.channels} compact title={`Talk on ${incident.incident_number}`} /></div>
      ) : null}

      <CaseReviewCard
        incident={incident}
        role={role}
        report={report}
        fireReport={fireReport}
        pcr={pcr}
        postMortem={postMortem}
        responding={responders.length}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('Details')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <p className="text-xs uppercase text-muted-foreground">{t('Caller')}</p>
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
                    {t('📍 Request citizen GPS via SMS')}</button>
                </form>
              )}
            </div>
            <div><p className="text-xs uppercase text-muted-foreground">{t('Location')}</p><p>{incident.location_address}{incident.suburb ? `, ${incident.suburb}` : ''}</p></div>
            <div className="sm:col-span-2"><p className="text-xs uppercase text-muted-foreground">{t('Description')}</p><p>{incident.call_description}</p></div>
            <div><p className="text-xs uppercase text-muted-foreground">{t('How the call came in')}</p><p>{callChannelText(incident.call_channel, incident.call_channel_other) ?? '—'}</p></div>
            {readPatients(incident.patients).length ? (
              <div><p className="text-xs uppercase text-muted-foreground">{t('Patients')}</p><PatientList patients={incident.patients} /></div>
            ) : null}
            {/* The details filled in for the type (0077). */}
            <div className="sm:col-span-2"><CallDetails incident={incident} t={t} /></div>
            {incident.notes && (
              <div className="sm:col-span-2"><p className="text-xs uppercase text-muted-foreground">{t('Notes')}</p><p>{incident.notes}</p></div>
            )}
            <div><p className="text-xs uppercase text-muted-foreground">{t('Dispatched by')}</p><p>{incident.dispatched_by ?? '—'}</p></div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">{t('Assigned to')}</p>
              <p>
                {incident.assigned_to_name ?? (incident.dispatch_time ? 'Sent to all on duty' : '—')}
                {incident.assigned_at ? (
                  <span className="text-muted-foreground"> · {formatSaTime(incident.assigned_at)}</span>
                ) : null}
              </p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-xs uppercase text-muted-foreground">{t('Responding ({length})', { length: responders.length })}</p>
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
                        {parts.length > 1 ? ` · ${DEPARTMENT_NAMES[r.silo]}` : ''}
                      </span>
                      <span className="font-semibold">{r.name ?? 'Officer'}</span>
                      <span className="status-badge" data-status={r.status}>{r.status}</span>
                      <span className="text-xs text-muted-foreground">{formatSaTime(r.joined_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div><p className="text-xs uppercase text-muted-foreground">{t('Unit status')}</p><p>{incident.unit_status ?? '—'}</p></div>
            <div><p className="text-xs uppercase text-muted-foreground">{t('Unit type')}</p><p>{incident.unit_type ?? '—'}</p></div>
            {incident.number_of_victims != null && (
              <div><p className="text-xs uppercase text-muted-foreground">{t('Victims')}</p><p>{incident.number_of_victims}</p></div>
            )}
            <div>
              <p className="text-xs uppercase text-muted-foreground">{t('Coordinates')}</p>
              <p className="font-mono">{incident.location_lat.toFixed(5)}, {incident.location_lng.toFixed(5)}</p>
              {canAccess('/sanral', role, silo) && (
                <Link
                  href={`/sanral?lat=${incident.location_lat}&lng=${incident.location_lng}`}
                  className="text-xs text-accent hover:underline"
                >
                  {t('SANRAL freeway cameras nearby')}</Link>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('Lifecycle')}</CardTitle>
            <CardDescription>{t('Milestones from call to close.')}</CardDescription>
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

            {canOverride && (
              <div className="mt-5 border-t border-border pt-4">
                <p className="mb-1 text-xs uppercase text-muted-foreground">{t('Mark for the crew')}</p>
                <p className="mb-2 text-xs text-muted-foreground">{t('When the officer radios a step in instead of pressing it in the app.')}</p>
                <StatusOverride incidentId={incident.id} silo={incident.silo} steps={STATUS_OVERRIDE_STEPS} current={incident.status} />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {zones && (
        <IncidentZonesCard
          zones={zones}
          incidentId={incident.id}
          incidentNumber={incident.incident_number}
          role={role}
          isClosed={isClosed}
        />
      )}

      {bodycams && (
        <IncidentBodycamsCard
          incident={{ id: incident.id, number: incident.incident_number }}
          isClosed={isClosed}
          {...bodycams}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('Updates ({length})', { length: updates.length })}</CardTitle>
            <CardDescription>{t('Chronological dispatcher/responder log.')}</CardDescription>
          </CardHeader>
          <CardContent>
            {canNote && (
              <form action={addUpdateAction} className="mb-4 flex gap-2">
                <input type="hidden" name="incident_id" value={incident.id} />
                <input type="hidden" name="silo" value={incident.silo} />
                <input
                  name="message" required placeholder={stage === 'review' ? 'Add a case note…' : 'Add an update…'}
                  className="h-10 flex-1 rounded-md border border-border bg-bg-soft px-3 text-sm"
                />
                <button type="submit" className="h-10 rounded-md bg-primary px-4 text-sm font-semibold">{t('Post')}</button>
              </form>
            )}
            <ul className="space-y-3 text-sm">
              {updates.length === 0 && <li className="text-muted-foreground">{t('No updates logged.')}</li>}
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

        <Card id="case-evidence">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle>{t('Evidence ({length})', { length: attachments.length })}</CardTitle>
                <CardDescription>{t('Photos, voice notes and files captured at the scene.')}</CardDescription>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-soft px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
                <Lock className="h-3 w-3" /> {' '}{t('Cannot be deleted')}</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {attachments.length === 0 && <p className="text-muted-foreground">{t('No attachments.')}</p>}

            {photos.length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  {t('Photos ({length}/10)', { length: photos.length })}</p>
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
                            <span className="flex h-full items-center justify-center text-xs text-muted-foreground">{t('Unavailable')}</span>
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
                  {t('Voice notes ({length})', { length: voiceNotes.length })}</p>
                <ul className="space-y-2">
                  {voiceNotes.map((a) => {
                    const url = media.get(a.storage_path);
                    return (
                      <li key={a.id} className="rounded-md border border-border/60 bg-bg-soft p-2.5">
                        {url ? <VoiceNote url={url} filename={a.storage_path} contentType={a.content_type} /> : null}
                        <p className="mt-1 text-xs text-muted-foreground">
                          {a.caption ? `${a.caption} · ` : ''}{a.uploaded_by_name ?? 'Unknown'} · {formatSaTime(a.created_at)}
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

      {report || fireReport || pcr || postMortem ? (
        <div id="case-report" className="space-y-4">
          {report ? <PoliceReportCard report={report} /> : null}
          {fireReport ? <FireReportCard report={fireReport} /> : null}
          {pcr ? <PcrCard pcr={pcr as unknown as Parameters<typeof PcrCard>[0]['pcr']} showLink /> : null}
          {postMortem ? <PostMortemCard report={postMortem} /> : null}
        </div>
      ) : null}

      {assessments.length ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('Disaster Management assessment')}</CardTitle>
            <CardDescription>{t('Every place assessed on site, added up.')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <AssessmentFigures rows={assessments} t={t} />
          </CardContent>
          <AssessmentList rows={assessments} t={t} />
        </Card>
      ) : null}

      <CallEdits edits={edits} loggedBy={incident.call_taken_by} />

      {/* Complete life of the incident, newest first */}
      <Card id="case-history">
        <CardHeader>
          <CardTitle>{t('Complete history ({length})', { length: events.length })}</CardTitle>
          <CardDescription>
            {t('Every milestone, update, evidence upload and audited action — from the first call{value}', { value: isCaseClosed ? ' through to closure.' : ' up to now.' })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('No activity recorded yet.')}</p>
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

/**
 * The officers on an incident and their bodycams (0054), for those who may
 * watch or pull footage. Null hides the card: no access, the feature is
 * switched off, or 0054 has not been run.
 */
async function incidentBodycams(
  supabase: Awaited<ReturnType<typeof getSession>>['supabase'],
  incident: Database['public']['Tables']['incidents']['Row'],
  responders: IncidentResponder[],
  role: UserRole,
  silo: Silo,
) {
  if (!featureEnabled(await getFeatures(), 'web.cameras')) return null;
  const canWatch = canAccess('/cameras', role, silo);
  const canFootage = canAccess('/cameras/footage', role, silo);
  if (!canWatch && !canFootage) return null;

  const people = new Map<string, IncidentBodycamPerson>();
  for (const r of responders) {
    people.set(r.user_id, { userId: r.user_id, name: r.name ?? 'An officer', role: r.role, bodycam: null });
  }
  if (incident.assigned_to && !people.has(incident.assigned_to)) {
    people.set(incident.assigned_to, {
      userId: incident.assigned_to, name: incident.assigned_to_name ?? 'The assigned officer', role: 'assigned', bodycam: null,
    });
  }
  const ids = [...people.keys()];
  const span = windowFor(incident.incident_created_at, incident.closed_at ?? incident.resolved_at ?? null);
  const [live, bookings] = await Promise.all([
    canWatch ? listBookedOutBodycams(supabase, { userIds: ids }).catch(() => null) : Promise.resolve([]),
    canFootage ? searchBodycamBookings(supabase, { from: span.from, to: span.to, userIds: ids }).catch(() => null) : Promise.resolve([]),
  ]);
  if (live === null || bookings === null) return null;
  for (const { bodycam } of live) {
    const person = bodycam.booked_to ? people.get(bodycam.booked_to) : undefined;
    if (person && canWatchBodycam({ role, silo }, bodycam.silo, 'live')) {
      person.bodycam = { bodycamId: bodycam.id, serial: bodycam.serial_number, since: bodycam.booked_at };
    }
  }
  return {
    people: [...people.values()],
    canWatch,
    canFootage,
    footageCount: bookings.filter((b) => canWatchBodycam({ role, silo }, b.silo, 'footage')).length,
  };
}
