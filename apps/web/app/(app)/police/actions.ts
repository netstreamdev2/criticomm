'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createMetroReport, createFirearmAuthorization, returnFirearm, logAudit } from '@criticom/api';
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

export async function createMetroReportAction(formData: FormData) {
  const { supabase, fullName } = await getSession();

  // Itemised offenses (up to 5 rows from the wizard)
  const offenses: Array<{ offense_type: string; fine_amount: number }> = [];
  for (let i = 0; i < 5; i++) {
    const type = S(formData, `offense_type_${i}`);
    if (type) offenses.push({ offense_type: type, fine_amount: N(formData, `offense_fine_${i}`) });
  }

  const report = await createMetroReport(supabase, {
    case_number: S(formData, 'case_number') ?? `MP-${Date.now()}`,
    incident_category: S(formData, 'incident_category'),
    date_of_offense: S(formData, 'date_of_offense') ?? new Date().toISOString().slice(0, 10),
    time_of_offense: S(formData, 'time_of_offense'),
    location: S(formData, 'location'),
    station: S(formData, 'station'),
    officer_name: S(formData, 'officer_name') ?? fullName,
    badge_number: S(formData, 'badge_number'),
    partner_name: S(formData, 'partner_name'),
    officer_narrative: S(formData, 'officer_narrative'),
    ticket_number: S(formData, 'ticket_number'),
    offender_name: S(formData, 'offender_name'),
    offender_id: S(formData, 'offender_id'),
    vehicle_make: S(formData, 'vehicle_make'),
    license_plate: S(formData, 'license_plate'),
    vin_number: S(formData, 'vin_number'),
    reg_number: S(formData, 'reg_number'),
    fine_amount: N(formData, 'fine_amount'),
    vehicle_impounded: B(formData, 'vehicle_impounded') ? 'Yes' : 'No',
    impound_lot: S(formData, 'impound_lot'),
    arrest_made: B(formData, 'arrest_made') ? 'Yes' : 'No',
    suspect_name: S(formData, 'suspect_name'),
    suspect_description: S(formData, 'suspect_description'),
    charges: S(formData, 'charges'),
    victim_name: S(formData, 'victim_name'),
    victim_contact: S(formData, 'victim_contact'),
    victim_id: S(formData, 'victim_id'),
    victim_injuries: S(formData, 'victim_injuries'),
    evidence_weapons: B(formData, 'evidence_weapons'),
    evidence_drugs: B(formData, 'evidence_drugs'),
    evidence_property: B(formData, 'evidence_property'),
    evidence_log: S(formData, 'evidence_log'),
    contraband_seized: S(formData, 'contraband_seized'),
    contraband_details: S(formData, 'contraband_details'),
    ammunition_rounds: N(formData, 'ammunition_rounds'),
    bodycam_active: B(formData, 'bodycam_active') ? 'Yes' : 'No',
    use_of_force: S(formData, 'use_of_force'),
    weapon_type: S(formData, 'weapon_type'),
    weapon_size: S(formData, 'weapon_size'),
  }, offenses);

  await logAudit(supabase, {
    silo: 'MetroPolice', action_type: 'MetroReportCreated', entity_type: 'metro_report',
    entity_id: report.id, user_name: fullName, details: report.incident_category ?? undefined,
  });
  revalidatePath('/police/reports');
  redirect(`/police/reports/${report.id}`);
}

export async function createFirearmAction(formData: FormData) {
  const { supabase, fullName } = await getSession();
  const rec = await createFirearmAuthorization(supabase, {
    form_number: S(formData, 'form_number') ?? `FA-${Date.now()}`,
    employee_name: S(formData, 'employee_name') ?? '',
    company_number: S(formData, 'company_number'),
    id_number: S(formData, 'id_number') ?? '',
    firearm_number: S(formData, 'firearm_number') ?? '',
    make: S(formData, 'make'),
    rounds_ammunition: N(formData, 'rounds_ammunition'),
    from_date: S(formData, 'from_date') ?? new Date().toISOString(),
    to_date: S(formData, 'to_date') ?? new Date().toISOString(),
    posted_location: S(formData, 'posted_location'),
    issued_by: S(formData, 'issued_by') ?? fullName,
    chamber_status: S(formData, 'chamber_status'),
    notes: S(formData, 'notes'),
  });
  await logAudit(supabase, {
    silo: 'MetroPolice', action_type: 'FirearmIssued', entity_type: 'firearm_authorization',
    entity_id: rec.id, user_name: fullName, details: `${rec.firearm_number} → ${rec.employee_name}`,
  });
  revalidatePath('/police/firearms');
  redirect('/police/firearms');
}

export async function returnFirearmAction(formData: FormData) {
  const { supabase, fullName } = await getSession();
  const id = String(formData.get('id'));
  await returnFirearm(supabase, {
    id,
    rounds_returned: N(formData, 'rounds_returned'),
    received_by: fullName,
    condition: S(formData, 'condition'),
  });
  await logAudit(supabase, {
    silo: 'MetroPolice', action_type: 'FirearmReturned', entity_type: 'firearm_authorization',
    entity_id: id, user_name: fullName,
  });
  revalidatePath('/police/firearms');
}
