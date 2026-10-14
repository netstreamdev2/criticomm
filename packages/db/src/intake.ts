import type { IncidentSeverity } from './types.generated';
import { DESK_SILOS, suggestedDesks, type DeskSilo } from './desks.ts';

/**
 * What the call-taking screen knows about an emergency before anyone has
 * typed much: every incident type and injury, the departments each needs, how
 * serious it usually is, the words people use for it, and the questions to ask
 * the caller. Criti's instant suggestions on the form are these rules; they
 * need no AI, cost nothing and give the same answer every time. Migration 0076
 * adds the types to each organisation's incident codes (Admin → Configuration),
 * where administrators can still edit them.
 *
 * No dependencies, so it can be tested.
 */

/** The medical codes the call taker chooses from (as the form and V4). */
export const MED_PRIORITIES = [
  'P1 - RED: Critical / Life Threatening',
  'P2 - ORANGE: Urgent / Serious',
  'P3 - YELLOW: Minor / Walking Wounded',
  'P4 - BLUE: Deceased (Mortuary)',
] as const;
export type MedPriority = (typeof MED_PRIORITIES)[number];
const [P1, P2, P3, P4] = MED_PRIORITIES;

/** Severities that may be sent to dispatch before the form is complete. */
export const EARLY_SEVERITIES: readonly IncidentSeverity[] = ['High', 'Critical'];

/** What a call sent early carries until the call taker adds it (0076, send_call_early). */
export const CALLER_NOT_GIVEN = 'Not given yet';
export const DESCRIPTION_TO_FOLLOW = 'Details to follow.';

/** Sent to dispatch before the call taker finished it, and still missing details (0076). */
export const detailsToFollow = (incident: { intake_complete?: boolean | null }) => incident.intake_complete === false;

const P: DeskSilo = 'MetroPolice';
const F: DeskSilo = 'MetroFire';
const M: DeskSilo = 'Medical';
const D: DeskSilo = 'EthekwiniDisaster';

export type CatalogueType = {
  name: string;
  /** The code group it is filed under, as configured. */
  group: string;
  departments: DeskSilo[];
  severity: IncidentSeverity;
  /** Someone is, or may be, hurt: EMS's questions are asked. */
  medical: boolean;
  /** What people say for it, for the search. */
  keywords: string[];
  /** Injuries ticked for the call taker when the type is chosen. */
  injuries?: string[];
  /** What to ask the caller. */
  prompts: string[];
};

const t = (
  group: string, name: string, departments: DeskSilo[], severity: IncidentSeverity, medical: boolean,
  keywords: string, prompts: string[] = [], injuries?: string[],
): CatalogueType => ({ name, group, departments, severity, medical, keywords: keywords.split(' ').filter(Boolean), prompts, injuries });

