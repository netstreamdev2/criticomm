import { DETAIL_FIELDS, QUESTION_PREFIX } from './intake-details.ts';
import { patientText, readPatients } from './call-facts.ts';

/**
 * The changes made to a call after it was sent (0079): by the call taker
 * adding details, or by a dispatcher before dispatching. Each is kept with
 * each field as it was and as it became; the call page and the case PDF show
 * them in these words.
 */

export type EditKind = 'intake' | 'dispatch';
export type EditChange = { before: unknown; after: unknown };
export type IncidentEdit = {
  id: string;
  incident_id: string;
  kind: EditKind;
  edited_by: string | null;
  edited_by_name: string | null;
  edited_by_role: string | null;
  reason: string | null;
  changes: Record<string, EditChange>;
  edited_at: string;
};

/** Each field's name as people read it, in the order the call reads. */
export const EDIT_FIELD_LABELS: Readonly<Record<string, string>> = {
  incident_type: 'Incident type',
  incident_category: 'Category',
  incident_severity: 'Severity',
  call_description: 'Description',
  details: 'Details',
  caller_name: 'Caller name',
  caller_number: 'Caller number',
  is_caller_patient: 'Caller is the patient',
  patient_name: 'Patient name',
  patients: 'Patients',
  number_of_victims: 'People hurt',
  medical_type: 'Medical code',
  injuries: 'Injuries',
  location: 'Location',
  suburb: 'Suburb',
  city: 'City',
  postal_code: 'Postal code',
  region: 'Region',
  notes: 'Dispatch notes',
  call_channel: 'How the call came in',
};
const ORDER = Object.keys(EDIT_FIELD_LABELS);

export function editKindName(kind: EditKind): string {
  return kind === 'dispatch' ? 'Edited before dispatch' : 'Details added by the call taker';
}

/** One field's value, as words: "Yes", "Cellphone, TV", "112 Florida Road (-29.84, 31.01)". */
export function editValueText(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'is_caller_patient') return value === true ? 'Yes' : value === false ? 'No' : '—';
  if (field === 'location' && typeof value === 'object') {
    const v = value as { address?: string | null; lat?: number | null; lng?: number | null };
    const point = typeof v.lat === 'number' && typeof v.lng === 'number' ? ` (${v.lat.toFixed(5)}, ${v.lng.toFixed(5)})` : '';
    return `${v.address || '—'}${point}`;
  }
  if (field === 'patients') {
    const list = readPatients(value);
    return list.length ? list.map(patientText).join('; ') : '—';
  }
  if (field === 'details' && typeof value === 'object' && !Array.isArray(value)) {
    const lines = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0) && v !== '')
      .map(([k, v]) => {
        const label = k.startsWith(QUESTION_PREFIX) ? k.slice(QUESTION_PREFIX.length) : DETAIL_FIELDS[k]?.label ?? k;
        return `${label}: ${Array.isArray(v) ? v.join(', ') : String(v)}`;
      });
    return lines.length ? lines.join('; ') : '—';
  }
  if (Array.isArray(value)) return value.length ? value.map(String).join(', ') : '—';
  return String(value);
}

/** An edit's fields in reading order, each with its label and both values as words. */
export function editLines(changes: Record<string, EditChange>) {
  return Object.keys(changes)
    .sort((a, b) => (ORDER.indexOf(a) === -1 ? 99 : ORDER.indexOf(a)) - (ORDER.indexOf(b) === -1 ? 99 : ORDER.indexOf(b)))
    .map((field) => ({
      field,
      label: EDIT_FIELD_LABELS[field] ?? field,
      before: editValueText(field, changes[field]?.before),
      after: editValueText(field, changes[field]?.after),
    }));
}

/** Who changed a call before dispatch: each dispatcher once, in the order they edited. */
export function dispatchEditors(edits: readonly IncidentEdit[]): string[] {
  const names = edits.filter((e) => e.kind === 'dispatch').map((e) => e.edited_by_name ?? 'A dispatcher');
  return [...new Set(names)];
}

/** The call as it was logged, for each field changed since: the value before its first change. */
export function asLogged(edits: readonly IncidentEdit[]): Array<{ field: string; label: string; value: string }> {
  const first = new Map<string, unknown>();
  for (const e of [...edits].sort((a, b) => a.edited_at.localeCompare(b.edited_at))) {
    for (const [field, change] of Object.entries(e.changes)) if (!first.has(field)) first.set(field, change.before);
  }
  return editLines(Object.fromEntries([...first].map(([f, before]) => [f, { before, after: null }])))
    .map((l) => ({ field: l.field, label: l.label, value: l.before }));
}
