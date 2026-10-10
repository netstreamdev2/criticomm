/**
 * Police case reports (migration 0039, `file_incident_report`).
 *
 * Every report opens with the case report (response, outcome, evidence and
 * the officer's narrative) and adds the DMPS forms the call needs: an arrest
 * is a 12A, a crash a CR1, a tow a 211A, and so on (./report-forms.ts). The
 * officer can add or remove forms; the call type suggests the first.
 *
 * Fields marked `column` land in their own `metro_reports` column (the server
 * whitelists exactly these keys); everything else is kept, labelled, in
 * `metro_reports.details`. A form's field is stored under the form's id
 * ("arrest_off_rank"), and a repeated row under its number as well
 * ("accident_drivers_2_surname"), so forms never overwrite one another. The
 * report's `report_type` lists the forms filed ("arrest+tow"). The phone's
 * form, the console's form, the case file and the PDF all read this one
 * definition, so they can never disagree.
 */
import { EVIDENCE, LEGACY_REPORT_TYPES, NARRATIVE, OUTCOME, RESPONSE } from './report-types-legacy.ts';
import { POLICE_REPORT_FORMS, type PoliceReportForm } from './report-forms.ts';

export { POLICE_REPORT_FORMS, type PoliceReportForm } from './report-forms.ts';

export type ReportFieldKind =
  | 'text' | 'multiline' | 'yesno' | 'choice' | 'number'
  /** Several of the options at once, stored "; "-separated. */
  | 'multi'
  /** YYYY-MM-DD and HH:MM. */
  | 'date' | 'time'
  /** An inspection item: OK, Fault or NIL. */
  | 'check';

export type ReportField = {
  key: string;
  label: string;
  kind: ReportFieldKind;
  options?: readonly string[];
  placeholder?: string;
  required?: boolean;
  /** Stored in its own metro_reports column rather than in `details`. */
  column?: boolean;
};

export type ReportSection = {
  title: string;
  fields: readonly ReportField[];
  /** A section filled in once per person, vehicle or firearm; `key` names its rows. */
  key?: string;
  repeat?: { noun: string; min: number; max: number; letters?: boolean };
};

export type PoliceReportType = {
  id: string;
  label: string;
  /** One line telling the officer what the report covers. */
  summary: string;
  /** Matched against the incident type, category and description (retired types). */
  match: RegExp;
  sections: readonly ReportSection[];
  /** The DMPS forms in this report. */
  forms?: readonly PoliceReportForm[];
};

const FORMS_BY_ID = new Map(POLICE_REPORT_FORMS.map((f) => [f.id, f]));
const LEGACY_BY_ID = new Map(LEGACY_REPORT_TYPES.map((t) => [t.id, t]));

/** "arrest+tow" (or "arrest tow", as a URL reads it) → the forms, in the department's order; unknown ids are dropped. */
export function formIdsOf(reportType: string | null | undefined): string[] {
  const wanted = new Set((reportType ?? '').split(/[+\s,]+/).filter(Boolean));
  return POLICE_REPORT_FORMS.filter((f) => wanted.has(f.id)).map((f) => f.id);
}

/**
 * The report for a set of forms: the case report around each form's
 * sections, its field keys prefixed with the form id.
 */
export function composeReportType(formIds: readonly string[]): PoliceReportType {
  const forms = POLICE_REPORT_FORMS.filter((f) => formIds.includes(f.id));
  const formSections: ReportSection[] = forms.flatMap((form) => form.sections.map((s) => ({
    ...s,
    title: `${form.code} · ${s.title}`,
    key: s.key ? `${form.id}_${s.key}` : undefined,
    fields: s.fields.map((f) => ({ ...f, key: `${form.id}_${f.key}`, column: false })),
  })));
  return {
    id: forms.length ? forms.map((f) => f.id).join('+') : 'case',
    label: forms.length ? forms.map((f) => f.label).join(' · ') : 'Case report',
    summary: forms.length ? forms.map((f) => `${f.code} ${f.label}`).join(', ') : 'The case report, with no DMPS form.',
    match: /$^/,
    sections: [RESPONSE, ...formSections, OUTCOME, EVIDENCE, NARRATIVE],
    forms,
  };
}

