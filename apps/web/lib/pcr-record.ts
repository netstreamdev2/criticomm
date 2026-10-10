/**
 * The console's PCR form ↔ the paramedic_reports row and its nested records.
 * Fields come from the shared ePCR spec (@criticom/db/pcr), so the console
 * asks the same questions the phone does.
 */
import { PCR_FIELDS, gcsTotal, pcrFieldShown } from '@criticom/db/pcr';

/** Answers that live in the nested records, not on the report row. */
const NESTED = new Set([
  'medical_history', 'blood_pressure', 'pulse_rate', 'respiratory_rate', 'oxygen_saturation',
  'blood_glucose_level', 'airway_management', 'circulation_management', 'medication_admin',
]);
/** Report columns stored as timestamps, asked as HH:MM on the day. */
const STAMP_TIMES = new Set(['departure_time', 'arrival_time']);

const SA_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' });
const SA_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hour12: false });

/** A signature as an image source, whichever pad drew it (web PNG base64 or the phone's data URI). */
export function signatureSrc(v: string | null | undefined): string | null {
  if (!v) return null;
  return v.startsWith('data:') ? v : `data:image/png;base64,${v}`;
}

/** The form's answers as plain strings. */
export function answersFrom(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of PCR_FIELDS) {
    const raw = fd.get(f.key);
    out[f.key] = f.kind === 'flag' ? (raw === 'on' ? 'true' : 'false') : String(raw ?? '').trim();
  }
  for (const k of ['responder_signature_image_base64', 'hospital_representative_signature_base64', 'doctor_signature_image_base64']) {
    out[k] = String(fd.get(k) ?? '').trim();
  }
  out.requires_cleaning = fd.get('requires_cleaning') === 'on' ? 'true' : 'false';
  return out;
}

/** The report row, the nested records and anything wrong, from the answers. */
export function recordFrom(a: Record<string, string>, day = SA_DAY.format(new Date())) {
  const row: Record<string, string | number | boolean | null> = {};
  for (const f of PCR_FIELDS) {
    if (NESTED.has(f.key)) continue;
    // A question that does not apply (no insurance, no handover) is not kept.
    if (!pcrFieldShown(f, a) && f.kind !== 'flag') { row[f.key] = null; continue; }
    const v = a[f.key] ?? '';
    if (f.kind === 'flag') row[f.key] = v === 'true';
    else if (f.key === 'has_insurance') row[f.key] = v === 'Yes' ? 'yes' : 'no';
    else if (f.key === 'insurance_information') row[f.key] = a.has_insurance === 'Yes' && v ? v : null;
    else if (f.kind === 'count') row[f.key] = v === '' ? null : Number(v);
    else if (STAMP_TIMES.has(f.key)) row[f.key] = v ? new Date(`${day}T${v}:00+02:00`).toISOString() : null;
    else row[f.key] = v === '' ? null : v;
  }
  for (const k of ['responder_signature_image_base64', 'hospital_representative_signature_base64', 'doctor_signature_image_base64']) {
    if (a[k]) row[k] = a[k];
  }
  row.requires_cleaning = a.requires_cleaning === 'true';
  const nil = (k: string) => (a[k] ? a[k] : null);
  const gcs = gcsTotal(a);
  return {
    row,
    vitals: {
      blood_pressure: nil('blood_pressure'), pulse_rate: nil('pulse_rate'), respiratory_rate: nil('respiratory_rate'),
      oxygen_saturation: nil('oxygen_saturation'), blood_glucose_level: nil('blood_glucose_level'),
      temperature: nil('body_temperature'), glasgow_coma_scale: gcs === null ? null : String(gcs),
    },
    interventions: {
      airway_management: nil('airway_management'), circulation_management: nil('circulation_management'),
      medication_admin: nil('medication_admin'),
    },
    medical_history: {
      allergies: nil('allergies'), chronic_conditions: nil('medical_history'), medications: nil('current_medications'),
    },
  };
}

type Nested = Record<string, unknown> | null | undefined;

/** A filed report back as form answers, for editing. */
export function defaultsFrom(p: Record<string, unknown> & { vitals?: Nested; interventions?: Nested; medical_history?: Nested }) {
  const out: Record<string, string> = {};
  for (const f of PCR_FIELDS) {
    const v = p[f.key];
    if (f.kind === 'flag') out[f.key] = v === true ? 'true' : 'false';
    else if (f.key === 'has_insurance') out[f.key] = String(v ?? '').toLowerCase() === 'yes' ? 'Yes' : 'No';
    else if (STAMP_TIMES.has(f.key)) out[f.key] = typeof v === 'string' && v ? SA_TIME.format(new Date(v)) : '';
    else if (f.key === 'medication_time') out[f.key] = typeof v === 'string' ? v.slice(0, 5) : '';
    else out[f.key] = v === null || v === undefined ? '' : String(v);
  }
  const s = (o: Nested, k: string) => (o && o[k] != null ? String(o[k]) : '');
  for (const k of ['blood_pressure', 'pulse_rate', 'respiratory_rate', 'oxygen_saturation', 'blood_glucose_level']) out[k] = s(p.vitals, k);
  for (const k of ['airway_management', 'circulation_management', 'medication_admin']) out[k] = s(p.interventions, k);
  out.medical_history = s(p.medical_history, 'chronic_conditions');
  for (const k of ['responder_signature_image_base64', 'hospital_representative_signature_base64', 'doctor_signature_image_base64']) {
    out[k] = typeof p[k] === 'string' ? (p[k] as string) : '';
  }
  out.requires_cleaning = p.requires_cleaning === true ? 'true' : 'false';
  return out;
}
