/**
 * Disaster Management on standby (migration 0107), as data.
 *
 * eThekwini's Disaster Management officers are not called to every incident:
 * they work a standby roster and are called out when a flood, a fire in the
 * settlements, a storm or a major accident needs them. On site they do the
 * initial and needs assessment (the NDMC's initial on-site assessment: who
 * and what is affected, homes destroyed or damaged, what people need), give
 * relief from it, and open a community hall as a shelter when people are
 * displaced. The phone and the console build their forms from these;
 * start_standby() and file_disaster_assessment() check the same things again
 * and have the final word.
 */

/** What a standby officer has ready before a call-out. */
export const STANDBY_KIT = [
  { key: 'phone', label: 'Phone charged and on loud' },
  { key: 'vest', label: 'Reflective vest' },
  { key: 'rain_gear', label: 'Raincoat and boots' },
  { key: 'torch', label: 'Torch' },
  { key: 'id_card', label: 'Work ID card' },
  { key: 'transport', label: 'Transport to get to a call-out' },
] as const;
export type StandbyKitKey = (typeof STANDBY_KIT)[number]['key'];

/** "+27 82 123 4567" or "082 123 4567", as the call centre will dial it. */
export function standbyNumber(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/[^0-9+]/g, '');
  if (/^\+27[0-9]{9}$/.test(digits)) return digits;
  if (/^0[0-9]{9}$/.test(digits)) return `+27${digits.slice(1)}`;
  if (/^27[0-9]{9}$/.test(digits)) return `+${digits}`;
  return null;
}

/** What start_standby() would refuse. */
export function standbyProblems(s: { number?: string; kit?: Partial<Record<string, boolean>> }): string[] {
  const out: string[] = [];
  if (!standbyNumber(s.number)) out.push('Enter the number the call centre can call you on.');
  const missing = STANDBY_KIT.filter((k) => typeof s.kit?.[k.key] !== 'boolean');
  if (missing.length) out.push('Answer Yes or No for every item of kit.');
  return out;
}

/** The kit items answered No, for the supervisor. */
export function kitMissing(kit: Partial<Record<string, boolean>> | null | undefined): string[] {
  return STANDBY_KIT.filter((k) => kit?.[k.key] === false).map((k) => k.label);
}

/* ── The assessment on site ────────────────────────────────────────────── */

export type AssessmentCount = { key: string; label: string };

/** People and homes: the figures the JOC, the province and relief work from. */
export const ASSESSMENT_PEOPLE: AssessmentCount[] = [
  { key: 'households_affected', label: 'Households affected' },
  { key: 'people_affected', label: 'People affected' },
  { key: 'people_displaced', label: 'People displaced (need shelter)' },
  { key: 'injured', label: 'Injured' },
  { key: 'deaths', label: 'Deaths' },
  { key: 'missing', label: 'Missing' },
];

export const ASSESSMENT_HOMES: AssessmentCount[] = [
  { key: 'homes_destroyed', label: 'Homes totally destroyed' },
  { key: 'homes_damaged', label: 'Homes partly damaged' },
];

/** Relief handed out at this place. */
export const RELIEF_ITEMS: AssessmentCount[] = [
  { key: 'blankets', label: 'Blankets' },
  { key: 'mattresses', label: 'Mattresses' },
  { key: 'food_parcels', label: 'Food parcels' },
  { key: 'hygiene_packs', label: 'Hygiene packs' },
  { key: 'hot_meals', label: 'Hot meals' },
];

export const ASSESSMENT_COUNTS: AssessmentCount[] = [...ASSESSMENT_PEOPLE, ...ASSESSMENT_HOMES];

export const HAZARDS = [
  'Flooding', 'Storm or wind', 'Fire', 'Landslide', 'Building collapse', 'Hazardous spill', 'Major accident', 'Other',
] as const;

/** What happened, from the call's type when it says; the officer may change it. */
export function hazardFor(type: string | null | undefined): (typeof HAZARDS)[number] | null {
  const t = (type ?? '').toLowerCase();
  if (/flood|drown|river|heavy rain/.test(t)) return 'Flooding';
  if (/storm|wind|tornado|hail|lightning/.test(t)) return 'Storm or wind';
  if (/landslide|mudslide|sinkhole/.test(t)) return 'Landslide';
  if (/collapse/.test(t)) return 'Building collapse';
  if (/hazmat|chemical|spill|gas leak/.test(t)) return 'Hazardous spill';
  if (/fire|burn|blaze/.test(t)) return 'Fire';
  if (/accident|collision|crash|pile-?up/.test(t)) return 'Major accident';
  return null;
}

