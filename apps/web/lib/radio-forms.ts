import {
  CASE_SECTIONS, checkSections, composeReportType, formSections, getReportForm, POLICE_REPORT_FORMS, splitReportAnswers,
  type ReportField, type ReportSection,
} from '@criticom/api';
import { FIRE_REPORT_SECTIONS, fireFieldShown, fireReportPayload, fireReportProblems } from '@criticom/db/fire-report';
import { PCR_SECTIONS, pcrFieldShown, pcrPayload, pcrProblems } from '@criticom/db/pcr';
import { POST_MORTEM_SECTIONS, postMortemPayload, postMortemProblems } from '@criticom/db/post-mortem';
import type { Silo } from '@criticom/db';

/**
 * Filing by radio (migration 0075): the reports the desk files for a crew
 * that radioed it in, in one shape for the console's wizard. Each is built
 * from the same definitions the crew's phone uses, so the console asks what
 * the phone asks and the database checks both the same way.
 */

export type DeskFieldKind = ReportField['kind'] | 'datetime' | 'flag';
export type DeskField = Omit<ReportField, 'kind'> & { kind: DeskFieldKind };
export type DeskSection = Omit<ReportSection, 'fields'> & { fields: readonly DeskField[] };

export type DeskForm = {
  /** 'case', a DMPS form id, or the department's report. */
  id: string;
  code: string;
  title: string;
  tone: string;
  /** A lucide icon name, drawn by the console. */
  icon: string;
  sections: readonly DeskSection[];
  /** Is this field asked, given the other answers? */
  shown: (field: DeskField, answers: Record<string, string>) => boolean;
  /** What would stop it being filed, field by field. */
  problems: (answers: Record<string, string>) => Array<{ key: string; message: string }>;
  /** Police: may be left off the report. */
  optional?: boolean;
};

/** The department's own colour, as Admin → Departments ships it. */
export const DEPARTMENT_TONE = {
  MetroPolice: '#3b82f6', MetroFire: '#dc3545', Medical: '#10b981', EthekwiniDisaster: '#f59e0b',
} as const satisfies Partial<Record<Silo, string>>;

const always = () => true;
const flatten = (rows: Array<{ message: string; keys: string[] }>) =>
  rows.flatMap((p) => (p.keys.length ? p.keys.map((key) => ({ key, message: p.message })) : [{ key: '', message: p.message }]));

const FORM_ICON: Record<string, string> = {
  arrest: 'hand', accident: 'car', vehicle: 'wrench', firearm: 'crosshair', incident: 'alert', tow: 'truck', dog: 'paw',
};

/* ── Police: the case report and the seven DMPS forms ─────────────────── */

export const POLICE_CASE: DeskForm = {
  id: 'case', code: 'CASE', title: 'Case report', tone: '#3b82f6', icon: 'file',
  sections: CASE_SECTIONS, shown: always,
  problems: (a) => checkSections(CASE_SECTIONS, a),
};

export const POLICE_FORMS: DeskForm[] = POLICE_REPORT_FORMS.map((f) => {
  const sections = formSections(f.id);
  return {
    id: f.id, code: f.code, title: f.label, tone: f.tone, icon: FORM_ICON[f.id] ?? 'file',
    sections, shown: always, problems: (a) => checkSections(sections, a), optional: true,
  };
});

/* ── Fire, EMS and Disaster: the department's one report ──────────────── */

const fireKind = (k: string): DeskFieldKind => (k === 'select' ? 'choice' : k === 'count' || k === 'money' ? 'number' : (k as DeskFieldKind));

const FIRE: DeskForm = {
  id: 'fire', code: 'FIRE', title: 'Fire report', tone: DEPARTMENT_TONE.MetroFire, icon: 'flame',
  sections: [
    ...FIRE_REPORT_SECTIONS.map((s) => ({ key: s.id, title: s.title, fields: s.fields.map((f) => ({ ...f, kind: fireKind(f.kind) })) })),
    { key: 'photos', title: 'Photos', fields: [{ key: 'no_photo_reason', label: 'No photos? Say why', kind: 'text' as const, placeholder: 'e.g. Crew on radio only' }] },
  ],
  shown: (field, a) => {
    const def = FIRE_REPORT_SECTIONS.flatMap((s) => s.fields).find((f) => f.key === field.key);
    return def ? fireFieldShown(def, a) : true;
  },
  problems: (a) => flatten(fireReportProblems(a)),
};

