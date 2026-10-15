/**
 * The details a call taker fills in for an incident type: what was taken,
 * the suspects, the vehicles, what is burning, the patient. Each type uses
 * the fields that suit it (intake.ts). Answers are stored as the option's
 * English value, so reports can count them and every language can show them.
 *
 * Each field also has a clause: a short sentence the description is built
 * from, once the field is answered ("A cellphone and a TV taken.").
 *
 * No dependencies, so it can be tested.
 */

export type DetailOption = { value: string; phrase: string };

type Base = { id: string; label: string; clause: string };
export type DetailField =
  | (Base & { kind: 'choice'; options: DetailOption[] })
  | (Base & { kind: 'multi'; options: DetailOption[] })
  | (Base & { kind: 'yesno'; yes: string; no: string })
  | (Base & { kind: 'text'; placeholder?: string });

/** What a call taker answered: an option, several, or a few words. */
export type IncidentDetails = Record<string, string | string[]>;

export const YES = 'Yes';
export const NO = 'No';
export const NOT_KNOWN = 'Not known';
export const YES_NO: readonly string[] = [YES, NO, NOT_KNOWN];

/** Questions that start like these are answered Yes, No or Not known; the rest (where, how many, what) in a few words. */
const YES_NO_QUESTION = /^(is|are|was|were|did|do|does|has|have|had|can|could|will|would|should)\b/i;

/** How a question not tied to a detail is answered: "Is the bleeding heavy?" Yes / No; "Where was the person shot?" in words. */
export function questionKind(question: string): 'yesno' | 'text' {
  return YES_NO_QUESTION.test(question.trim()) ? 'yesno' : 'text';
}

/** Questions not tied to a field are kept under this prefix, with the answer. */
export const QUESTION_PREFIX = 'q:';
export const MAX_TEXT = 200;

const o = (value: string, phrase: string): DetailOption => ({ value, phrase });
const choice = (id: string, label: string, options: DetailOption[], clause = `{${id}}`): DetailField =>
  ({ id, label, kind: 'choice', options, clause });
const multi = (id: string, label: string, options: DetailOption[], clause: string): DetailField =>
  ({ id, label, kind: 'multi', options, clause });
const yesno = (id: string, label: string, yes: string, no: string): DetailField =>
  ({ id, label, kind: 'yesno', yes, no, clause: `{${id}}` });
const text = (id: string, label: string, clause: string, placeholder?: string): DetailField =>
  ({ id, label, kind: 'text', clause, placeholder });

