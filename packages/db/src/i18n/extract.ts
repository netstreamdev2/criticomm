import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { INCIDENT_CATALOGUE, INCIDENT_GROUPS, INJURY_TYPES, MED_PRIORITIES } from '../intake.ts';
import { DETAIL_FIELDS, YES_NO } from '../intake-details.ts';
import { GLOSSARY } from './glossary.ts';
import { CALL_CHANNELS, PATIENT_SEVERITIES } from '../call-facts.ts';
import { EMS_CONSUMABLES, EMS_EQUIPMENT } from '../ems-shift.ts';
import { FIRE_REPORT_SECTIONS } from '../fire-report.ts';
import { DIRECTIONS, FINE_STATUSES, FINE_VEHICLE_TYPES, ID_TYPES, NOTICE_TYPES, OBSERVATION_FIELDS, STAGE_INFO } from '../fines.ts';
import { FIRE_EQUIPMENT, FIRE_ESSENTIALS } from '../fire-shift.ts';
import { CRIME_KINDS, ZONE_KINDS } from '../map-layers.ts';
import { PCR_SECTIONS, PCR_SIGNATURES, TRIAGE } from '../pcr.ts';
import { POST_MORTEM_SECTIONS } from '../post-mortem.ts';
// The police forms live with the report rules in the api package.
import { CASE_SECTIONS, POLICE_REPORT_FORMS } from '../../../api/src/police/report-types.ts';
// The console's place search names kinds of place (Fuel station, Taxi rank).
import { PLACE_KINDS } from '../../../../apps/web/lib/places.ts';
import { keyOf, type SourceEntry } from './index.ts';

/**
 * Every sentence to translate: each t('…') and tc('context', '…') in the two
 * apps, the incident types and their questions and details, the injuries and
 * the glossary. Scripts and tests only (it reads the files): run
 * `node --experimental-strip-types scripts/i18n-extract.mjs` after changing
 * the wording, and the tests check it was.
 */

/** The folders whose wording is translated. */
export const SOURCE_DIRS = [
  'apps/web/app', 'apps/web/components', 'apps/web/lib',
  'apps/mobile/app', 'apps/mobile/components', 'apps/mobile/lib',
  // Shared rules whose words both apps show.
  'packages/api/src/schedule',
];

