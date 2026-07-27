'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createSecurityReport, resolveSecurityReport, logAudit } from '@criticom/api';
import { getSession } from '@/lib/session';

const S = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? '').trim();
  return v === '' ? null : v;
};
const B = (fd: FormData, k: string) => fd.get(k) === 'on';

export async function createSecurityReportAction(formData: FormData) {
  const { supabase, fullName } = await getSession();
  const report = await createSecurityReport(supabase, {
    guard_name: S(formData, 'guard_name') ?? fullName,
    guard_id: S(formData, 'guard_id'),
    badge_number: S(formData, 'badge_number'),
    contact_number: S(formData, 'contact_number'),
    sira_number: S(formData, 'sira_number'),
    sira_grade: S(formData, 'sira_grade'),
    firearm_issued: B(formData, 'firearm_issued'),
    firearm_number: S(formData, 'firearm_number'),
    location: S(formData, 'location'),
    zone_code: S(formData, 'zone_code'),
    weather_conditions: S(formData, 'weather_conditions'),
    lighting_conditions: S(formData, 'lighting_conditions'),
    incident_type: S(formData, 'incident_type') ?? 'Other',
    incident_code: S(formData, 'incident_code'),
    incident_description: S(formData, 'incident_description'),
    severity_level: S(formData, 'severity_level'),
    incident_start_time: S(formData, 'incident_start_time') ?? new Date().toISOString(),
    incident_end_time: S(formData, 'incident_end_time'),
    actions_taken: S(formData, 'actions_taken'),
    equipment_used: S(formData, 'equipment_used'),
    authorities_notified: B(formData, 'authorities_notified'),
    authorities_contacted: S(formData, 'authorities_contacted'),
    supervisor_name: S(formData, 'supervisor_name'),
    supervisor_remarks: S(formData, 'supervisor_remarks'),
    additional_notes: S(formData, 'additional_notes'),
    is_emergency: B(formData, 'is_emergency'),
    is_repeat_incident: B(formData, 'is_repeat_incident'),
    previous_incident_reference: S(formData, 'previous_incident_reference'),
    created_by: fullName,
  });
  await logAudit(supabase, {
    silo: 'MetroPolice', action_type: 'SecurityReportCreated', entity_type: 'security_report',
    entity_id: report.id, user_name: fullName, details: report.incident_type,
  });
  revalidatePath('/police/security');
  redirect('/police/security');
}

export async function resolveSecurityReportAction(formData: FormData) {
  const { supabase, fullName } = await getSession();
  const id = String(formData.get('id'));
  await resolveSecurityReport(supabase, {
    id,
    resolution_summary: String(formData.get('resolution_summary') ?? '').trim() || null,
  });
  await logAudit(supabase, {
    silo: 'MetroPolice', action_type: 'SecurityReportResolved', entity_type: 'security_report',
    entity_id: id, user_name: fullName,
  });
  revalidatePath('/police/security');
}