const FIELDS: DetailField[] = [
  // ── Property ──
  choice('premises', 'Where', [
    o('A home', 'a home'), o('A business', 'a business'), o('A shop', 'a shop'), o('A school', 'a school'),
    o('A place of worship', 'a place of worship'), o('Other premises', 'the premises'),
  ], 'At {premises}.'),
  yesno('occupantsHome', 'Anyone home?', 'People are at home.', 'No one is at home.'),
  multi('taken', 'What was taken', [
    o('Cellphone', 'a cellphone'), o('TV', 'a TV'), o('Laptop', 'a laptop'), o('Cash', 'cash'),
    o('Jewellery', 'jewellery'), o('Vehicle', 'a vehicle'), o('Firearm', 'a firearm'),
    o('Bag or wallet', 'a bag or wallet'), o('Other', 'other items'),
  ], '{taken} taken.'),
  text('damage', 'What was damaged', 'Damaged: {damage}.'),

  // ── Suspects ──
  choice('suspectCount', 'Suspects', [
    o('1', 'One suspect.'), o('2', 'Two suspects.'), o('3', 'Three suspects.'), o('4', 'Four suspects.'),
    o('5 or more', 'Five or more suspects.'), o(NOT_KNOWN, ''),
  ]),
  choice('weapons', 'Weapons', [
    o('None seen', 'No weapon seen.'), o('Knife', 'Armed with a knife.'), o('Firearm', 'Armed with a firearm.'),
    o('Knife and firearm', 'Armed with a knife and a firearm.'), o('Other weapon', 'Armed with another weapon.'),
    o(NOT_KNOWN, ''),
  ]),
  text('suspectLooks', 'What they look like', 'Suspects: {suspectLooks}.', 'Clothes, height, anything to know them by'),
  text('suspectVehicle', 'Their vehicle and registration', 'Vehicle: {suspectVehicle}.'),
  text('direction', 'Which way they went', 'Last seen heading {direction}.', 'For example towards the taxi rank'),
  yesno('suspectThere', 'Still there?', 'The suspects are still there.', 'The suspects have left.'),
  text('personLooks', 'What the person looks like', 'Description: {personLooks}.'),
  text('person', 'Name, age and clothing', 'Person: {person}.'),
  text('lastSeen', 'Where and when last seen', 'Last seen {lastSeen}.'),
  text('wanted', 'Description or registration', 'Wanted: {wanted}.'),
  text('crimeType', 'What crime', 'Crime: {crimeType}.'),
  text('threat', 'What was said, and any device', 'Threat: {threat}.'),
  text('institution', 'Which bank or business', 'At {institution}.'),

  // ── Anyone hurt ──
  yesno('hurt', 'Is anyone hurt?', 'Someone is hurt.', 'No one is hurt.'),

  // ── Vehicles and roads ──
  text('vehicle', 'Make, colour and registration', 'Vehicle: {vehicle}.'),
  choice('vehicleCount', 'Vehicles involved', [
    o('1', 'One vehicle involved.'), o('2', 'Two vehicles involved.'), o('3', 'Three vehicles involved.'),
    o('4', 'Four vehicles involved.'), o('5 or more', 'Five or more vehicles involved.'),
  ]),
  text('registrations', 'Registrations', 'Registrations: {registrations}.'),
  text('plate', 'Registration', 'Registration: {plate}.'),
  yesno('roadBlocked', 'Road blocked?', 'The road is blocked.', 'The road is open.'),
  text('obstruction', 'What is blocking it', 'Blocked by {obstruction}.'),
  yesno('trapped', 'Anyone trapped?', 'Someone is trapped.', 'No one is trapped.'),
  yesno('fuelFire', 'Fuel leak or fire?', 'There is a fuel leak or fire.', 'No fuel leak or fire.'),

  // ── Fire and hazards ──
  choice('burning', 'What is burning', [
    o('A house', 'A house is on fire.'), o('A building or flats', 'A building is on fire.'),
    o('A shack', 'A shack is on fire.'), o('Several shacks', 'Several shacks are on fire.'),
    o('A vehicle', 'A vehicle is on fire.'), o('Grass or bush', 'Grass or bush is on fire.'),
    o('Rubbish', 'Rubbish is on fire.'), o('Other', ''),
  ]),
  yesno('inside', 'Anyone inside?', 'People are inside.', 'No one is inside.'),
  yesno('spreading', 'Spreading?', 'The fire is spreading.', 'The fire is not spreading.'),
  text('substance', 'What substance', 'Substance: {substance}.'),

  // ── The patient ──
  text('age', 'Age', 'Aged {age}.'),
  choice('sex', 'The patient', [
    o('Man', 'The patient is a man.'), o('Woman', 'The patient is a woman.'),
    o('Boy', 'The patient is a boy.'), o('Girl', 'The patient is a girl.'),
  ]),
  yesno('awake', 'Awake?', 'The patient is awake.', 'The patient is not awake.'),
  yesno('breathing', 'Breathing?', 'The patient is breathing.', 'The patient is not breathing.'),

  // ── Homes and people ──
  choice('homes', 'Homes affected', [
    o('1', 'One home affected.'), o('2 to 5', 'Two to five homes affected.'),
    o('6 to 20', 'Six to twenty homes affected.'), o('More than 20', 'More than twenty homes affected.'),
  ]),
  choice('shelter', 'People needing shelter', [
    o('None', 'No one needs shelter.'), o('1 to 10', 'Up to ten people need shelter.'),
    o('11 to 50', 'Eleven to fifty people need shelter.'), o('More than 50', 'More than fifty people need shelter.'),
  ]),
  choice('crowd', 'How many people', [
    o('Fewer than 10', 'Fewer than ten people.'), o('10 to 50', 'Ten to fifty people.'),
    o('50 to 200', 'Fifty to two hundred people.'), o('More than 200', 'More than two hundred people.'),
  ]),

  // ── Other ──
  text('animal', 'What animal', 'Animal: {animal}.'),
  text('escort', 'What escort, and which route', 'Escort: {escort}.'),
];

export const DETAIL_FIELDS: Readonly<Record<string, DetailField>> = Object.fromEntries(FIELDS.map((f) => [f.id, f]));

