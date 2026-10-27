import { notFound } from 'next/navigation';
import {
  getOperationalSettings, getReview, listCouncillors, listDisasterAssessments, listJocMembers, listJocSessions, listLevelChanges, listLiveWarnings,
  listWardRelief,
} from '@criticom/api';
import { JOC_LEVEL, warningState } from '@criticom/db/disaster-warnings';
import { OpsMap } from '@/components/ops-map/ops-map';
import { availableLayers } from '@/lib/ops-map/layers';
import { readMarker, type DisasterBrief } from '@criticom/api/criti/disaster';
import { IncidentLive } from '@/components/incident-live';
import { loadDesk, toDeskCallout } from '@/lib/disaster-desk';
import { getSession } from '@/lib/session';
import { requestT } from '@/lib/i18n';
import { DeskBoard } from './board';
import { PageGuide } from '@/components/office/page-guide';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Disaster Desk · HikTech' };

/** The Disaster desk's command board for one call (0111). */
export default async function DeskCallPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await requestT();
  const { id } = await params;
  const { supabase, role, silo, userId } = await getSession();
  const desk = await loadDesk(supabase, id);
  if (!desk) notFound();
  const { incident, record, notes, partners, ctx, facts, callShelters, register, inShelter, officers, onDutyNow,
    lineReports, contacts, casualties, counts, figures } = desk;
  const [assessments, settings, changes, members, sessions, review, councillors, warnings, postMortem, relief] = await Promise.all([
    listDisasterAssessments(supabase, incident.id).catch(() => []),
    getOperationalSettings(supabase).catch(() => null),
    listLevelChanges(supabase, incident.id), listJocMembers(supabase, incident.id), listJocSessions(supabase, incident.id),
    getReview(supabase, incident.id), listCouncillors(supabase), listLiveWarnings(supabase),
    supabase.from('post_mortem_reports').select('lessons_learned').eq('incident_id', incident.id).maybeSingle()
      .then((r) => (r.data as { lessons_learned: string | null } | null)?.lessons_learned ?? null),
    listWardRelief(supabase, incident.id),
  ]);
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
      <div className="mb-6">
        <PageGuide id="disaster.board" steps={[
          t('Read top to bottom: the status, the figures, the level, the JOC, then what came in with Criti beside it.'),
          t('Moving up a level needs a reason ticked. Gold, the JOC, also needs who authorised it.'),
          t('Log every call, radio message or WhatsApp in Log what came in. Criti reads it and suggests what to do.'),
          t('Press a tile’s heading to fold it away. The (i) says what each part is for.'),
        ]} />
      </div>
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
          food: o.food ?? null, toiletries: o.toiletries ?? null, water: o.water ?? null, toilets: o.toilets ?? 0, temporaryToilets: o.temporary_toilets ?? 0,
        }))}
        register={register.map((s) => ({ id: s.id, name: s.name, municipality: s.municipality, ward: s.ward, capacity: s.capacity, free: free(s.id) }))}
        officers={officers.map((o) => {
          const d = onDutyNow.find((x) => x.personnel_id === o.id);
          return { id: o.id, name: o.name, phone: d?.phone ?? o.phone, duty: d?.duty ?? null, status: d?.status ?? null };
        })}
        lineReports={lineReports.map((r) => ({
          department: r.department, status: r.status, representativeName: r.representative_name, representativePost: r.representative_post,
          representativePhone: r.representative_phone, atDoc: r.at_doc, duties: r.duties ?? {}, figures: r.figures ?? {}, notes: r.notes,
        }))}
        contacts={contacts.map((c) => ({ id: c.id, department: c.department, name: c.name, post: c.post, phone: c.phone, docRep: c.doc_rep }))}
        casualties={casualties === null ? null : casualties.map((c) => ({
          id: c.id, kind: c.kind, name: c.name, phone: c.phone, address: c.address, gender: c.gender, age: c.age,
          description: c.description, condition: c.condition, takenTo: c.taken_to, notes: c.notes,
        }))}
        counts={counts}
        figures={figures}
        map={(
          <OpsMap incidents={[incident]} officers={[]} silo="EthekwiniDisaster"
            layers={availableLayers({ cameras: false, shelters: true, catalogue: true })}
            defaults={['incidents', 'zones', 'shelters', 'radar', 'traffic', 'saws-areas']}
            basemap={settings?.['map.default_basemap'] ?? 'dark'} scopeLabel={t('Disaster Management')} height={520}
            me={{ id: userId, role, silo }} drawForIncidentId={incident.id}
            shelters={register.filter((s) => s.lat != null && s.lng != null).map((s) => ({
              id: s.id, name: s.name, lat: s.lat!, lng: s.lng!, capacity: s.capacity, people: inShelter.get(s.id) ?? 0 }))} />
        )}
        smsTargets={[
          ...(incident.caller_number && incident.caller_number.replace(/\D/g, '').length >= 9
            ? [{ key: 'caller', name: incident.caller_name || t('Caller'), number: incident.caller_number, kind: 'caller' as const }] : []),
          ...lineReports.filter((r) => r.representative_phone).map((r) => ({
            key: `rep:${r.department}`, name: r.representative_name ?? r.department, number: r.representative_phone!, kind: 'manager' as const })),
          ...record.callouts.filter((c) => c.contact_number && c.contact_number.replace(/\D/g, '').length >= 9).map((c) => ({
            key: `out:${c.id}`, name: c.agency_name, number: c.contact_number!, kind: 'partner' as const })),
        ]}
        level={{
          facts: {
            level: facts?.level ?? 'Bronze', highestLevel: facts?.highest_level ?? 'Bronze', dmStatus: facts?.dm_status ?? 'Active',
            fcp: facts?.fcp_location ?? null, fcpCommander: facts?.fcp_commander ?? null, eoc: facts?.eoc_location ?? null,
            eocCommander: facts?.eoc_commander ?? null, jocAuthorisedBy: facts?.joc_authorised_by ?? null,
            jocAuthoriserRole: facts?.joc_authoriser_role ?? null, jocOnRoster: facts?.joc_authoriser_on_roster ?? null,
            jocReason: facts?.joc_reason ?? null, jocAt: facts?.doc_activated_at ?? null,
          },
          changes: changes.map((c) => ({
            at: c.at, from: c.from_level, to: c.to_level, triggers: c.triggers, reason: c.reason, by: c.by_name,
            authorisedBy: c.authorised_by, role: c.authoriser_role, onRoster: c.authoriser_on_roster,
          })),
          roster: onDutyNow.map((d) => ({ name: d.name, duty: d.duty })),
          warning4: warnings.some((w) => w.level >= JOC_LEVEL && warningState(w) === 'In force'),
        }}
        joc={{
          checks: facts?.checks ?? {},
          members: members.map((m) => ({ id: m.id, kind: m.kind, name: m.name, representative: m.representative, phone: m.phone })),
          sessions: sessions.filter((x) => x.kind === 'Daily').map((x) => ({ id: x.id, at: x.held_at, attended: x.attended, notes: x.notes, by: x.created_by_name })),
          councillors: councillors.filter((c) => c.is_active).map((c) => ({ ward: c.ward, name: c.name, phone: c.phone })),
        }}
        after={{
          recovery: facts?.recovery ?? {}, lessons: postMortem, statusAt: facts?.dm_status_at ?? null, statusBy: facts?.dm_status_by ?? null,
          review: review ? {
            reviewDate: review.review_date, leadReviewer: review.lead_reviewer, what_happened: review.what_happened, what_worked: review.what_worked,
            to_improve: review.to_improve, lessons: review.lessons, recommendations: review.recommendations, signoffs: review.signoffs ?? {},
            signedOffAt: review.signed_off_at,
          } : null,
        }}
        informal={facts?.informal_settlement ?? false}
        relief={relief.map((w) => ({
          id: w.id, municipality: w.municipality, ward: w.ward, councillor: w.councillor, councillorPhone: w.councillor_phone, notes: w.notes,
          households: w.households, people: w.people, disabled: w.disabled, older: w.older, under_five: w.under_five,
          blankets: w.blankets, mattresses: w.mattresses, food_hampers: w.food_hampers, start_house_kits: w.start_house_kits,
        }))}
        assessments={assessments.slice().reverse().map((a) => ({
          id: a.id, place: a.place, householdsAffected: a.households_affected, peopleDisplaced: a.people_displaced,
          homesDestroyed: a.homes_destroyed, reportedBy: a.reported_by_name ?? a.filed_by_name, at: a.filed_at,
        }))}
      />
    </>
  );
}