/** Every incident type the screen knows, by group. The first of each group's names are the original 10-codes. */
export const INCIDENT_CATALOGUE: readonly CatalogueType[] = [
  // ── Crime ──
  t('Crime', 'Assault', [P], 'Medium', false, 'fight beaten attack hit punched', ['Is anyone hurt?', 'Is the attacker still there?']),
  t('Crime', 'Robbery', [P], 'High', false, 'mugged robbed stolen', ['Were weapons used?', 'Which way did they go?']),
  t('Crime', 'Burglary', [P], 'Medium', false, 'break-in broke housebreaking burglar', ['Are the suspects still inside?', 'Is anyone home?']),
  t('Crime', 'Shooting / gunshot wound', [P, M], 'Critical', true, 'gun shot shots fired firearm bullet gunshot', ['Is the shooter still there?', 'Where was the person shot?', 'Is the person breathing?'], ['Gunshot wound']),
  t('Crime', 'Stabbing', [P, M], 'Critical', true, 'knife stabbed stab blade', ['Is the attacker still there?', 'Where is the wound?', 'Is the bleeding heavy?'], ['Stab wound']),
  t('Crime', 'Armed robbery', [P], 'Critical', false, 'gun knife weapon armed hold-up robbery', ['How many suspects, and what weapons?', 'Which way did they go, and in what vehicle?']),
  t('Crime', 'Hijacking', [P], 'Critical', false, 'car hijack hijacked carjacking vehicle', ['What vehicle: make, colour, registration?', 'Which way did they go?', 'Is anyone hurt?']),
  t('Crime', 'Cash-in-transit heist', [P], 'Critical', false, 'cit cash van heist security', ['How many suspects and vehicles?', 'Are shots being fired?']),
  t('Crime', 'Kidnapping / abduction', [P], 'Critical', false, 'kidnap kidnapped abducted taken child', ['Who was taken, and what do they look like?', 'What vehicle, and which way?']),
  t('Crime', 'Domestic violence', [P], 'High', false, 'abuse partner husband wife family violence', ['Is the attacker still there?', 'Is anyone hurt?', 'Are there children in the house?']),
  t('Crime', 'Rape / sexual assault', [P, M], 'High', true, 'rape raped sexual assault', ['Is the person safe now?', 'Does the person need medical help?'], ['Sexual assault']),
  t('Crime', 'Child abuse', [P, M], 'High', true, 'child abuse neglect', ['Is the child safe now?', 'Is the child hurt?']),
  t('Crime', 'Murder / body found', [P], 'High', false, 'body dead killed murder corpse deceased', ['Is anyone else in danger?', 'Has anyone touched the body?'], ['Deceased']),
  t('Crime', 'Gang violence', [P], 'High', false, 'gang gangs fighting', ['Are weapons being used?', 'How many people?']),
  t('Crime', 'Housebreaking in progress', [P], 'High', false, 'burglar inside now breaking in progress', ['Are you safe where you are?', 'How many suspects?']),
  t('Crime', 'Theft of motor vehicle', [P], 'Medium', false, 'car stolen vehicle theft', ['Make, colour and registration?', 'When was it last seen?']),
  t('Crime', 'Theft', [P], 'Low', false, 'stole stolen theft pickpocket', ['What was taken?', 'Is the suspect still there?']),
  t('Crime', 'Shoplifting', [P], 'Low', false, 'shop store shoplifter', ['Is the suspect being held?']),
  t('Crime', 'Missing person', [P], 'Medium', false, 'missing lost person child', ['Name, age and what they were wearing?', 'Where and when were they last seen?']),
  t('Crime', 'Suspicious person or vehicle', [P], 'Low', false, 'suspicious loitering', ['What do they look like, and where are they now?']),
  t('Crime', 'Drug dealing', [P], 'Medium', false, 'drugs dealing selling', ['Where exactly, and how many people?']),
  t('Crime', 'Malicious damage to property', [P], 'Low', false, 'damage vandalism broken', ['Is the person still there?']),
  t('Crime', 'Trespassing', [P], 'Low', false, 'trespass trespasser', ['Is the person still on the property?']),

  // ── Traffic ──
  t('Traffic', 'Motor Vehicle Accident', [P], 'Medium', false, 'crash accident collision mva car', ['Is anyone hurt or trapped?', 'How many vehicles?', 'Is the road blocked?']),
  t('Traffic', 'Traffic Violation', [P], 'Low', false, 'speeding reckless driving', ['Registration and direction of travel?']),
  t('Traffic', 'Crash with injuries', [P, M], 'High', true, 'crash accident injured hurt collision', ['How many people are hurt?', 'Is anyone trapped?', 'Is there fuel leaking or fire?']),
  t('Traffic', 'Crash with people trapped', [P, F, M], 'Critical', true, 'crash trapped pinned stuck accident', ['How many are trapped?', 'Is there fire or leaking fuel?', 'Are they conscious?'], ['Trapped person']),
  t('Traffic', 'Pedestrian knocked down', [P, M], 'Critical', true, 'pedestrian knocked hit by car run over', ['Is the person conscious and breathing?', 'Did the driver stay?']),
  t('Traffic', 'Bus or taxi crash', [P, F, M], 'Critical', true, 'bus taxi minibus crash passengers', ['How many passengers are hurt?', 'Is anyone trapped?']),
  t('Traffic', 'Hit and run', [P, M], 'High', true, 'hit run fled', ['Vehicle make, colour and registration?', 'Is anyone hurt?']),
  t('Traffic', 'Truck overturned', [P, F], 'High', false, 'truck lorry overturned rollover load spill', ['What is it carrying?', 'Is anything leaking?']),
  t('Traffic', 'Drunk driver', [P], 'Medium', false, 'drunk driving dui', ['Vehicle, registration and direction?']),
  t('Traffic', 'Road blocked', [P], 'Low', false, 'blocked obstruction debris road', ['What is blocking the road?']),
  t('Traffic', 'Traffic lights out', [P], 'Low', false, 'robot robots lights out signal', ['Which intersection?']),
  t('Traffic', 'Abandoned vehicle', [P], 'Low', false, 'abandoned car left', ['Where exactly, and is it blocking traffic?']),

  // ── Fire ──
  t('Fire', 'Structure Fire', [F], 'High', false, 'building fire burning flames', ['Is anyone inside?', 'Which floor, and how big is the fire?']),
  t('Fire', 'Veld/Wildland Fire', [F], 'Medium', false, 'veld grass bush wildfire', ['Is it near homes?', 'Which way is the wind blowing it?']),
  t('Fire', 'House fire', [F], 'High', false, 'house home fire burning smoke', ['Is anyone still inside?', 'Is the fire spreading to neighbours?']),
  t('Fire', 'Informal settlement fire', [F, D], 'Critical', false, 'shack shacks informal settlement fire', ['How many homes are burning?', 'Is anyone missing or trapped?']),
  t('Fire', 'Fire with people trapped', [F, M], 'Critical', true, 'trapped inside fire people stuck', ['How many are trapped, and where?', 'Can they get to a window?'], ['Trapped person']),
  t('Fire', 'Vehicle fire', [F], 'High', false, 'car vehicle burning truck fire', ['Is anyone in the vehicle?', 'Is it near fuel pumps or buildings?']),
  t('Fire', 'Gas leak', [F], 'High', false, 'gas smell leak lpg cylinder', ['Can people leave the building?', 'Is anyone feeling ill?']),
  t('Fire', 'Hazardous chemical spill', [F, D], 'High', false, 'chemical hazmat spill leak toxic', ['What is the substance, if known?', 'Is anyone feeling ill?']),
  t('Fire', 'Explosion', [F, P, M], 'Critical', true, 'explosion blast exploded bang', ['Is anyone hurt or trapped?', 'Is there still fire?']),
  t('Fire', 'Building collapse', [F, D, M], 'Critical', true, 'collapse collapsed building wall roof', ['Is anyone trapped?', 'How many people were inside?']),
  t('Fire', 'Person trapped (rescue)', [F, M], 'Critical', true, 'trapped stuck rescue lift', ['Where is the person trapped?', 'Are they hurt?'], ['Trapped person']),
  t('Fire', 'Electrical fire or sparking cables', [F], 'Medium', false, 'electrical sparking cable wires transformer', ['Is anyone near the cables?']),
  t('Fire', 'Power lines down', [F], 'High', false, 'power lines down cable fallen electricity', ['Is anyone touching or near the lines?']),
  t('Fire', 'Smoke seen', [F], 'Medium', false, 'smoke smell burning', ['Where is the smoke coming from?']),
  t('Fire', 'Rubbish fire', [F], 'Low', false, 'rubbish dump bin fire', ['Is it near buildings or cars?']),
  t('Fire', 'Animal rescue', [F], 'Low', false, 'animal dog cat stuck', ['What animal, and where is it stuck?']),

  // ── Medical ──
  t('Medical', 'Cardiac', [M], 'Critical', true, 'heart cardiac arrest', ['Is the person breathing?', 'Is the person awake?']),
  t('Medical', 'Trauma', [M], 'High', true, 'injury injured trauma hurt', ['Where is the person hurt?', 'Is there heavy bleeding?']),
  t('Medical', 'Heart attack / chest pain', [M], 'Critical', true, 'heart attack chest pain cardiac', ['Is the person awake and breathing?', 'Their age?'], ['Chest pain / heart attack']),
  t('Medical', 'Not breathing / choking', [M], 'Critical', true, 'not breathing choking choke airway', ['Is the person awake?', 'What did they choke on?']),
  t('Medical', 'Unconscious person', [M], 'Critical', true, 'unconscious collapsed fainted unresponsive', ['Is the person breathing?'], ['Unconscious']),
  t('Medical', 'Stroke', [M], 'Critical', true, 'stroke face drooping slurred weak', ['When did it start?', 'Is the face drooping or speech slurred?'], ['Stroke signs']),
  t('Medical', 'Severe bleeding', [M], 'Critical', true, 'bleeding blood haemorrhage', ['Where is the bleeding from?', 'Can someone press on the wound?'], ['Severe bleeding']),
  t('Medical', 'Drowning', [M, F], 'Critical', true, 'drowning drowned pool sea water', ['Is the person out of the water?', 'Are they breathing?'], ['Drowning']),
  t('Medical', 'Electrocution', [M, F], 'Critical', true, 'electrocuted electric shock', ['Is the person still touching the power?'], ['Electric shock']),
  t('Medical', 'Seizure / fits', [M], 'High', true, 'seizure fits epilepsy convulsing', ['Is the person still fitting?', 'Are they breathing?'], ['Seizure']),
  t('Medical', 'Breathing difficulty / asthma', [M], 'High', true, 'breathing asthma breathless', ['Can the person speak?', 'Do they have a pump?'], ['Breathing difficulty']),
  t('Medical', 'Diabetic emergency', [M], 'High', true, 'diabetic sugar insulin', ['Is the person awake?']),
  t('Medical', 'Pregnancy / labour', [M], 'High', true, 'pregnant labour baby birth contractions', ['How far along is she?', 'Is the baby coming now?']),
  t('Medical', 'Overdose / poisoning', [M], 'High', true, 'overdose poison pills swallowed', ['What was taken, and how much?', 'Is the person awake?'], ['Poisoning / overdose']),
  t('Medical', 'Allergic reaction', [M], 'High', true, 'allergy allergic swelling bee sting', ['Is the throat swelling or breathing hard?'], ['Allergic reaction']),
  t('Medical', 'Burns', [M, F], 'High', true, 'burn burnt burned scald', ['How big are the burns, and where?'], ['Burns']),
  t('Medical', 'Fall / injury', [M], 'Medium', true, 'fell fall fallen injury', ['From how high?', 'Can the person move?']),
  t('Medical', 'Mental health crisis / suicide attempt', [M, P], 'High', true, 'suicide mental crisis threatening self harm', ['Is the person alone?', 'Do they have a weapon or pills?'], ['Mental distress / suicide risk']),
  t('Medical', 'Sick person', [M], 'Medium', true, 'sick ill unwell fever', ['What are the symptoms?', 'Their age?']),
  t('Medical', 'Dog bite / animal attack', [M], 'Medium', true, 'dog bite bitten attack', ['Is the animal still there?'], ['Dog bite']),

  // ── Public Order ──
  t('Public Order', 'Protest', [P], 'Medium', false, 'protest march strike', ['How many people?', 'Is it peaceful?']),
  t('Public Order', 'Violent protest / riot', [P], 'High', false, 'riot violent protest looting', ['Is anyone hurt?', 'Is property being burnt?']),
  t('Public Order', 'Road barricaded / burning tyres', [P, F], 'High', false, 'barricade tyres burning road blocked', ['Which road, and where exactly?']),
  t('Public Order', 'Public violence', [P], 'High', false, 'violence fighting crowd', ['How many people, and any weapons?']),
  t('Public Order', 'Illegal gathering', [P], 'Medium', false, 'gathering crowd illegal', ['How many people?']),
  t('Public Order', 'Noise complaint', [P], 'Low', false, 'noise loud music party', ['Where exactly?']),

  // ── Disaster ──
  t('Disaster', 'Flooding', [D], 'High', false, 'flood flooded water rising river', ['Are people trapped by the water?', 'How many homes are flooded?']),
  t('Disaster', 'People trapped by flood water', [D, F, M], 'Critical', true, 'trapped flood water roof stranded', ['How many people, and where?'], ['Trapped person']),
  t('Disaster', 'Storm damage', [D], 'Medium', false, 'storm wind roof blown hail', ['Is anyone hurt?', 'How many homes are damaged?']),
  t('Disaster', 'Landslide / mudslide', [D, F], 'High', false, 'landslide mudslide mud slip', ['Are homes or people buried?']),
  t('Disaster', 'Tree fallen on a home or road', [D, F], 'Medium', false, 'tree fallen fell branch', ['Is anyone trapped or hurt?']),
  t('Disaster', 'Sinkhole', [D], 'Medium', false, 'sinkhole hole collapse ground', ['Is it near homes or the road?']),
  t('Disaster', 'Coastal surge / high seas', [D], 'High', false, 'sea surge waves coastal tide', ['Are people or homes in danger?']),
  t('Disaster', 'People displaced', [D], 'High', false, 'displaced homeless evacuated shelter', ['How many people need shelter?']),
];