export function detailField(id: string): DetailField | null {
  return DETAIL_FIELDS[id] ?? null;
}

/** The values a field takes: its options, or Yes / No / Not known. Text takes any. */
export function fieldValues(f: DetailField): readonly string[] | null {
  if (f.kind === 'choice' || f.kind === 'multi') return f.options.map((x) => x.value);
  if (f.kind === 'yesno') return YES_NO;
  return null;
}

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Only what the fields allow: a known option, several known options, or a
 * few words. Questions not tied to a field: Yes / No / Not known when they ask
 * one (questionKind), else a few words.
 * Anything else is dropped.
 */
export function cleanDetails(raw: unknown): IncidentDetails {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: IncidentDetails = {};
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    if (key.startsWith(QUESTION_PREFIX)) {
      const q = tidy(key.slice(QUESTION_PREFIX.length)).slice(0, 160);
      if (!q || typeof v !== 'string') continue;
      if (questionKind(q) === 'yesno') { if (YES_NO.includes(v)) out[`${QUESTION_PREFIX}${q}`] = v; }
      else if (tidy(v)) out[`${QUESTION_PREFIX}${q}`] = tidy(v).slice(0, MAX_TEXT);
      continue;
    }
    const f = DETAIL_FIELDS[key];
    if (!f) continue;
    if (f.kind === 'text') {
      if (typeof v === 'string' && tidy(v)) out[key] = tidy(v).slice(0, MAX_TEXT);
    } else if (f.kind === 'multi') {
      const allowed = new Set(f.options.map((x) => x.value));
      const list = (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === 'string' && allowed.has(x));
      if (list.length) out[key] = f.options.map((x) => x.value).filter((x) => list.includes(x));
    } else {
      const allowed = fieldValues(f)!;
      if (typeof v === 'string' && allowed.includes(v)) out[key] = v;
    }
  }
  return out;
}

const join = (parts: string[]) =>
  parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

/** The words a field's answer reads as in a sentence; empty when unknown. */
export function phraseOf(f: DetailField, v: string | string[] | undefined): string {
  if (v === undefined) return '';
  if (f.kind === 'text') return typeof v === 'string' ? tidy(v).replace(/[.]+$/, '') : '';
  if (f.kind === 'yesno') return v === YES ? f.yes : v === NO ? f.no : '';
  if (f.kind === 'multi') {
    const list = Array.isArray(v) ? v : [v];
    return join(f.options.filter((x) => list.includes(x.value)).map((x) => x.phrase).filter(Boolean));
  }
  return f.options.find((x) => x.value === v)?.phrase ?? '';
}

const TOKEN = /\{([a-zA-Z]+)\}/g;
const capital = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** The fields a clause names. */
export function clauseFields(clause: string): string[] {
  return [...clause.matchAll(TOKEN)].map((m) => m[1]!);
}

/**
 * A clause with its answers filled in, or null while any is unknown.
 * `extra` gives tokens that are not fields (for example {who}).
 */
export function renderClause(clause: string, details: IncidentDetails, extra: Record<string, string> = {}): string | null {
  let missing = false;
  const out = clause.replace(TOKEN, (_, id: string) => {
    if (id in extra) {
      if (!extra[id]) missing = true;
      return extra[id] ?? '';
    }
    const f = DETAIL_FIELDS[id];
    const p = f ? phraseOf(f, details[id]) : '';
    if (!p) missing = true;
    return p;
  });
  return missing ? null : capital(tidy(out));
}

/** "What was taken: Cellphone, TV", for the call page, the phone and the PDF. */
export function detailLines(details: IncidentDetails, order: readonly string[] = []): Array<{ label: string; value: string }> {
  const keys = [...order.filter((k) => k in details), ...Object.keys(details).filter((k) => !order.includes(k))];
  const lines: Array<{ label: string; value: string }> = [];
  for (const k of keys) {
    const v = details[k];
    if (v === undefined || (Array.isArray(v) && v.length === 0)) continue;
    const value = Array.isArray(v) ? v.join(', ') : v;
    if (k.startsWith(QUESTION_PREFIX)) {
      lines.push({ label: k.slice(QUESTION_PREFIX.length), value });
      continue;
    }
    const f = DETAIL_FIELDS[k];
    if (f) lines.push({ label: f.label, value });
  }
  return lines;
}
