'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  composeReportType, createMetroReport, createFirearmAuthorization, formIdsOf, logAudit, returnFirearm,
  splitReportAnswers, validateReportAnswers,
} from '@criticom/api';
import { getSession } from '@/lib/session';

const S = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? '').trim();
  return v === '' ? null : v;
};
const N = (fd: FormData, k: string) => {
  const v = Number(fd.get(k));
  return Number.isFinite(v) ? v : 0;
};

export type ConsoleReportInput = {
  forms: string[];
  header: {
    case_number: string; date_of_offense: string; time_of_offense: string;
    location: string; station: string; officer_name: string; badge_number: string;
  };
  answers: Record<string, string>;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * A police report filed from the console on the DMPS forms: the same forms,
 * shared blocks and storage as an officer's report on a call, without the call.
 */
export async function fileConsoleReportAction(input: ConsoleReportInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { supabase, fullName, userId } = await getSession();
  const forms = formIdsOf(input.forms.join('+'));
  if (forms.length === 0) return { ok: false, error: 'Choose at least one form.' };
  const type = composeReportType(forms);
  const h = input.header;
  const location = h.location.trim();
  const problems = [
    ...(!location ? ['Location is required.'] : []),
    ...(!DAY.test(h.date_of_offense) ? ['Date of offence must be a date.'] : []),
    ...(h.time_of_offense && !CLOCK.test(h.time_of_offense) ? ['Time of offence must be HH:MM.'] : []),
    ...validateReportAnswers(type, input.answers),
  ];
  if (problems.length) return { ok: false, error: problems.join(' ') };

  const { fields, details } = splitReportAnswers(type, input.answers);
  const yes = (k: string) => fields[k] === 'Yes' || fields[k] === 'true';
  try {
    const report = await createMetroReport(supabase, {
      silo: 'MetroPolice',
      case_number: h.case_number.trim() || `MP-${Date.now()}`,
      incident_category: type.label,
      report_type: type.id,
      details,
      date_of_offense: h.date_of_offense,
      time_of_offense: h.time_of_offense || null,
      location,
      station: h.station.trim() || null,
      officer_name: h.officer_name.trim() || fullName,
      badge_number: h.badge_number.trim() || null,
      partner_name: fields.partner_name ?? null,
      bodycam_active: fields.bodycam_active ?? null,
      use_of_force: fields.use_of_force ?? null,
      arrest_made: fields.arrest_made ?? 'No',
      charges: fields.charges ?? null,
      evidence_weapons: yes('evidence_weapons'),
      evidence_drugs: yes('evidence_drugs'),
      evidence_property: yes('evidence_property'),
      evidence_log: fields.evidence_log ?? null,
      officer_narrative: fields.officer_narrative ?? null,
      vehicle_impounded: 'No',
      filed_by: userId,
      filed_at: new Date().toISOString(),
    });
    await logAudit(supabase, {
      silo: 'MetroPolice', action_type: 'MetroReportCreated', entity_type: 'metro_report',
      entity_id: report.id, user_name: fullName, details: type.label,
    });
    revalidatePath('/police/reports');
    revalidatePath('/police');
    return { ok: true, id: report.id };
  } catch (e) {
    return { ok: false, error: (e as { message?: string })?.message ?? 'The report was not filed.' };
  }
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