export type InjuryType = {
  name: string;
  departments: DeskSilo[];
  severity: IncidentSeverity;
  priority: MedPriority;
  keywords: string[];
  ask: string[];
};

const i = (name: string, departments: DeskSilo[], severity: IncidentSeverity, priority: MedPriority, keywords: string, ask: string[] = []): InjuryType =>
  ({ name, departments, severity, priority, keywords: keywords.split(' ').filter(Boolean), ask });

/** The injuries the description lists, most serious first. */
export const INJURY_TYPES: readonly InjuryType[] = [
  i('Gunshot wound', [P, M], 'Critical', P1, 'gun shot bullet', ['Where was the person shot?']),
  i('Stab wound', [P, M], 'Critical', P1, 'knife stab stabbed', ['Where is the wound?']),
  i('Not breathing', [M], 'Critical', P1, 'breathing apnoea', ['Is anyone doing CPR?']),
  i('Unconscious', [M], 'Critical', P1, 'unconscious unresponsive collapsed', ['Is the person breathing?']),
  i('Chest pain / heart attack', [M], 'Critical', P1, 'chest heart cardiac', ['Is the person sweating or grey?']),
  i('Severe bleeding', [M], 'Critical', P1, 'bleeding blood', ['Can someone press hard on the wound?']),
  i('Stroke signs', [M], 'Critical', P1, 'stroke drooping slurred', ['When did the signs start?']),
  i('Choking', [M], 'Critical', P1, 'choking choke', ['Can the person cough or speak?']),
  i('Drowning', [M, F], 'Critical', P1, 'drowning water', ['Is the person out of the water?']),
  i('Electric shock', [M, F], 'Critical', P1, 'electric electrocuted shock', ['Is the person clear of the power?']),
  i('Trapped person', [F, M], 'Critical', P1, 'trapped pinned stuck', ['Are they conscious?']),
  i('Head injury', [M], 'High', P2, 'head skull concussion', ['Did they lose consciousness?']),
  i('Burns', [M, F], 'High', P2, 'burn burnt scald', ['How much of the body is burnt?']),
  i('Smoke inhalation', [M, F], 'High', P2, 'smoke inhaled', ['Are they coughing or short of breath?']),
  i('Breathing difficulty', [M], 'High', P2, 'breathing breathless asthma', ['Can they speak in full sentences?']),
  i('Seizure', [M], 'High', P2, 'seizure fits convulsing', ['How long has it lasted?']),
  i('Spinal / neck injury', [M], 'High', P2, 'spine spinal neck back', ['Keep them still. Can they feel their legs?']),
  i('Broken bone / fracture', [M], 'Medium', P2, 'broken bone fracture leg arm', []),
  i('Poisoning / overdose', [M], 'High', P2, 'poison overdose pills', ['What was taken?']),
  i('Allergic reaction', [M], 'High', P2, 'allergy allergic swelling', ['Is the throat swelling?']),
  i('Pregnancy complications', [M], 'High', P2, 'pregnant labour bleeding baby', ['How far along is she?']),
  i('Sexual assault', [P, M], 'High', P2, 'rape sexual', []),
  i('Mental distress / suicide risk', [M, P], 'High', P2, 'suicide mental distress', ['Is the person alone?']),
  i('Dog bite', [M], 'Medium', P3, 'dog bite bitten', []),
  i('Cuts and bruises', [M], 'Low', P3, 'cut cuts bruise scratch minor', []),
  i('Fainted', [M], 'Medium', P3, 'fainted dizzy', ['Are they awake now?']),
  i('Deceased', [P, M], 'High', P4, 'dead deceased body', ['Are there obvious signs of death?']),
];