const STRING = String.raw`(['"])((?:\\.|(?!\1)[^\\\n])*)\1`;
/** t('…'); tx('…') for wording kept outside a screen; tNow('…') for wording made outside one (the phone's lib/translator.ts). */
const T_CALL = new RegExp(String.raw`(?<![\w$.])(?:tx?|tNow)\(\s*${STRING}`, 'g');
const TC_CALL = new RegExp(String.raw`(?<![\w$.])tc\(\s*${STRING}\s*,\s*(['"])((?:\\.|(?!\3)[^\\\n])*)\3`, 'g');
/** t(`…`) can't be read ahead of time, so it is not allowed. */
export const TEMPLATE_CALL = /(?<![\w$.])(?:t[cx]?|tNow)\(\s*`/g;

const unescape = (s: string) => s.replace(/\\(['"\\])/g, '$1').replace(/\\n/g, '\n');

function* files(dir: string): Generator<string> {
  let names: string[];
  try { names = readdirSync(dir); } catch { return; }
  for (const name of names) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* files(full);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) yield full;
  }
}

/** The data the apps show from the catalogue, translated like any sentence. */
export function catalogueStrings(): string[] {
  const out = new Set<string>();
  for (const [g] of INCIDENT_GROUPS) out.add(g);
  for (const c of INCIDENT_CATALOGUE) {
    out.add(c.name);
    for (const a of c.asks) out.add(a.q);
  }
  for (const f of Object.values(DETAIL_FIELDS)) {
    out.add(f.label);
    if (f.kind === 'choice' || f.kind === 'multi') for (const o of f.options) out.add(o.value);
    if (f.kind === 'text' && f.placeholder) out.add(f.placeholder);
  }
  for (const v of YES_NO) out.add(v);
  for (const x of INJURY_TYPES) {
    out.add(x.name);
    for (const q of x.ask) out.add(q);
  }
  for (const p of MED_PRIORITIES) out.add(p);
  for (const g of GLOSSARY) out.add(g.text);
  for (const k of Object.values(PLACE_KINDS)) out.add(k);
  // How the call came in, and a patient's own severity (0080).
  for (const c of CALL_CHANNELS) out.add(c);
  for (const p of PATIENT_SEVERITIES) out.add(p);
  return [...out];
}

/** Properties of a form's fields and sections that people read. */
const SHOWN = new Set(['label', 'title', 'summary', 'placeholder', 'hint', 'group', 'noun', 'use']);
/** Lists of keys, not words (a map zone's shapes). */
const HIDDEN = new Set(['shapes']);
const KEY_LIKE = /^[a-z][a-z0-9_]*$|^[A-Z][A-Z0-9_]*$/;

/**
 * Every shown word in a form: the properties above, the options of a
 * choice, and the labels of ['key', 'Label', 'Hint'] lists. Keys, ids and
 * icons are left out.
 */
export function formWords(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every((v) => typeof v === 'string')) {
      const list = value as string[];
      // ['key', 'Label', 'Hint?'] or a plain list of options.
      const pair = list.length <= 3 && KEY_LIKE.test(list[0]!) && list.slice(1).some((s) => /\s|[A-Z]/.test(s));
      for (const s of pair ? list.slice(1) : list) out.add(s);
    } else {
      for (const v of value) formWords(v, out);
    }
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === 'string') { if (SHOWN.has(k)) out.add(v); } else if (!HIDDEN.has(k) && typeof v === 'object') formWords(v, out);
    }
  }
  return out;
}

/** The department forms both apps show, by the file that holds them. */
export function formStrings(): Array<[text: string, where: string]> {
  const lists: Array<[unknown, string]> = [
    [FIRE_REPORT_SECTIONS, 'packages/db/src/fire-report.ts'],
    [[PCR_SECTIONS, PCR_SIGNATURES, TRIAGE], 'packages/db/src/pcr.ts'],
    [POST_MORTEM_SECTIONS, 'packages/db/src/post-mortem.ts'],
    [[FIRE_ESSENTIALS, FIRE_EQUIPMENT], 'packages/db/src/fire-shift.ts'],
    [[EMS_EQUIPMENT, EMS_CONSUMABLES], 'packages/db/src/ems-shift.ts'],
    [[NOTICE_TYPES, OBSERVATION_FIELDS, FINE_STATUSES, ID_TYPES, FINE_VEHICLE_TYPES, DIRECTIONS,
      Object.entries(STAGE_INFO).flatMap(([stage, v]) => [stage, v.means])], 'packages/db/src/fines.ts'],
    [[CRIME_KINDS, ZONE_KINDS], 'packages/db/src/map-layers.ts'],
    [POLICE_REPORT_FORMS, 'packages/api/src/police/report-forms.ts'],
    [CASE_SECTIONS, 'packages/api/src/police/report-types.ts'],
  ];
  return lists.flatMap(([value, where]) => [...formWords(value)].map((s): [string, string] => [s, where]));
}

/** Every sentence, by key, with where it is used. */
export function extractSource(root: string): { entries: SourceEntry[]; templates: string[] } {
  const map = new Map<string, SourceEntry>();
  const add = (text: string, context: string | null, where: string) => {
    // Numbers and symbols read the same in every language.
    if (!/\p{L}/u.test(text)) return;
    const key = keyOf(text, context);
    const e = map.get(key) ?? { key, text, context, where: [] };
    if (!e.where.includes(where)) e.where.push(where);
    map.set(key, e);
  };
  const templates: string[] = [];
  for (const dir of SOURCE_DIRS) {
    for (const file of files(path.join(root, dir))) {
      const rel = path.relative(root, file).split(path.sep).join('/');
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(T_CALL)) add(unescape(m[2]!), null, rel);
      for (const m of src.matchAll(TC_CALL)) add(unescape(m[4]!), unescape(m[2]!), rel);
      if (TEMPLATE_CALL.test(src)) templates.push(rel);
      TEMPLATE_CALL.lastIndex = 0;
    }
  }
  for (const s of catalogueStrings()) add(s, null, 'packages/db/src/intake.ts');
  for (const [s, where] of formStrings()) add(s, null, where);
  for (const e of map.values()) e.where.sort();
  const entries = [...map.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { entries, templates };
}