/** Services hit at this place. */
export const SERVICES_HIT = ['Roads', 'Bridges', 'Electricity', 'Water', 'Sanitation', 'Schools', 'Clinics'] as const;

/** What people here need now. */
export const NEEDS = [
  'Food', 'Blankets', 'Mattresses', 'Hygiene packs', 'Shelter', 'Drinking water', 'Clothing',
  'School uniforms', 'Building material', 'Medical care', 'Counselling',
] as const;

/** One assessment as the officer fills it in: every value as typed. */
export type AssessmentDraft = {
  place?: string;
  ward?: string;
  hazard?: string;
  counts?: Record<string, string | undefined>;
  relief?: Record<string, string | undefined>;
  services?: string[];
  needs?: string[];
  shelter_name?: string;
  people_sheltered?: string;
  notes?: string;
  lat?: number | null;
  lng?: number | null;
  accuracy?: number | null;
};

const COUNT = /^\d{1,6}$/;
const n = (s: string | null | undefined) => {
  const t = (s ?? '').trim();
  return t === '' ? 0 : COUNT.test(t) ? Number(t) : Number.NaN;
};

/** What file_disaster_assessment() would refuse, with the fields to mark. */
export function assessmentProblems(a: AssessmentDraft): Array<{ message: string; keys: string[] }> {
  const out: Array<{ message: string; keys: string[] }> = [];
  if (!(a.place ?? '').trim()) out.push({ message: 'Say where you assessed (street, block or hall).', keys: ['place'] });
  if (!(HAZARDS as readonly string[]).includes((a.hazard ?? '').trim())) out.push({ message: 'Choose what happened.', keys: ['hazard'] });
  const bad = [...ASSESSMENT_COUNTS.map((c) => [c.key, a.counts?.[c.key]] as const), ...RELIEF_ITEMS.map((c) => [c.key, a.relief?.[c.key]] as const),
    ['people_sheltered', a.people_sheltered] as const]
    .filter(([, v]) => Number.isNaN(n(v))).map(([k]) => k);
  if (bad.length) out.push({ message: 'Counts are whole numbers.', keys: bad });
  if (n(a.people_sheltered) > 0 && !(a.shelter_name ?? '').trim()) {
    out.push({ message: 'Name the hall or shelter.', keys: ['shelter_name'] });
  }
  if ((a.notes ?? '').length > 2000) out.push({ message: 'Keep the notes under 2000 characters.', keys: ['notes'] });
  return out;
}

/** The assessment as file_disaster_assessment() takes it: whole numbers, known choices only. */
export function assessmentPayload(a: AssessmentDraft): Record<string, unknown> {
  const counts: Record<string, number> = {};
  for (const c of ASSESSMENT_COUNTS) counts[c.key] = n(a.counts?.[c.key]) || 0;
  const relief: Record<string, number> = {};
  for (const r of RELIEF_ITEMS) relief[r.key] = n(a.relief?.[r.key]) || 0;
  return {
    place: (a.place ?? '').trim(),
    ward: (a.ward ?? '').trim() || null,
    hazard: (a.hazard ?? '').trim(),
    ...counts,
    relief,
    services: (a.services ?? []).filter((s) => (SERVICES_HIT as readonly string[]).includes(s)),
    needs: (a.needs ?? []).filter((s) => (NEEDS as readonly string[]).includes(s)),
    shelter_name: (a.shelter_name ?? '').trim() || null,
    people_sheltered: n(a.people_sheltered) || 0,
    notes: (a.notes ?? '').trim() || null,
    lat: typeof a.lat === 'number' ? a.lat : null,
    lng: typeof a.lng === 'number' ? a.lng : null,
    accuracy: typeof a.accuracy === 'number' ? Math.round(a.accuracy) : null,
  };
}

type FiledAssessment = Record<string, unknown> & { relief?: Record<string, number> | null; people_sheltered?: number | null };

/** A call's figures: every place assessed, added up. */
export function assessmentTotals(rows: readonly FiledAssessment[]) {
  const totals: Record<string, number> = { places: rows.length, people_sheltered: 0 };
  for (const c of ASSESSMENT_COUNTS) totals[c.key] = 0;
  for (const r of RELIEF_ITEMS) totals[r.key] = 0;
  for (const row of rows) {
    for (const c of ASSESSMENT_COUNTS) totals[c.key] = (totals[c.key] ?? 0) + (Number(row[c.key]) || 0);
    for (const r of RELIEF_ITEMS) totals[r.key] = (totals[r.key] ?? 0) + (Number(row.relief?.[r.key]) || 0);
    totals.people_sheltered = (totals.people_sheltered ?? 0) + (Number(row.people_sheltered) || 0);
  }
  return totals;
}