/* ── Looking things up ──────────────────────────────────────────── */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const BY_NAME = new Map(INCIDENT_CATALOGUE.map((c) => [norm(c.name), c]));
const INJURY_BY_NAME = new Map(INJURY_TYPES.map((x) => [norm(x.name), x]));

export function catalogueType(name: string | null | undefined): CatalogueType | null {
  return name ? BY_NAME.get(norm(name)) ?? null : null;
}

export function injuryType(name: string | null | undefined): InjuryType | null {
  return name ? INJURY_BY_NAME.get(norm(name)) ?? null : null;
}

export type TypeMeta = {
  departments: DeskSilo[];
  severity: IncidentSeverity | null;
  medical: boolean;
  keywords: string[];
  injuries: string[];
};

/**
 * What a configured type means: from the catalogue by its name, else (a type
 * an administrator added) from its group, as the desks have always been
 * suggested.
 */
export function typeMeta(name: string | null | undefined, group?: string | null): TypeMeta {
  const known = catalogueType(name);
  if (known) {
    return { departments: [...known.departments], severity: known.severity, medical: known.medical, keywords: known.keywords, injuries: known.injuries ?? [] };
  }
  const departments = suggestedDesks({ category: group ?? null, incidentType: name ?? null });
  return { departments, severity: null, medical: departments.includes('Medical'), keywords: [], injuries: [] };
}

