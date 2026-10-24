import type { ReportField, ReportFieldKind, ReportSection } from '@criticom/api';
import { tx } from '@criticom/db/i18n';
import { FIRE_REPORT_SECTIONS, fireFieldShown, fireReportProblems, type FireField } from '@criticom/db/fire-report';
import { PCR_SECTIONS, PCR_SIGNATURES, pcrFieldShown, pcrProblems, type PcrField } from '@criticom/db/pcr';

/**
 * The fire report and the patient report as wizard steps, with no app
 * dependencies so it can be tested. The answers keep the keys file_fire_report()
 * and file_pcr() take: the wizard only changes how they are asked. Each step
 * holds only the questions showing for the answers so far, and the checks are
 * the ones the server makes, so Done says what filing would refuse.
 */

/** A step's picture, by step key (Ionicons name). */
export type StepIcons = Record<string, string>;

type Problem = { keys: string[] };

/** The problems that sit on these steps, one per answer to mark. */
export function problemsOn(
  problems: readonly Problem[],
  steps: readonly ReportSection[],
  extraKeys: (step: ReportSection) => readonly string[] = () => [],
): Array<{ key: string }> {
  const here = new Set(steps.flatMap((s) => [...s.fields.map((f) => f.key), ...extraKeys(s)]));
  const out: Array<{ key: string }> = [];
  for (const p of problems) for (const key of p.keys) if (here.has(key)) out.push({ key });
  return out;
}

/* ── Fire (0059) ───────────────────────────────────────────────────────── */

const FIRE_KIND: Record<FireField['kind'], ReportFieldKind> = {
  text: 'text', multiline: 'multiline', select: 'choice', yesno: 'yesno', count: 'number', money: 'number',
};

export const FIRE_PHOTOS_STEP = 'photos';

/** Asked only when the incident has no photos. */
const NO_PHOTO_REASON: ReportField = {
  key: 'no_photo_reason', label: tx('Why no photos'), kind: 'text', required: true, placeholder: tx('e.g. Night, no safe vantage point'),
};

export const FIRE_STEP_ICONS: StepIcons = {
  ...Object.fromEntries(FIRE_REPORT_SECTIONS.map((s) => [s.id, s.icon])),
  [FIRE_PHOTOS_STEP]: 'camera-outline',
};

/** The fire report's steps: its sections, then Photos. */
export function fireSteps(answers: Record<string, string>, photos: number): ReportSection[] {
  const steps: ReportSection[] = FIRE_REPORT_SECTIONS.map((s) => ({
    key: s.id,
    title: s.title,
    fields: s.fields.filter((f) => fireFieldShown(f, answers)).map((f) => ({
      key: f.key, label: f.label, kind: FIRE_KIND[f.kind], options: f.options, placeholder: f.placeholder, required: f.required,
    })),
  }));
  steps.push({ key: FIRE_PHOTOS_STEP, title: tx('Photos'), fields: photos ? [] : [NO_PHOTO_REASON] });
  return steps;
}

/** What file_fire_report() would refuse, and the photo rule the screen adds. */
export function fireStepProblems(answers: Record<string, string>, photos: number): Array<{ message: string; keys: string[] }> {
  const found = fireReportProblems(answers);
  if (photos === 0 && !(answers.no_photo_reason ?? '').trim()) {
    found.push({ message: tx('Add photos on the incident, or say why there are none.'), keys: ['no_photo_reason'] });
  }
  return found;
}

/** A count is whole numbers; an amount of money may have cents. */
export function fireAnswer(key: string, value: string): string {
  const f = FIRE_REPORT_SECTIONS.flatMap((s) => s.fields).find((x) => x.key === key);
  if (f?.kind === 'count') return value.replace(/[^0-9]/g, '');
  if (f?.kind === 'money') return value.replace(/[^0-9.]/g, '');
  return value;
}

/* ── Patient care report (0063) ───────────────────────────────────────── */

const PCR_KIND: Record<Exclude<PcrField['kind'], 'flag'>, ReportFieldKind> = {
  text: 'text', multiline: 'multiline', select: 'choice', yesno: 'yesno', count: 'number', date: 'date', time: 'time',
};

export const PCR_CASUALTIES_STEP = 'casualties';
export const PCR_SIGNOFF_STEP = 'signoff';
export const PCR_SIGNATURE_KEYS = PCR_SIGNATURES.map((s) => s.key) as readonly string[];

export const PCR_STEP_ICONS: StepIcons = {
  ...Object.fromEntries(PCR_SECTIONS.map((s) => [s.id, s.icon])),
  [PCR_CASUALTIES_STEP]: 'people-circle-outline',
  [PCR_SIGNOFF_STEP]: 'create-outline',
};

