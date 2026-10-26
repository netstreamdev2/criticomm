import { notFound } from 'next/navigation';
import { listDisasterAssessments } from '@criticom/api';
import { readMarker, type DisasterBrief } from '@criticom/api/criti/disaster';
import { IncidentLive } from '@/components/incident-live';
import { loadDesk, toDeskCallout } from '@/lib/disaster-desk';
import { getSession } from '@/lib/session';
import { requestT } from '@/lib/i18n';
import { DeskBoard } from './board';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Disaster Desk · HikTech' };

/** The Disaster desk's command board for one call (0111). */
export default async function DeskCallPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await requestT();
  const { id } = await params;
  const { supabase, role } = await getSession();
  const desk = await loadDesk(supabase, id);
  if (!desk) notFound();
  const { incident, record, notes, partners, ctx, facts, callShelters, register, inShelter, officers, onDutyNow } = desk;
  const assessments = await listDisasterAssessments(supabase, incident.id).catch(() => []);
  const hall = new Map(register.map((s) => [s.id, s]));
  const free = (id: string) => (hall.get(id)?.capacity ?? 0) - (inShelter.get(id) ?? 0);
  const forDisaster = incident.silo === 'EthekwiniDisaster'
    || (incident.dispatched_silos ?? []).includes('EthekwiniDisaster')
    || (incident.tagged_silos ?? []).includes('EthekwiniDisaster');
  if (!forDisaster) {
    return <p className="rounded-lg border border-border bg-bg-card p-6 text-sm text-muted-foreground">{t('This call was not sent to Disaster Management.')}</p>;
  }
  const finished = ['Resolved', 'Closed'].includes(incident.status) || !!incident.report_filed_at;

  return (
    <>
      <IncidentLive incidentId={incident.id} />
      <DeskBoard
        incident={{
          id: incident.id, number: incident.incident_number, type: incident.disaster_type || incident.incident_type,
          severity: incident.incident_severity, address: incident.location_address, suburb: incident.suburb, status: incident.status,
          calledInAt: incident.call_timestamp, description: incident.call_description,
          lat: incident.location_lat ?? null, lng: incident.location_lng ?? null, finished,
        }}
        callouts={record.callouts.map((c) => ({
          ...toDeskCallout(c), contact: c.contact_number, radio: c.radio_frequency, reason: c.reason,
          suggestedByAi: c.suggested_by_ai, calledBy: c.called_by_name,
        }))}
        updates={record.updates.map((u) => ({
          id: u.id, at: u.logged_at, source: u.source, from: u.from_name, calloutId: u.callout_id, text: u.text, by: u.logged_by_name,
        }))}
        notes={notes}
        partners={partners.map((p) => ({
          id: p.id, name: p.agency_name, type: p.resource_type, contact: p.contact_number, radio: p.radio_frequency, commander: p.commander_name,
        }))}
        brief={(record.brief?.brief as DisasterBrief | undefined) ?? null}
        briefAt={record.brief?.created_at ?? null}
        marker={readMarker(ctx)}
        ready={record.ready}
        canWrite={role !== 'Viewer'}
        facts={{
          shortTitle: facts?.short_title ?? null, hazard: facts?.hazard ?? null, level: facts?.level ?? 'Bronze',
          highestLevel: facts?.highest_level ?? 'Bronze', municipalities: facts?.municipalities ?? ['eThekwini Metro'],
          fcp: facts?.fcp_location ?? null, eoc: facts?.eoc_location ?? null, docActivatedAt: facts?.doc_activated_at ?? null,
        }}
        openings={callShelters.map((o) => ({
          id: o.id, shelterId: o.shelter_id, name: hall.get(o.shelter_id)?.name ?? t('Shelter'), capacity: hall.get(o.shelter_id)?.capacity ?? 0,
          free: free(o.shelter_id), keyHolder: hall.get(o.shelter_id)?.key_holder ?? null, keyHolderPhone: hall.get(o.shelter_id)?.key_holder_phone ?? null,
          peopleNow: o.people_now, peak: o.peak_people, households: o.households, children: o.children, elderly: o.elderly,
          disabled: o.disabled, relief: o.relief ?? {}, openedAt: o.opened_at, closedAt: o.closed_at,
        }))}
        register={register.map((s) => ({ id: s.id, name: s.name, municipality: s.municipality, ward: s.ward, capacity: s.capacity, free: free(s.id) }))}
        officers={officers.map((o) => {
          const d = onDutyNow.find((x) => x.personnel_id === o.id);
          return { id: o.id, name: o.name, phone: d?.phone ?? o.phone, duty: d?.duty ?? null, status: d?.status ?? null };
        })}
        assessments={assessments.slice().reverse().map((a) => ({
          id: a.id, place: a.place, householdsAffected: a.households_affected, peopleDisplaced: a.people_displaced,
          homesDestroyed: a.homes_destroyed, reportedBy: a.reported_by_name ?? a.filed_by_name, at: a.filed_at,
        }))}
      />
    </>
  );
}