/**
 * Search by any word of the name, the group or what people say for it. Every
 * word typed must match something; names that start with the words come first.
 */
export function searchTypes<T extends { name: string; group: string; code?: string | null }>(types: readonly T[], query: string): T[] {
  const words = norm(query).split(' ').filter(Boolean);
  if (!words.length) return [...types];
  const scored: Array<[T, number]> = [];
  for (const ty of types) {
    const name = norm(ty.name);
    const hay = `${name} ${norm(ty.group)} ${norm(ty.code ?? '')} ${(catalogueType(ty.name)?.keywords ?? []).join(' ')}`;
    const tokens = hay.split(' ');
    if (!words.every((w) => tokens.some((tok) => tok.startsWith(w)))) continue;
    const score = (name.startsWith(words.join(' ')) ? 0 : name.split(' ').some((n) => n.startsWith(words[0]!)) ? 1 : 2);
    scored.push([ty, score]);
  }
  return scored.sort((a, b) => a[1] - b[1] || a[0].name.localeCompare(b[0].name)).map(([ty]) => ty);
}

export function searchInjuries(query: string): InjuryType[] {
  const words = norm(query).split(' ').filter(Boolean);
  if (!words.length) return [...INJURY_TYPES];
  return INJURY_TYPES.filter((x) => {
    const tokens = `${norm(x.name)} ${x.keywords.join(' ')}`.split(' ');
    return words.every((w) => tokens.some((tok) => tok.startsWith(w)));
  });
}