/** Nobody signs over the radio: the database waives them for a report filed by radio. */
const SIGNATURES = new Set(['responder_signature_image_base64', 'doctor_signature_image_base64']);
const pcrKind = (k: string): DeskFieldKind => (k === 'select' ? 'choice' : k === 'count' ? 'number' : (k as DeskFieldKind));

const EMS: DeskForm = {
  id: 'pcr', code: 'PCR', title: 'Patient care report', tone: DEPARTMENT_TONE.Medical, icon: 'heart',
  sections: [
    ...PCR_SECTIONS.map((s) => ({ key: s.id, title: s.title, fields: s.fields.map((f) => ({ ...f, kind: pcrKind(f.kind) })) })),
    { key: 'vehicle', title: 'After the call', fields: [{ key: 'requires_cleaning', label: 'Does the ambulance require cleaning?', kind: 'yesno' as const, required: true }] },
  ],
  shown: (field, a) => {
    const def = PCR_SECTIONS.flatMap((s) => s.fields).find((f) => f.key === field.key);
    return def ? pcrFieldShown(def, a) : true;
  },
  problems: (a) => [
    ...flatten(pcrProblems(a)).filter((p) => !SIGNATURES.has(p.key)),
    ...(!(a.requires_cleaning ?? '').trim() ? [{ key: 'requires_cleaning', message: 'Say whether the ambulance requires cleaning.' }] : []),
  ],
};

const DISASTER: DeskForm = {
  id: 'post_mortem', code: 'PM', title: 'Post-mortem', tone: DEPARTMENT_TONE.EthekwiniDisaster, icon: 'storm',
  sections: POST_MORTEM_SECTIONS.map((s) => ({
    key: s.id, title: s.title,
    fields: s.fields.map((f) => ({ ...f, kind: (f.kind === 'count' ? 'number' : f.kind) as DeskFieldKind })),
  })),
  shown: always,
  problems: (a) => flatten(postMortemProblems(a)),
};

/** The reports a department files: police the case report and its forms, the others their one report. */
export function deskFormsFor(silo: Silo | string): { required: DeskForm; optional: DeskForm[] } | null {
  switch (silo) {
    case 'MetroPolice': return { required: POLICE_CASE, optional: POLICE_FORMS };
    case 'MetroFire': return { required: FIRE, optional: [] };
    case 'Medical': return { required: EMS, optional: [] };
    case 'EthekwiniDisaster': return { required: DISASTER, optional: [] };
    default: return null;
  }
}

/* ── What is sent ─────────────────────────────────────────────────────── */

export type RadioPayload =
  | { kind: 'police'; reportType: string; fields: Record<string, string>; details: Record<string, string> }
  | { kind: 'fire' | 'pcr' | 'post_mortem'; fields: Record<string, string> };

/**
 * The report as its filing function takes it, with the member who radioed
 * it in: the same payload the crew's phone builds. Null when something
 * required is missing (the console checks before; the database again).
 */
export function radioPayload(
  silo: Silo | string,
  forms: readonly string[],
  answers: Record<string, string>,
  radioedBy: string,
): { payload: RadioPayload | null; problems: string[] } {
  const set = deskFormsFor(silo);
  if (!set) return { payload: null, problems: ['This department files no report by radio.'] };
  const ticked = set.optional.filter((f) => forms.includes(f.id));
  const problems = [set.required, ...ticked].flatMap((f) => f.problems(answers).map((p) => p.message));
  if (problems.length) return { payload: null, problems: [...new Set(problems)] };

  switch (silo) {
    case 'MetroPolice': {
      const type = composeReportType(ticked.map((f) => f.id).filter((id) => getReportForm(id)));
      const { fields, details } = splitReportAnswers(type, answers);
      return { payload: { kind: 'police', reportType: type.id, fields: { ...fields, radioed_by: radioedBy }, details }, problems: [] };
    }
    case 'MetroFire': {
      const fields = fireReportPayload(answers);
      const reason = (answers.no_photo_reason ?? '').trim();
      if (reason) fields.no_photo_reason = reason;
      return { payload: { kind: 'fire', fields: { ...fields, radioed_by: radioedBy } }, problems: [] };
    }
    case 'Medical':
      return {
        payload: { kind: 'pcr', fields: { ...pcrPayload(answers, [], answers.requires_cleaning === 'Yes'), radioed_by: radioedBy } },
        problems: [],
      };
    default:
      return { payload: { kind: 'post_mortem', fields: { ...postMortemPayload(answers), radioed_by: radioedBy } }, problems: [] };
  }
}