/**
 * The forms a call suggests, from what the call-taker recorded: a theft or an
 * assault is an arrest, a crash or a traffic offence a crash report, and so
 * on. Anything else starts as an incident report. The officer changes them.
 */
export function suggestFormsFor(incident: {
  incident_type?: string | null;
  incident_category?: string | null;
  call_description?: string | null;
}): string[] {
  const primary = `${incident.incident_type ?? ''} ${incident.incident_category ?? ''}`.toLowerCase();
  const all = `${primary} ${incident.call_description ?? ''}`.toLowerCase();
  const has = (re: RegExp, text = primary) => re.test(text);
  if (has(/\b(dog|k9|canine)\b/, all)) return ['dog'];
  if (has(/shot|shoot|firearm|gun|discharg/)) return ['firearm'];
  if (has(/\btow|abandon|impound/)) return ['tow'];
  if (has(/accident|mva|crash|collision|traffic|dui|drunk driv|reckless|hit and run/)) return ['accident'];
  if (has(/theft|steal|stolen|robbery|burglar|break-?in|assault|gbh|hijack|rape|murder|arrest|drug|warrant|domestic/)) return ['arrest'];
  if (has(/inspection|roadworth/)) return ['vehicle'];
  return ['incident'];
}

/** The report a call starts with. */
export function reportTypeFor(incident: Parameters<typeof suggestFormsFor>[0]): PoliceReportType {
  return composeReportType(suggestFormsFor(incident));
}

/**
 * The report a filed `report_type` names: the forms it lists, or one of the
 * retired types for reports filed before the DMPS forms.
 */
export function getReportType(id: string | null | undefined): PoliceReportType {
  const legacy = id ? LEGACY_BY_ID.get(id) : undefined;
  if (legacy) return legacy;
  return composeReportType(formIdsOf(id));
}

export function getReportForm(id: string): PoliceReportForm | undefined {
  return FORMS_BY_ID.get(id);
}

/* ── Repeated sections ────────────────────────────────────────────────────── */

/** Where a repeated section keeps how many rows it has, in the answers. */
export const rowsKey = (section: ReportSection) => `rows_${section.key ?? section.title}`;

/** A row's field key: "accident_drivers" row 2, field "accident_surname" → "accident_drivers_2_surname". */
export function rowFieldKey(section: ReportSection, row: number, field: ReportField) {
  const local = section.key ? field.key.replace(new RegExp(`^${section.key.split('_')[0]}_`), '') : field.key;
  return `${section.key}_${row}_${local}`;
}

/** "Vehicle A", "Vehicle B"… or "Member 1", "Member 2"… */
export function rowLabel(section: ReportSection, row: number) {
  const r = section.repeat;
  if (!r) return section.title;
  return `${r.noun} ${r.letters ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[row - 1] ?? row : row}`;
}

/** How many rows a repeated section shows: what was saved, never fewer than its minimum. */
export function rowCount(section: ReportSection, answers: Record<string, unknown>) {
  const r = section.repeat;
  if (!r) return 1;
  const saved = Number(answers[rowsKey(section)] ?? 0);
  let highest = 0;
  for (let n = 1; n <= r.max; n++) {
    if (section.fields.some((f) => {
      const v = answers[rowFieldKey(section, n, f)];
      return v !== undefined && v !== null && v !== '';
    })) highest = n;
  }
  return Math.min(r.max, Math.max(r.min, Number.isFinite(saved) ? saved : 0, highest));
}

/** Every field of a section as the form shows it: once, or once per row. */
export function sectionFields(section: ReportSection, answers: Record<string, unknown>): Array<{ key: string; field: ReportField; row: number | null }> {
  if (!section.repeat) return section.fields.map((field) => ({ key: field.key, field, row: null }));
  const out: Array<{ key: string; field: ReportField; row: number | null }> = [];
  for (let n = 1; n <= rowCount(section, answers); n++) {
    for (const field of section.fields) out.push({ key: rowFieldKey(section, n, field), field, row: n });
  }
  return out;
}

/* ── Answers ──────────────────────────────────────────────────────────────── */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Split the officer's answers into the whitelisted columns and the details,
 * dropping blanks. Answers are sent as strings, as the server parses.
 */