/* ── Severity ───────────────────────────────────────────────────── */

const RANK: Record<IncidentSeverity, number> = { Low: 0, Medium: 1, High: 2, Critical: 3 };

export function maxSeverity(...values: Array<IncidentSeverity | null | undefined>): IncidentSeverity | null {
  let best: IncidentSeverity | null = null;
  for (const v of values) if (v && (!best || RANK[v] > RANK[best])) best = v;
  return best;
}

const PRIORITY_RANK: Record<MedPriority, number> = { [P1]: 0, [P2]: 1, [P3]: 2, [P4]: 3 };

/** The most urgent code among the injuries (a death is P4 only when nothing else is). */
export function topPriority(injuries: readonly string[]): MedPriority | null {
  const list = injuries.map(injuryType).filter((x): x is InjuryType => Boolean(x)).map((x) => x.priority);
  if (!list.length) return null;
  const living = list.filter((p) => p !== P4);
  const pool = living.length ? living : list;
  return pool.sort((a, b) => PRIORITY_RANK[a] - PRIORITY_RANK[b])[0]!;
}

/* ── What Criti says on the form ─────────────────────────────────── */

export type IntakeState = {
  incidentType: string | null;
  group: string | null;
  injuries: readonly string[];
  /** People hurt; null when not asked yet. */
  victims: number | null;
  isCallerPatient: boolean | null;
  callerName: string;
  phoneOk: boolean;
  description: string;
  hasPin: boolean;
  region: string;
  severity: IncidentSeverity | null;
  medPriority: string;
  emsNotRequired: boolean;
  targets: readonly DeskSilo[];
};