/**
 * Tick boxes in a row under one heading (skin condition, the restock list)
 * are one question: tick all that apply. Each box still files as its own
 * "true" or "false". A box on its own is a Yes/No.
 */
type FlagRun = { key: string; label: string; flags: PcrField[] };

const FLAG_PREFIX = 'flags:';

function flagRuns(fields: readonly PcrField[]): FlagRun[] {
  const runs: FlagRun[] = [];
  let prev: PcrField | null = null;
  for (const f of fields) {
    if (f.kind === 'flag') {
      const current = runs[runs.length - 1];
      // The same rule as the readout: a heading, or anything else before it, starts a new run.
      if (f.group || prev?.kind !== 'flag' || !current) runs.push({ key: `${FLAG_PREFIX}${f.key}`, label: f.group ?? f.label, flags: [f] });
      else current.flags.push(f);
    }
    prev = f;
  }
  return runs;
}

const RUNS = PCR_SECTIONS.flatMap((s) => flagRuns(s.fields));
const RUN_BY_KEY = new Map(RUNS.map((r) => [r.key, r]));
const RUN_START = new Map(RUNS.map((r) => [r.flags[0]!.key, r]));
const lone = (run: FlagRun) => run.flags.length === 1 && !run.flags[0]!.group;

/** The headings the questions sit under (Primary Assessment, Neurological Assessment…). */
const PCR_HEADINGS = new Map(
  PCR_SECTIONS.flatMap((s) => s.fields).filter((f) => f.group && f.kind !== 'flag').map((f) => [f.key, f.group!] as const),
);

export function pcrHeading(key: string): string | undefined {
  return PCR_HEADINGS.get(key);
}

/** The patient report's steps: V4's sections, casualties after the crew, sign-off last. */
export function pcrSteps(answers: Record<string, string>): ReportSection[] {
  const steps: ReportSection[] = [];
  for (const s of PCR_SECTIONS) {
    const fields: ReportField[] = [];
    for (const f of s.fields) {
      if (!pcrFieldShown(f, answers)) continue;
      if (f.kind !== 'flag') {
        fields.push({ key: f.key, label: f.label, kind: PCR_KIND[f.kind], options: f.options, placeholder: f.placeholder, required: f.required });
        continue;
      }
      const run = RUN_START.get(f.key);
      if (!run) continue;
      fields.push(lone(run)
        ? { key: run.key, label: run.label, kind: 'yesno' }
        : { key: run.key, label: run.label, kind: 'multi', options: run.flags.map((x) => x.label) });
    }
    // The handover only applies when the patient is taken to hospital.
    if (fields.length) steps.push({ key: s.id, title: s.title, fields });
    if (s.id === 'crew') steps.push({ key: PCR_CASUALTIES_STEP, title: tx('Multiple Casualties?'), fields: [] });
  }
  steps.push({ key: PCR_SIGNOFF_STEP, title: tx('Sign Off & Handover'), fields: [] });
  return steps;
}

/** The answers as the wizard asks them: each run of tick boxes as one answer. */
export function pcrWizardAnswers(answers: Record<string, string>): Record<string, string> {
  const out = { ...answers };
  for (const run of RUNS) {
    if (lone(run)) {
      const v = answers[run.flags[0]!.key];
      out[run.key] = v === 'true' ? 'Yes' : v === 'false' ? 'No' : '';
    } else {
      out[run.key] = run.flags.filter((f) => answers[f.key] === 'true').map((f) => f.label).join('; ');
    }
  }
  return out;
}

/** One wizard answer back as the answers the report files: a run sets each of its boxes. */
export function pcrAnswerPatch(key: string, value: string): Record<string, string> {
  const run = RUN_BY_KEY.get(key);
  if (!run) {
    const f = PCR_SECTIONS.flatMap((s) => s.fields).find((x) => x.key === key);
    return { [key]: f?.kind === 'count' ? value.replace(/[^0-9]/g, '') : value };
  }
  if (lone(run)) return { [run.flags[0]!.key]: value === 'Yes' ? 'true' : 'false' };
  const ticked = new Set(value.split('; ').filter(Boolean));
  return Object.fromEntries(run.flags.map((f) => [f.key, ticked.has(f.label) ? 'true' : 'false']));
}

/** The answers a step holds outside its questions: the signatures on the sign-off. */
export function pcrExtraKeys(step: ReportSection): readonly string[] {
  return step.key === PCR_SIGNOFF_STEP ? PCR_SIGNATURE_KEYS : [];
}

/** What file_pcr() would refuse, on these steps. */
export function pcrStepCheck(steps: readonly ReportSection[], answers: Record<string, string>) {
  return problemsOn(pcrProblems(answers), steps, pcrExtraKeys);
}
