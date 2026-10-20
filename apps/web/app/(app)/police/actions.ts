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

/** The database's refusal, in plain words for the form. */
function firearmError(e: unknown): string {
  const message = (e as { message?: string }).message ?? '';
  if (/Not permitted/.test(message)) return 'Only captains, supervisors and administrators issue firearms.';
  return message || 'It did not save. Try again.';
}

/** A datetime-local value ("2026-10-20T11:30") is South African time. */
const saTime = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? `${v}:00+02:00` : v);

/**
 * Issue a firearm: issue_firearm_authorization() checks who may, records
 * the issuer as whoever is signed in, and audits it (0089).
 */
export async function createFirearmAction(formData: FormData) {
  const { supabase } = await getSession();
  try {
    await createFirearmAuthorization(supabase, {
      form_number: S(formData, 'form_number'),
      employee_name: S(formData, 'employee_name') ?? '',
      company_number: S(formData, 'company_number'),
      id_number: S(formData, 'id_number') ?? '',
      firearm_number: S(formData, 'firearm_number') ?? '',
      make: S(formData, 'make'),
      rounds: N(formData, 'rounds_ammunition'),
      from: saTime(S(formData, 'from_date')) ?? '',
      to: saTime(S(formData, 'to_date')) ?? '',
      posted_location: S(formData, 'posted_location'),
      chamber_status: S(formData, 'chamber_status'),
      notes: S(formData, 'notes'),
    });
  } catch (e) {
    redirect(`/police/firearms/new?error=${encodeURIComponent(firearmError(e))}`);
  }
  revalidatePath('/police/firearms');
  redirect('/police/firearms');
}

/** Book a firearm back in, once: return_firearm_authorization() (0089). */
export async function returnFirearmAction(formData: FormData) {
  const { supabase } = await getSession();
  try {
    await returnFirearm(supabase, {
      id: String(formData.get('id')),
      rounds_returned: N(formData, 'rounds_returned'),
      condition: S(formData, 'condition'),
    });
  } catch (e) {
    redirect(`/police/firearms?error=${encodeURIComponent(firearmError(e))}`);
  }
  revalidatePath('/police/firearms');
}
