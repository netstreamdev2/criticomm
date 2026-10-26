import 'server-only';
import {
  getCallFacts, getDeskRecord, getIncident, getIncidentUpdates, listCallShelters, listDisasterOfficers, listDuty,
  listMutualAidPartners, listOpenShelters, listShelterEntries, listShelters,
  type DisasterCallout, type DisasterDeskUpdate,
} from '@criticom/api';
import type { DeskCallout, DeskContext, DeskUpdate } from '@criticom/api/criti/disaster';
import type { CriticomClient } from '@criticom/db';

/**
 * Everything the Disaster desk shows and Criti reads for one call, read with
 * the dispatcher's own sign-in (the database decides what they may see).
 */

/** Lines the desk writes on the call's own timeline (0111, 0112): shown from the desk's tables instead. */
const DESK_LINE = /^\[(CALL-OUT|PARTNER|SHELTER|UPDATE · [^\]]*)\]/;

export const toDeskCallout = (c: DisasterCallout): DeskCallout => ({
  id: c.id, partnerId: c.partner_id, name: c.agency_name, type: c.resource_type, how: c.how, status: c.status,
  etaMinutes: c.eta_minutes, calledAt: c.called_at, onWayAt: c.on_way_at, onSceneAt: c.on_scene_at, leftAt: c.left_at,
});
export const toDeskUpdate = (u: DisasterDeskUpdate): DeskUpdate => ({ at: u.logged_at, source: u.source, from: u.from_name, text: u.text });

export async function loadDesk(supabase: CriticomClient, incidentId: string) {
  const incident = await getIncident(supabase, incidentId).catch(() => null);
  if (!incident) return null;
  const now = new Date();
  const [record, timeline, partners, facts, callShelters, register, openEverywhere, entries, officers, duty] = await Promise.all([
    getDeskRecord(supabase, incident.id),
    getIncidentUpdates(supabase, incident.id).catch(() => []),
    listMutualAidPartners(supabase).catch(() => []),
    // The rest is empty until 0112 is run.
    getCallFacts(supabase, incident.id),
    listCallShelters(supabase, incident.id),
    listShelters(supabase),
    listOpenShelters(supabase),
    listShelterEntries(supabase, incident.id),
    listDisasterOfficers(supabase),
    listDuty(supabase),
  ]);
  const notes = timeline
    .filter((u) => !DESK_LINE.test(u.message))
    .map((u) => ({ at: u.timestamp, text: u.message, by: u.created_by_name }))
    .reverse();
  // People in each registered shelter now, across every call: space left is capacity minus these.
  const inShelter = new Map<string, number>();
  for (const o of openEverywhere) inShelter.set(o.shelter_id, (inShelter.get(o.shelter_id) ?? 0) + o.people_now);
  const hallById = new Map(register.map((s) => [s.id, s]));
  const onDutyNow = duty.filter((d) => new Date(d.starts_at) <= now && new Date(d.ends_at) > now);
  const ctx: DeskContext = {
    number: incident.incident_number,
    type: incident.incident_type,
    disasterType: incident.disaster_type,
    severity: incident.incident_severity,
    address: incident.location_address,
    suburb: incident.suburb,
    description: incident.call_description,
    injuries: incident.injuries ?? [],
    victims: incident.number_of_victims,
    details: incident.details ?? {},
    calledInAt: incident.call_timestamp,
    notes: notes.map(({ at, text }) => ({ at, text })),
    callouts: record.callouts.map(toDeskCallout),
    updates: record.updates.map(toDeskUpdate),
    partners: partners.map((p) => ({ id: p.id, name: p.agency_name, type: p.resource_type })),
    shortTitle: facts?.short_title ?? null,
    hazard: facts?.hazard ?? null,
    level: facts?.level ?? 'Bronze',
    municipalities: facts?.municipalities ?? [],
    shelters: callShelters.filter((o) => !o.closed_at).map((o) => ({
      name: hallById.get(o.shelter_id)?.name ?? 'Shelter', peopleNow: o.people_now, capacity: hallById.get(o.shelter_id)?.capacity ?? 0,
    })),
    onDuty: onDutyNow.map((d) => ({ name: d.name, duty: d.duty, status: d.status })),
  };
  return { incident, record, notes, partners, facts, callShelters, register, inShelter, entries, officers, onDutyNow, ctx };
}