export type IntakeAdvice = {
  /** Someone is, or may be, hurt: the patient questions and EMS triage apply. */
  medical: boolean;
  departments: DeskSilo[];
  severity: IncidentSeverity | null;
  priority: MedPriority | null;
  /** Questions for the caller, most important first. */
  ask: string[];
  /** What the form still needs before the normal Send. */
  missing: string[];
  /** Enough to send to dispatch now, before the rest is filled in. */
  canSendEarly: boolean;
  /** What is still needed to send now (empty when canSendEarly). */
  earlyMissing: string[];
};

/** The suggestion for the call so far, from the type, the injuries and the triage. */
export function intakeAdvice(s: IntakeState, prompts: readonly string[] = []): IntakeAdvice {
  const meta = typeMeta(s.incidentType, s.group);
  const injuries = s.injuries.map(injuryType).filter((x): x is InjuryType => Boolean(x));
  const hurt = !s.emsNotRequired && ((s.victims ?? 0) > 0 || injuries.length > 0);
  const medical = !s.emsNotRequired && (meta.medical || hurt || s.targets.includes('Medical'));

  const wanted = new Set<DeskSilo>(meta.departments);
  for (const inj of injuries) for (const d of inj.departments) wanted.add(d);
  if (hurt) wanted.add('Medical');
  const departments = DESK_SILOS.filter((d) => wanted.has(d));

  const severity = maxSeverity(meta.severity, ...injuries.map((x) => x.severity));
  const priority = medical ? topPriority(s.injuries) : null;

  const ask: string[] = [];
  for (const q of [...prompts, ...(catalogueType(s.incidentType)?.prompts ?? []), ...injuries.flatMap((x) => x.ask)]) {
    if (!ask.includes(q)) ask.push(q);
  }

  const missing: string[] = [];
  if (!s.incidentType) missing.push('Incident type');
  if (!s.hasPin) missing.push('Location on the map');
  if (!s.callerName.trim()) missing.push('Caller name');
  if (!s.phoneOk) missing.push('Caller number');
  if (!s.description.trim()) missing.push('Description');
  if (!s.region) missing.push('Region');
  if (!s.severity) missing.push('Severity');
  if (medical) {
    if (s.isCallerPatient === null) missing.push('Is the caller the patient?');
    if (s.victims === null) missing.push('Number of people hurt');
    if (!s.medPriority) missing.push('Medical code');
  }
  if (!s.targets.length) missing.push('Department');

  const earlyMissing: string[] = [];
  if (!s.incidentType) earlyMissing.push('Incident type');
  if (!s.hasPin) earlyMissing.push('Location on the map');
  if (!s.targets.length) earlyMissing.push('Department');
  const sev = s.severity ?? severity;
  if (!sev || !EARLY_SEVERITIES.includes(sev)) earlyMissing.push('High or Critical severity');

  return { medical, departments, severity, priority, ask: ask.slice(0, 4), missing, canSendEarly: earlyMissing.length === 0, earlyMissing };
}

/**
 * A first description from what the call taker ticked, for them to finish:
 * "Gunshot wound and severe bleeding. 1 person hurt, not the caller."
 */
export function draftDescription(args: {
  incidentType?: string | null;
  injuries: readonly string[];
  victims: number | null;
  isCallerPatient: boolean | null;
}): string {
  const parts: string[] = [];
  const injuries = args.injuries.map((x) => x.toLowerCase());
  if (injuries.length) {
    const list = injuries.length === 1 ? injuries[0]! : `${injuries.slice(0, -1).join(', ')} and ${injuries[injuries.length - 1]}`;
    parts.push(`${list.charAt(0).toUpperCase()}${list.slice(1)}.`);
  } else if (args.incidentType) {
    parts.push(`${args.incidentType}.`);
  }
  if (args.victims !== null && args.victims > 0) {
    const who = args.isCallerPatient === true ? 'including the caller' : args.isCallerPatient === false ? 'not the caller' : null;
    const count = args.victims >= 5 ? '5 or more people' : `${args.victims} ${args.victims === 1 ? 'person' : 'people'}`;
    parts.push(`${count} hurt${who ? `, ${who}` : ''}.`);
  } else if (args.isCallerPatient === true) {
    parts.push('The caller is the patient.');
  }
  return parts.join(' ');
}
