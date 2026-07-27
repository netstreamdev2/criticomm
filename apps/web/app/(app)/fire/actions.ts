'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createFirefighterReport, publishPublicIncidentReport, logAudit } from '@criticom/api';
import { getSession } from '@/lib/session';

const S = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? '').trim();
  return v === '' ? null : v;
};
const B = (fd: FormData, k: string) => fd.get(k) === 'on';
const N = (fd: FormData, k: string) => {
  const v = Number(fd.get(k));
  return Number.isFinite(v) ? v : 0;
};

export async function createFireReportAction(formData: FormData) {
  const { supabase, fullName } = await getSession();

  const report = await createFirefighterReport(supabase, {
    report_number: S(formData, 'report_number') ?? `FR-${Date.now()}`,
    date_of_incident: S(formData, 'date_of_incident') ?? new Date().toISOString().slice(0, 10),
    time_of_incident: S(formData, 'time_of_incident') ?? '00:00',
    location: S(formData, 'location'),
    type_of_incident: S(formData, 'type_of_incident'),
    fire_department_name: S(formData, 'fire_department_name'),
    station_number: S(formData, 'station_number'),
    dispatch_time_seconds: N(formData, 'dispatch_minutes') * 60,
    arrival_time_seconds: N(formData, 'arrival_minutes') * 60,
    clear_time_seconds: N(formData, 'clear_minutes') * 60,
    total_time_on_scene_seconds: N(formData, 'total_minutes') * 60,
    initial_observations: S(formData, 'initial_observations'),
    smoke_conditions: S(formData, 'smoke_conditions'),
    flame_spread: S(formData, 'flame_spread'),
    heat_signature: S(formData, 'heat_signature'),
    hazards_identified: S(formData, 'hazards_identified'),
    fire_suppression_details: S(formData, 'fire_suppression_details'),
    search_and_rescue_performed: B(formData, 'search_and_rescue_performed'),
    persons_rescued: N(formData, 'persons_rescued'),
    rescue_location: S(formData, 'rescue_location'),
    rescue_condition: S(formData, 'rescue_condition'),
    ventilation_conducted: B(formData, 'ventilation_conducted'),
    ventilation_type: S(formData, 'ventilation_type'),
    salvage_overhaul: B(formData, 'salvage_overhaul'),
    hazmat_operations: B(formData, 'hazmat_operations'),
    hazmat_description: S(formData, 'hazmat_description'),
    medical_aid_provided: B(formData, 'medical_aid_provided'),
    medical_aid_description: S(formData, 'medical_aid_description'),
    utilities_secured: B(formData, 'utilities_secured'),
    utility_details: S(formData, 'utility_details'),
    point_of_origin_room: S(formData, 'point_of_origin_room'),
    point_of_origin_object: S(formData, 'point_of_origin_object'),
    ignition_source: S(formData, 'ignition_source'),
    fire_cause: S(formData, 'fire_cause'),
    fire_investigation_conducted: B(formData, 'fire_investigation_conducted'),
    fire_investigation_reason: S(formData, 'fire_investigation_reason'),
    property_type: S(formData, 'property_type'),
    property_owner: S(formData, 'property_owner'),
    property_contact: S(formData, 'property_contact'),
    property_value: N(formData, 'property_value'),
    damage_estimate: N(formData, 'damage_estimate'),
    contents_value: N(formData, 'contents_value'),
    insurance_info: S(formData, 'insurance_info'),
    civilian_injuries: N(formData, 'civilian_injuries'),
    civilian_injury_details: S(formData, 'civilian_injury_details'),
    civilian_fatalities: N(formData, 'civilian_fatalities'),
    civilian_fatality_details: S(formData, 'civilian_fatality_details'),
    firefighter_injuries: N(formData, 'firefighter_injuries'),
    firefighter_injury_details: S(formData, 'firefighter_injury_details'),
    firefighter_fatalities: N(formData, 'firefighter_fatalities'),
    firefighter_fatality_details: S(formData, 'firefighter_fatality_details'),
    treatment_provided: B(formData, 'treatment_provided'),
    treatment_details: S(formData, 'treatment_details'),
    other_agencies_on_scene: S(formData, 'other_agencies_on_scene'),
    mutual_aid_used: B(formData, 'mutual_aid_used'),
    equipment_used: S(formData, 'equipment_used'),
    challenges_faced: S(formData, 'challenges_faced'),
    successes: S(formData, 'successes'),
    recommendations: S(formData, 'recommendations'),
    post_incident_critique_scheduled: B(formData, 'post_incident_critique_scheduled'),
    narrative_summary: S(formData, 'narrative_summary'),
    reporting_officer_name: S(formData, 'reporting_officer_name') ?? fullName,
    reporting_officer_rank: S(formData, 'reporting_officer_rank'),
    reporting_officer_id: S(formData, 'reporting_officer_id'),
  });

  await logAudit(supabase, {
    silo: 'MetroFire', action_type: 'FireReportCreated', entity_type: 'firefighter_report',
    entity_id: report.id, user_name: fullName, details: report.type_of_incident ?? undefined,
  });
  revalidatePath('/fire/reports');
  redirect(`/fire/reports/${report.id}`);
}

export async function publishPirAction(formData: FormData) {
  const { supabase, fullName } = await getSession();
  const reportId = String(formData.get('firefighter_report_id'));

  const pir = await publishPublicIncidentReport(supabase, {
    firefighter_report_id: reportId,
    public_report_number: S(formData, 'public_report_number') ?? `PIR-${Date.now()}`,
    date_of_incident: S(formData, 'date_of_incident') ?? new Date().toISOString().slice(0, 10),
    time_of_incident: S(formData, 'time_of_incident') ?? '00:00',
    fire_department_name: S(formData, 'fire_department_name'),
    station_number: S(formData, 'station_number'),
    incident_type: S(formData, 'incident_type'),
    public_location: S(formData, 'public_location') ?? '',
    public_summary: S(formData, 'public_summary') ?? '',
    damage_assessment: S(formData, 'damage_assessment'),
    cause_summary: S(formData, 'cause_summary'),
    actions_taken: S(formData, 'actions_taken'),
    public_safety_advisory: S(formData, 'public_safety_advisory'),
    total_civilian_injuries: N(formData, 'total_civilian_injuries'),
    total_civilian_fatalities: N(formData, 'total_civilian_fatalities'),
    total_responder_injuries: N(formData, 'total_responder_injuries'),
    total_responder_fatalities: N(formData, 'total_responder_fatalities'),
    authorizing_officer_name: S(formData, 'authorizing_officer_name') ?? fullName,
    authorizing_officer_id: S(formData, 'authorizing_officer_id'),
  });

  await logAudit(supabase, {
    silo: 'MetroFire', action_type: 'PIRPublished', entity_type: 'public_incident_report',
    entity_id: pir.id, user_name: fullName,
  });
  revalidatePath('/fire/pir');
  redirect('/fire/pir');
}