export function splitReportAnswers(type: PoliceReportType, answers: Record<string, string>) {
  const fields: Record<string, string> = {};
  const details: Record<string, string> = {};
  for (const section of type.sections) {
    for (const { key, field } of sectionFields(section, answers)) {
      const v = (answers[key] ?? '').trim();
      if (!v) continue;
      (field.column ? fields : details)[key] = v;
    }
  }
  return { fields, details };
}

/** Problems that stop the report being filed, in form order. */
export function validateReportAnswers(type: PoliceReportType, answers: Record<string, string>) {
  const problems: string[] = [];
  for (const section of type.sections) {
    for (const { key, field, row } of sectionFields(section, answers)) {
      const v = (answers[key] ?? '').trim();
      const name = row ? `${rowLabel(section, row)}: ${field.label}` : field.label;
      // A repeated row's fields are never required: a row may be left out.
      if (field.required && !row && !v) problems.push(`${name} is required.`);
      if (!v) continue;
      if (field.kind === 'number' && !/^\d+(\.\d+)?$/.test(v)) problems.push(`${name} must be a number.`);
      if (field.kind === 'date' && !DATE.test(v)) problems.push(`${name} must be a date (YYYY-MM-DD).`);
      if (field.kind === 'time' && !TIME.test(v)) problems.push(`${name} must be a time (HH:MM).`);
    }
  }
  const narrative = (answers.officer_narrative ?? '').trim();
  if (narrative && narrative.length < 20) problems.push('The narrative needs at least 20 characters.');
  return problems;
}

/** Labelled answers kept in `details`, for display (web report card, PDF). */
export function describeReportDetails(type: PoliceReportType, details: Record<string, unknown> | null | undefined) {
  const out: Array<{ label: string; value: string }> = [];
  if (!details) return out;
  const seen = new Set<string>();
  for (const section of type.sections) {
    for (const { key, field, row } of sectionFields(section, details)) {
      if (field.column || seen.has(key)) continue;
      seen.add(key);
      const v = details[key];
      if (v === undefined || v === null || v === '') continue;
      out.push({ label: row ? `${rowLabel(section, row)} · ${field.label}` : field.label, value: String(v) });
    }
  }
  return out;
}

/** "accident_drivers_2_surname" → "Accident drivers 2 surname". */
function humanise(key: string) {
  const s = key.replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** An answer worth showing: blanks, "No" defaults and zero counts are noise. */
function shownAnswer(v: unknown): string | null {
  if (v === null || v === undefined || v === '' || v === false || v === 0) return null;
  return v === true ? 'Yes' : String(v);
}

/**
 * A filed report as it is read back, section by section (a repeated section
 * once per row): every answered field from its columns or its details, then
 * any answers from a form version that no longer lists them (they still
 * belong on record). The narrative is left to the caller, which shows it on
 * its own. Used by the case file and the case PDF, so the screen and the
 * paper say the same.
 */
export function reportReadout(
  type: PoliceReportType,
  report: Record<string, unknown> & { details?: Record<string, unknown> | null },
): { sections: Array<{ title: string; items: Array<{ label: string; value: string }> }>; extra: Array<{ label: string; value: string }> } {
  const details = report.details ?? {};
  const sections = type.sections
    .filter((s) => s.title !== 'Narrative')
    .flatMap((s) => {
      if (!s.repeat) {
        return [{
          title: s.title,
          items: s.fields.flatMap((f) => {
            const v = shownAnswer(f.column ? report[f.key] : details[f.key]);
            return v ? [{ label: f.label, value: v }] : [];
          }),
        }];
      }
      return Array.from({ length: rowCount(s, details) }, (_, i) => i + 1).map((n) => ({
        title: `${s.title} — ${rowLabel(s, n)}`,
        items: s.fields.flatMap((f) => {
          const v = shownAnswer(details[rowFieldKey(s, n, f)]);
          return v ? [{ label: f.label, value: v }] : [];
        }),
      }));
    })
    .filter((s) => s.items.length > 0);
  // Answers no field of this report covers (a form version that has since
  // changed) still belong on record, under a readable name.
  const covered = new Set(type.sections.flatMap((s) => sectionFields(s, details).map((f) => f.key)));
  const extra = Object.entries(details)
    .filter(([k, v]) => !covered.has(k) && !k.startsWith('rows_') && shownAnswer(v))
    .map(([k, v]) => ({ label: humanise(k), value: String(v) }));
  return { sections, extra };
}
