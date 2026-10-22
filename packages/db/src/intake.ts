import type { IncidentSeverity } from './types.generated';
import { DESK_SILOS, suggestedDesks, type DeskSilo } from './desks.ts';
import {
  DETAIL_FIELDS, YES, clauseFields, renderClause, type IncidentDetails,
} from './intake-details.ts';

/**
 * What the call-taking screen knows about an emergency before anyone has
 * typed much: every incident type with its code, the departments it needs,
 * how serious it usually is, the words people use for it, the questions to
 * ask (each tied to a detail where it can be), the details to fill in, the
 * sentence the description starts from, and, for a crime, its SAPS category.
 * Criti's instant suggestions on the form are these rules; they need no AI,
 * cost nothing and give the same answer every time.
 *
 * Codes: V4's radio 10-codes where our type is the same thing as one of V4's
 * (10-50 PI, 10-16…), and our own for the rest. Ours carry a two-letter group
 * prefix (CR-01, TR-01, FI-01, ME-01, PO-01, DI-01) so they can't be taken
 * for a radio 10-code or a medical code (P1–P4). Migrations 0076 and 0077 put
 * them in each organisation's incident codes (Admin → Configuration), where
 * administrators can still edit them.
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

/** The groups incident types are filed under, with their group codes. */
export const INCIDENT_GROUPS: ReadonlyArray<readonly [string, string]> = [
  ['Crime', '10'], ['Traffic', '20'], ['Fire', '30'], ['Medical', '40'], ['Public Order', '50'], ['Disaster', '60'],
  ['Animals', '70'], ['Police service', '80'],
];

/** The official SAPS crime categories (SAPS annual crime statistics). */
export const SAPS_CATEGORIES: readonly string[] = [
  'Murder', 'Rape', 'Sexual assault', 'Attempted sexual offences', 'Contact sexual offences', 'Attempted murder',
  'Assault with the intent to inflict grievous bodily harm', 'Common assault', 'Common robbery',
  'Robbery with aggravating circumstances', 'Carjacking', 'Robbery at residential premises',
  'Robbery at non-residential premises', 'Robbery of cash in transit', 'Bank robbery', 'Truck hijacking',
  'Arson', 'Malicious damage to property', 'Burglary at non-residential premises', 'Burglary at residential premises',
  'Theft of motor vehicle and motorcycle', 'Theft out of or from motor vehicle', 'Stock-theft',
  'All theft not mentioned elsewhere', 'Commercial crime', 'Shoplifting',
  'Illegal possession of firearms and ammunition', 'Drug-related crime', 'Driving under the influence of alcohol or drugs',
  'Sexual offences detected as a result of police action', 'Culpable homicide', 'Public violence', 'Crimen injuria',
  'Neglect and ill-treatment of children', 'Kidnapping', 'Abduction',
];

/** A question for the caller, tied to the detail its answer fills, where there is one. */
export type Ask = { q: string; field?: string };

export type CatalogueType = {
  name: string;
  /** The code group it is filed under, as configured. */
  group: string;
  /** Its incident code: V4's 10-code, or ours. */
  code: string;
  departments: DeskSilo[];
  severity: IncidentSeverity;
  /** Someone is, or may be, hurt: EMS's questions are asked. */
  medical: boolean;
  /** What people say for it, for the search. */
  keywords: string[];
  /** What to ask the caller. */
  asks: Ask[];
  /** The questions alone (what 0076 keeps per type). */
  prompts: string[];
  /** The details to fill in, in order (intake-details.ts). */
  details: string[];
  /** The description's first sentence: the first that can be filled in is used. */
  opening: string[];
  /** Injuries ticked for the call taker when the type is chosen. */
  injuries?: string[];
  /** Injuries listed first for this type. */
  injuryHints: string[];
  /** Its SAPS crime categories: one, or the few it may be. */
  saps: string[];
  /** One of V4's own types. */
  v4?: boolean;
};

type Spec = {
  ask?: string[];
  details?: string[];
  opening?: string[];
  injuries?: string[];
  hints?: string[];
  saps?: string[];
  v4?: boolean;
};

const t = (
  group: string, code: string, name: string, departments: DeskSilo[], severity: IncidentSeverity, medical: boolean,
  keywords: string, s: Spec = {},
): CatalogueType => {
  const asks = (s.ask ?? []).map((a) => {
    const [q, field] = a.split('|');
    return field ? { q: q!, field } : { q: q! };
  });
  return {
    name, group, code, departments, severity, medical,
    keywords: keywords.split(' ').filter(Boolean),
    asks,
    prompts: asks.map((a) => a.q),
    details: s.details ?? [],
    opening: s.opening ?? [`${name}.`],
    injuries: s.injuries,
    injuryHints: s.hints ?? [],
    saps: s.saps ?? [],
    v4: s.v4,
  };
};

const SUSPECTS = ['suspectCount', 'weapons', 'suspectLooks', 'suspectVehicle', 'direction', 'suspectThere'];
const PATIENT = ['age', 'sex', 'awake', 'breathing'];
const VEHICLES = ['vehicleCount', 'vehicleTypes', 'vehiclesSeen', 'registrations', 'roadBlocked', 'trapped', 'fuelFire'];
/** Asked on every crash: what each vehicle is, and its make, model and colour. */
const WHICH_VEHICLES = ['What vehicles: car, bakkie, taxi, bus or truck?|vehicleTypes', 'Make, model and colour of each?|vehiclesSeen'];
const FIRE = ['burning', 'inside', 'spreading'];
const ASSAULTS = ['Common assault', 'Assault with the intent to inflict grievous bodily harm'];
const BURGLARIES = ['Burglary at residential premises', 'Burglary at non-residential premises'];

/** Every incident type the screen knows, by group. */
export const INCIDENT_CATALOGUE: readonly CatalogueType[] = [
  // ── Crime ──
  t('Crime', 'CR-01', 'Assault', [P], 'Medium', false, 'fight beaten attack hit punched', {
    ask: ['Is anyone hurt?|hurt', 'Is the attacker still there?|suspectThere'],
    details: ['suspectCount', 'weapons', 'suspectLooks', 'direction', 'suspectThere', 'hurt'],
    opening: ['{who} was assaulted.', 'Assault.'],
    hints: ['Head injury', 'Cuts and bruises', 'Stab wound', 'Broken bone / fracture'],
    saps: ASSAULTS,
  }),
  t('Crime', 'CR-02', 'Robbery', [P], 'High', false, 'mugged robbed stolen', {
    ask: ['Were weapons used?|weapons', 'Which way did they go?|direction'],
    details: ['taken', ...SUSPECTS, 'hurt'],
    opening: ['Robbery. {taken} taken.', 'Robbery.'],
    hints: ['Cuts and bruises', 'Head injury', 'Stab wound', 'Gunshot wound'],
    saps: ['Common robbery', 'Robbery with aggravating circumstances'],
  }),
  t('Crime', 'CR-03', 'Burglary', [P], 'Medium', false, 'break-in broke housebreaking burglar', {
    ask: ['Are the suspects still inside?|suspectThere', 'Is anyone home?|occupantsHome'],
    details: ['premises', 'occupantsHome', 'taken', 'suspectCount', 'suspectLooks', 'suspectVehicle', 'direction', 'suspectThere', 'hurt'],
    opening: ['Break-in at {premises}.', 'Break-in.'],
    saps: BURGLARIES,
  }),
  t('Crime', 'CR-04', 'Shooting / gunshot wound', [P, M], 'Critical', true, 'gun shot shots fired firearm bullet gunshot', {
    ask: ['Is the shooter still there?|suspectThere', 'Where was the person shot?', 'Is the person breathing?|breathing'],
    details: ['suspectCount', 'suspectLooks', 'suspectVehicle', 'direction', 'suspectThere', ...PATIENT],
    opening: ['{who} has been shot.', 'Shooting.'],
    injuries: ['Gunshot wound'],
    hints: ['Gunshot wound', 'Severe bleeding', 'Unconscious', 'Not breathing'],
    saps: ['Attempted murder', 'Murder'],
  }),
  t('Crime', 'CR-05', 'Stabbing', [P, M], 'Critical', true, 'knife stabbed stab blade', {
    ask: ['Is the attacker still there?|suspectThere', 'Where is the wound?', 'Is the bleeding heavy?'],
    details: ['suspectCount', 'suspectLooks', 'direction', 'suspectThere', ...PATIENT],
    opening: ['{who} has been stabbed.', 'Stabbing.'],
    injuries: ['Stab wound'],
    hints: ['Stab wound', 'Severe bleeding', 'Unconscious'],
    saps: ['Assault with the intent to inflict grievous bodily harm', 'Attempted murder'],
  }),
  t('Crime', 'CR-06', 'Armed robbery', [P], 'Critical', false, 'gun knife weapon armed hold-up robbery', {
    ask: ['How many suspects, and what weapons?|suspectCount', 'Which way did they go, and in what vehicle?|direction'],
    details: ['premises', 'taken', ...SUSPECTS, 'hurt'],
    opening: ['Armed robbery at {premises}.', 'Armed robbery.'],
    hints: ['Gunshot wound', 'Stab wound', 'Head injury'],
    saps: ['Robbery with aggravating circumstances'],
  }),
  t('Crime', 'CR-07', 'Hijacking', [P], 'Critical', false, 'car hijack hijacked carjacking vehicle', {
    ask: ['What vehicle: make, colour, registration?|vehicle', 'Which way did they go?|direction', 'Is anyone hurt?|hurt'],
    details: ['vehicle', 'suspectCount', 'weapons', 'suspectLooks', 'direction', 'hurt'],
    opening: ['Hijacking.'],
    hints: ['Gunshot wound', 'Head injury', 'Cuts and bruises'],
    saps: ['Carjacking', 'Truck hijacking'],
  }),
  t('Crime', 'CR-08', 'Cash-in-transit heist', [P], 'Critical', false, 'cit cash van heist security', {
    ask: ['How many suspects and vehicles?|suspectCount', 'Are shots being fired?'],
    details: ['suspectCount', 'weapons', 'suspectVehicle', 'direction', 'suspectThere', 'hurt'],
    opening: ['Cash-in-transit heist.'],
    hints: ['Gunshot wound', 'Severe bleeding'],
    saps: ['Robbery of cash in transit'],
  }),
  t('Crime', 'CR-09', 'Kidnapping / abduction', [P], 'Critical', false, 'kidnap kidnapped abducted taken child', {
    ask: ['Who was taken, and what do they look like?|person', 'What vehicle, and which way?|suspectVehicle'],
    details: ['person', 'suspectCount', 'suspectLooks', 'suspectVehicle', 'direction'],
    opening: ['A person has been taken.'],
    saps: ['Kidnapping', 'Abduction'],
  }),
  t('Crime', '10-16', 'Domestic violence', [P], 'High', false, 'abuse partner husband wife family violence disturbance domestic', {
    ask: ['Is the attacker still there?|suspectThere', 'Is anyone hurt?|hurt', 'Are there children in the house?'],
    details: ['suspectThere', 'weapons', 'hurt'],
    opening: ['Domestic violence.'],
    hints: ['Cuts and bruises', 'Head injury', 'Stab wound', 'Broken bone / fracture'],
    saps: ASSAULTS,
  }),
  t('Crime', 'CR-10', 'Rape / sexual assault', [P, M], 'High', true, 'rape raped sexual assault', {
    ask: ['Is the person safe now?', 'Does the person need medical help?'],
    details: ['suspectThere', 'suspectLooks', 'direction', 'age', 'sex'],
    opening: ['Sexual assault reported.'],
    injuries: ['Sexual assault'],
    saps: ['Rape', 'Sexual assault'],
  }),
  t('Crime', 'CR-11', 'Child abuse', [P, M], 'High', true, 'child abuse neglect', {
    ask: ['Is the child safe now?', 'Is the child hurt?'],
    details: ['age', 'sex'],
    opening: ['Child abuse reported.'],
    hints: ['Cuts and bruises', 'Head injury', 'Broken bone / fracture'],
    saps: ['Neglect and ill-treatment of children'],
  }),
  t('Crime', 'CR-12', 'Murder / body found', [P], 'High', false, 'body dead killed murder corpse deceased', {
    ask: ['Is anyone else in danger?', 'Has anyone touched the body?'],
    details: ['suspectThere', 'suspectLooks', 'direction'],
    opening: ['A body has been found.'],
    injuries: ['Deceased'],
    saps: ['Murder'],
  }),
  t('Crime', 'CR-13', 'Gang violence', [P], 'High', false, 'gang gangs fighting', {
    ask: ['Are weapons being used?|weapons', 'How many people?|crowd'],
    details: ['crowd', 'weapons', 'hurt'],
    opening: ['Gang violence.'],
    hints: ['Gunshot wound', 'Stab wound', 'Head injury'],
    saps: ['Public violence'],
  }),
  t('Crime', 'CR-14', 'Housebreaking in progress', [P], 'High', false, 'burglar inside now breaking in progress', {
    ask: ['Are you safe where you are?', 'How many suspects?|suspectCount'],
    details: ['premises', 'suspectCount', 'weapons', 'suspectLooks', 'suspectVehicle', 'direction'],
    opening: ['Break-in in progress at {premises}.', 'Break-in in progress.'],
    saps: BURGLARIES,
  }),
  t('Crime', 'CR-15', 'Theft of motor vehicle', [P], 'Medium', false, 'car stolen vehicle theft', {
    ask: ['Make, colour and registration?|vehicle', 'When was it last seen?|lastSeen'],
    details: ['vehicle', 'lastSeen'],
    opening: ['Vehicle stolen.'],
    saps: ['Theft of motor vehicle and motorcycle'],
  }),
  t('Crime', 'CR-16', 'Theft', [P], 'Low', false, 'stole stolen theft pickpocket', {
    ask: ['What was taken?|taken', 'Is the suspect still there?|suspectThere'],
    details: ['taken', 'suspectLooks', 'direction', 'suspectThere'],
    opening: ['Theft. {taken} taken.', 'Theft.'],
    saps: ['All theft not mentioned elsewhere'],
  }),
  t('Crime', 'CR-17', 'Shoplifting', [P], 'Low', false, 'shop store shoplifter', {
    ask: ['Is the suspect being held?'],
    details: ['taken', 'suspectLooks'],
    opening: ['Shoplifting.'],
    saps: ['Shoplifting'],
  }),
  t('Crime', 'CR-18', 'Missing person', [P], 'Medium', false, 'missing lost person child', {
    ask: ['Name, age and what they were wearing?|person', 'Where and when were they last seen?|lastSeen'],
    details: ['person', 'lastSeen'],
    opening: ['Missing person.'],
  }),
  t('Crime', '10-37', 'Suspicious Person', [P], 'Low', false, 'suspicious loitering person', {
    ask: ['What do they look like, and where are they now?|personLooks'],
    details: ['personLooks', 'direction'],
    opening: ['Suspicious person.'],
    v4: true,
  }),
  t('Crime', '10-38', 'Suspicious Vehicle', [P], 'Low', false, 'suspicious vehicle car parked', {
    ask: ['Make, colour and registration?|vehicle'],
    details: ['vehicle', 'direction'],
    opening: ['Suspicious vehicle.'],
    v4: true,
  }),
  t('Crime', 'CR-19', 'Drug dealing', [P], 'Medium', false, 'drugs dealing selling', {
    ask: ['Where exactly, and how many people?|crowd'],
    details: ['crowd', 'personLooks'],
    opening: ['Drug dealing.'],
    saps: ['Drug-related crime'],
  }),
  t('Crime', 'CR-20', 'Malicious damage to property', [P], 'Low', false, 'damage vandalism broken', {
    ask: ['What was damaged?|damage', 'Is the person still there?|suspectThere'],
    details: ['damage', 'suspectLooks', 'suspectThere'],
    opening: ['Damage to property.'],
    saps: ['Malicious damage to property'],
  }),
  t('Crime', 'CR-21', 'Trespassing', [P], 'Low', false, 'trespass trespasser', {
    ask: ['Is the person still on the property?|suspectThere'],
    details: ['premises', 'suspectLooks', 'suspectThere'],
    opening: ['Trespasser at {premises}.', 'Trespasser.'],
  }),
  t('Crime', '10-33', 'Emergency / Officer Needs Assistance', [P], 'Critical', false, 'officer needs help backup assistance emergency', {
    ask: ['Where is the officer, and what is happening?'],
    opening: ['Officer needs assistance.'],
    v4: true,
  }),
  t('Crime', '10-32', 'Armed Individual / Subject with Gun', [P], 'Critical', false, 'gun firearm armed man person weapon', {
    ask: ['What weapon, and what do they look like?|personLooks', 'Which way are they going?|direction'],
    details: ['weapons', 'personLooks', 'direction'],
    opening: ['Armed person seen.'],
    v4: true,
  }),
  t('Crime', '10-31', 'Crime in Progress', [P], 'High', false, 'crime happening now in progress', {
    ask: ['What crime is happening?|crimeType', 'How many suspects?|suspectCount'],
    details: ['crimeType', 'suspectCount', 'weapons', 'suspectLooks', 'direction'],
    opening: ['Crime in progress: {crimeType}.', 'Crime in progress.'],
    v4: true,
  }),
  t('Crime', '10-89', 'Bomb Threat', [P, F], 'Critical', false, 'bomb explosive device threat', {
    ask: ['What was said, and is there a device?|threat', 'Have people been moved away?'],
    details: ['threat'],
    opening: ['Bomb threat.'],
    v4: true,
  }),
  t('Crime', '10-90', 'Bank Alarm / Holdup', [P], 'Critical', false, 'bank alarm holdup hold-up robbery', {
    ask: ['Which bank or business?|institution', 'Are the robbers still inside?|suspectThere'],
    details: ['institution', 'suspectCount', 'weapons', 'suspectThere'],
    opening: ['Holdup at {institution}.', 'Bank alarm or holdup.'],
    hints: ['Gunshot wound'],
    saps: ['Bank robbery'],
    v4: true,
  }),
  t('Crime', '10-98', 'Prison Break', [P], 'High', false, 'prison escape escaped prisoner', {
    ask: ['How many escaped, and what do they look like?|personLooks', 'Which way did they go?|direction'],
    details: ['suspectCount', 'personLooks', 'direction'],
    opening: ['Prisoner escape.'],
    v4: true,
  }),
  t('Crime', '10-10', 'Fight / Physical Altercation', [P], 'Medium', false, 'fight fighting brawl altercation', {
    ask: ['How many people are involved?|crowd', 'Are weapons being used?|weapons', 'Is anyone hurt?|hurt'],
    details: ['crowd', 'weapons', 'hurt'],
    opening: ['Fight in progress.'],
    hints: ['Cuts and bruises', 'Head injury', 'Stab wound'],
    saps: ASSAULTS,
    v4: true,
  }),
  t('Crime', '10-14', 'Prowler Report', [P], 'Medium', false, 'prowler lurking yard', {
    ask: ['Where is the person now, and what do they look like?|personLooks'],
    details: ['personLooks', 'direction'],
    opening: ['Prowler seen.'],
    v4: true,
  }),
  t('Crime', '10-99', 'Stolen / Wanted Vehicle or Person', [P], 'Medium', false, 'stolen wanted vehicle person lookout', {
    ask: ['Description or registration?|wanted', 'Where was it seen, and which way?|direction'],
    details: ['wanted', 'direction'],
    opening: ['Stolen or wanted vehicle or person seen.'],
    v4: true,
  }),

  // ── Traffic ──
  t('Traffic', '10-50', 'Motor Vehicle Accident', [P], 'Medium', false, 'crash accident collision mva car', {
    ask: ['Is anyone hurt or trapped?|hurt', 'How many vehicles?|vehicleCount', ...WHICH_VEHICLES, 'Is the road blocked?|roadBlocked'],
    details: [...VEHICLES, 'hurt'],
    opening: ['Vehicle accident.'],
    hints: ['Head injury', 'Broken bone / fracture', 'Spinal / neck injury', 'Cuts and bruises'],
  }),
  t('Traffic', 'TR-01', 'Traffic Violation', [P], 'Low', false, 'speeding reckless driving', {
    ask: ['Registration and direction of travel?|vehicle'],
    details: ['vehicle', 'direction'],
    opening: ['Traffic violation.'],
  }),
  t('Traffic', '10-50 PI', 'Crash with injuries', [P, M], 'High', true, 'crash accident injured hurt collision', {
    ask: ['How many people are hurt?', 'Is anyone trapped?|trapped', ...WHICH_VEHICLES, 'Is there fuel leaking or fire?|fuelFire'],
    details: VEHICLES,
    opening: ['Crash with injuries.'],
    hints: ['Head injury', 'Severe bleeding', 'Broken bone / fracture', 'Spinal / neck injury', 'Trapped person'],
  }),
  t('Traffic', 'TR-02', 'Crash with people trapped', [P, F, M], 'Critical', true, 'crash trapped pinned stuck accident', {
    ask: ['How many are trapped?', 'Is there fire or leaking fuel?|fuelFire', 'Are they conscious?|awake'],
    details: [...VEHICLES, 'awake'],
    opening: ['Crash with people trapped.'],
    injuries: ['Trapped person'],
    hints: ['Trapped person', 'Head injury', 'Severe bleeding', 'Spinal / neck injury'],
  }),
  t('Traffic', 'TR-03', 'Pedestrian knocked down', [P, M], 'Critical', true, 'pedestrian knocked hit by car run over', {
    ask: ['Is the person conscious and breathing?|breathing', 'Did the driver stay?'],
    details: [...PATIENT, 'suspectVehicle'],
    opening: ['Pedestrian knocked down.'],
    hints: ['Head injury', 'Broken bone / fracture', 'Spinal / neck injury', 'Unconscious'],
  }),
  t('Traffic', 'TR-04', 'Bus or taxi crash', [P, F, M], 'Critical', true, 'bus taxi minibus crash passengers', {
    ask: ['How many passengers are hurt?', 'Is anyone trapped?|trapped'],
    details: VEHICLES,
    opening: ['Bus or taxi crash.'],
    hints: ['Head injury', 'Broken bone / fracture', 'Severe bleeding', 'Trapped person'],
  }),
  t('Traffic', '10-57', 'Hit and run', [P, M], 'High', true, 'hit run fled', {
    ask: ['Vehicle make, colour and registration?|suspectVehicle', 'Is anyone hurt?|hurt'],
    details: ['suspectVehicle', 'direction', 'hurt'],
    opening: ['Hit and run.'],
    hints: ['Head injury', 'Broken bone / fracture', 'Spinal / neck injury'],
  }),
  t('Traffic', 'TR-05', 'Truck overturned', [P, F], 'High', false, 'truck lorry overturned rollover load spill', {
    ask: ['What is it carrying?|substance', 'Is anything leaking?|fuelFire'],
    details: ['substance', 'roadBlocked', 'trapped', 'fuelFire', 'hurt'],
    opening: ['Truck overturned.'],
  }),
  t('Traffic', '10-55', 'Drunk driver', [P], 'Medium', false, 'drunk driving dui intoxicated driver', {
    ask: ['Vehicle, registration and direction?|vehicle'],
    details: ['vehicle', 'direction'],
    opening: ['Drunk driver.'],
    saps: ['Driving under the influence of alcohol or drugs'],
  }),
  t('Traffic', '10-53', 'Road blocked', [P], 'Low', false, 'blocked obstruction debris road', {
    ask: ['What is blocking the road?|obstruction'],
    details: ['obstruction'],
    opening: ['Road blocked.'],
  }),
  t('Traffic', '10-49', 'Traffic lights out', [P], 'Low', false, 'robot robots lights out signal', {
    ask: ['Which intersection?'],
    opening: ['Traffic lights out.'],
  }),
  t('Traffic', 'TR-06', 'Abandoned vehicle', [P], 'Low', false, 'abandoned car left', {
    ask: ['Is it blocking traffic?|roadBlocked'],
    details: ['vehicle', 'roadBlocked'],
    opening: ['Abandoned vehicle.'],
  }),
  t('Traffic', '10-50 PD', 'Accident (Property Damage)', [P], 'Low', false, 'accident crash damage fender bender', {
    ask: ['How many vehicles?|vehicleCount', ...WHICH_VEHICLES, 'What was damaged?|damage'],
    details: ['vehicleCount', 'vehicleTypes', 'vehiclesSeen', 'registrations', 'damage', 'roadBlocked'],
    opening: ['Accident with damage only.'],
    v4: true,
  }),
  t('Traffic', '10-50 F', 'Accident (Fatality)', [P, M], 'High', true, 'accident crash fatal dead killed', {
    ask: ['How many vehicles?|vehicleCount', ...WHICH_VEHICLES, 'Is anyone else trapped?|trapped'],
    details: VEHICLES,
    opening: ['Fatal accident.'],
    injuries: ['Deceased'],
    v4: true,
  }),
  t('Traffic', '10-80', 'Vehicular Chase', [P], 'High', false, 'chase pursuit fleeing vehicle', {
    ask: ['Vehicle and registration?|suspectVehicle', 'Which way is it going?|direction'],
    details: ['suspectVehicle', 'direction'],
    opening: ['Vehicle chase.'],
    v4: true,
  }),
  t('Traffic', '10-94', 'Illegal Street Racing', [P], 'Medium', false, 'racing street race spinning', {
    ask: ['How many vehicles?|vehicleCount'],
    details: ['vehicleCount', 'registrations'],
    opening: ['Illegal street racing.'],
    v4: true,
  }),
  t('Traffic', '10-46', 'Disabled Vehicle / Assist Motorist', [P], 'Low', false, 'broken down breakdown stuck motorist', {
    ask: ['Is the vehicle blocking traffic?|roadBlocked'],
    details: ['vehicle', 'roadBlocked'],
    opening: ['Motorist needs help.'],
    v4: true,
  }),
  t('Traffic', '10-51', 'Tow Truck / Wrecker Needed', [P], 'Low', false, 'tow truck wrecker', {
    ask: ['What vehicle?|vehicle'],
    details: ['vehicle'],
    opening: ['Tow truck needed.'],
    v4: true,
  }),
  t('Traffic', '10-93', 'Roadblock / Checkpoint Setup', [P], 'Low', false, 'roadblock checkpoint', { opening: ['Roadblock or checkpoint.'], v4: true }),
  t('Traffic', '10-92', 'Illegally Parked Vehicle', [P], 'Low', false, 'parked parking illegally', {
    ask: ['Registration?|plate'],
    details: ['plate'],
    opening: ['Illegally parked vehicle.'],
    v4: true,
  }),
  t('Traffic', '10-47', 'Road Repair Needed', [P], 'Low', false, 'pothole road repair', {
    ask: ['What is the damage?|damage'],
    details: ['damage'],
    opening: ['Road repair needed.'],
    v4: true,
  }),
  t('Traffic', '10-48', 'Traffic Sign Repair Needed', [P], 'Low', false, 'sign stop sign repair', {
    ask: ['Which sign, and what is wrong?|damage'],
    details: ['damage'],
    opening: ['Traffic sign repair needed.'],
    v4: true,
  }),
  t('Traffic', '10-58', 'Direct Traffic / Point Duty', [P], 'Low', false, 'point duty direct traffic', { opening: ['Traffic control needed.'], v4: true }),

  // ── Fire ──
  t('Fire', 'FI-01', 'Structure Fire', [F], 'High', false, 'building fire burning flames', {
    ask: ['Is anyone inside?|inside', 'Which floor, and how big is the fire?'],
    details: [...FIRE, 'hurt'],
    opening: ['{burning}', 'Building on fire.'],
    hints: ['Burns', 'Smoke inhalation', 'Trapped person'],
  }),
  t('Fire', 'FI-02', 'Veld/Wildland Fire', [F], 'Medium', false, 'veld grass bush wildfire', {
    ask: ['Is it near homes?', 'Which way is the wind blowing it?'],
    details: ['spreading'],
    opening: ['Veld fire.'],
  }),
  t('Fire', 'FI-03', 'House fire', [F], 'High', false, 'house home fire burning smoke', {
    ask: ['Is anyone still inside?|inside', 'Is the fire spreading to neighbours?|spreading'],
    details: ['inside', 'spreading', 'hurt'],
    opening: ['House on fire.'],
    hints: ['Burns', 'Smoke inhalation', 'Trapped person'],
  }),
  t('Fire', 'FI-04', 'Informal settlement fire', [F, D], 'Critical', false, 'shack shacks informal settlement fire', {
    ask: ['How many homes are burning?|homes', 'Is anyone missing or trapped?|trapped'],
    details: ['homes', 'shelter', 'trapped', 'spreading', 'hurt'],
    opening: ['Fire in an informal settlement.'],
    hints: ['Burns', 'Smoke inhalation', 'Trapped person'],
  }),
  t('Fire', 'FI-05', 'Fire with people trapped', [F, M], 'Critical', true, 'trapped inside fire people stuck', {
    ask: ['How many are trapped, and where?', 'Can they get to a window?'],
    details: FIRE,
    opening: ['Fire with people trapped.'],
    injuries: ['Trapped person'],
    hints: ['Trapped person', 'Burns', 'Smoke inhalation'],
  }),
  t('Fire', 'FI-06', 'Vehicle fire', [F], 'High', false, 'car vehicle burning truck fire', {
    ask: ['Is anyone in the vehicle?|inside', 'Is it near fuel pumps or buildings?'],
    details: ['vehicle', 'inside', 'spreading', 'hurt'],
    opening: ['Vehicle on fire.'],
    hints: ['Burns', 'Trapped person'],
  }),
  t('Fire', '10-25', 'Gas leak', [F], 'High', false, 'gas smell leak lpg cylinder hazmat', {
    ask: ['Can people leave the building?', 'Is anyone feeling ill?|hurt'],
    details: ['substance', 'hurt'],
    opening: ['Gas leak.'],
    hints: ['Breathing difficulty', 'Poisoning / overdose'],
  }),
  t('Fire', '10-25', 'Hazardous chemical spill', [F, D], 'High', false, 'chemical hazmat spill leak toxic', {
    ask: ['What is the substance, if known?|substance', 'Is anyone feeling ill?|hurt'],
    details: ['substance', 'hurt'],
    opening: ['Hazardous spill.'],
    hints: ['Breathing difficulty', 'Burns', 'Poisoning / overdose'],
  }),
  t('Fire', 'FI-07', 'Explosion', [F, P, M], 'Critical', true, 'explosion blast exploded bang', {
    ask: ['Is anyone hurt or trapped?|trapped', 'Is there still fire?'],
    details: ['trapped'],
    opening: ['Explosion.'],
    hints: ['Burns', 'Severe bleeding', 'Head injury', 'Trapped person'],
  }),
  t('Fire', 'FI-08', 'Building collapse', [F, D, M], 'Critical', true, 'collapse collapsed building wall roof', {
    ask: ['Is anyone trapped?|trapped', 'How many people were inside?'],
    details: ['trapped'],
    opening: ['Building collapse.'],
    hints: ['Trapped person', 'Head injury', 'Broken bone / fracture', 'Spinal / neck injury'],
  }),
  t('Fire', 'FI-09', 'Person trapped (rescue)', [F, M], 'Critical', true, 'trapped stuck rescue lift', {
    ask: ['Where is the person trapped?', 'Are they hurt?|hurt'],
    details: ['awake', 'breathing', 'hurt'],
    opening: ['Person trapped.'],
    injuries: ['Trapped person'],
    hints: ['Trapped person', 'Broken bone / fracture', 'Head injury'],
  }),
  t('Fire', 'FI-10', 'Electrical fire or sparking cables', [F], 'Medium', false, 'electrical sparking cable wires transformer', {
    ask: ['Is anyone near the cables?'],
    opening: ['Sparking cables or electrical fire.'],
    hints: ['Electric shock', 'Burns'],
  }),
  t('Fire', 'FI-11', 'Power lines down', [F], 'High', false, 'power lines down cable fallen electricity', {
    ask: ['Is anyone touching or near the lines?'],
    details: ['roadBlocked'],
    opening: ['Power lines down.'],
    hints: ['Electric shock', 'Burns'],
  }),
  t('Fire', '10-73', 'Smoke seen', [F], 'Medium', false, 'smoke smell burning', {
    ask: ['Where is the smoke coming from?'],
    opening: ['Smoke seen.'],
  }),
  t('Fire', 'FI-12', 'Rubbish fire', [F], 'Low', false, 'rubbish dump bin fire', {
    ask: ['Is it near buildings or cars?'],
    details: ['spreading'],
    opening: ['Rubbish on fire.'],
  }),
  t('Fire', 'FI-13', 'Animal rescue', [F], 'Low', false, 'animal dog cat stuck', {
    ask: ['What animal, and where is it stuck?|animal'],
    details: ['animal'],
    opening: ['Animal needs rescue.'],
  }),
  t('Fire', '10-70', 'Fire Alarm / Report', [F], 'High', false, 'fire alarm report building', {
    ask: ['What is burning?|burning', 'Is anyone inside?|inside'],
    details: FIRE,
    opening: ['{burning}', 'Fire reported.'],
    hints: ['Burns', 'Smoke inhalation'],
    v4: true,
  }),
  t('Fire', '10-71', 'Nature of Fire (Specify in Notes)', [F], 'Medium', false, 'fire other', {
    details: ['burning'],
    opening: ['{burning}', 'Fire.'],
    v4: true,
  }),

  // ── Medical ──
  t('Medical', 'ME-01', 'Cardiac', [M], 'Critical', true, 'heart cardiac arrest', {
    ask: ['Is the person breathing?|breathing', 'Is the person awake?|awake'],
    details: PATIENT,
    opening: ['Cardiac emergency.'],
    hints: ['Chest pain / heart attack', 'Not breathing', 'Unconscious'],
  }),
  t('Medical', 'ME-02', 'Trauma', [M], 'High', true, 'injury injured trauma hurt', {
    ask: ['Where is the person hurt?', 'Is there heavy bleeding?'],
    details: PATIENT,
    opening: ['Injured person.'],
    hints: ['Head injury', 'Severe bleeding', 'Broken bone / fracture', 'Spinal / neck injury'],
  }),
  t('Medical', 'ME-03', 'Heart attack / chest pain', [M], 'Critical', true, 'heart attack chest pain cardiac', {
    ask: ['Is the person awake and breathing?|breathing', 'Their age?|age'],
    details: PATIENT,
    opening: ['Chest pain.'],
    injuries: ['Chest pain / heart attack'],
  }),
  t('Medical', 'ME-04', 'Not breathing / choking', [M], 'Critical', true, 'not breathing choking choke airway', {
    ask: ['Is the person awake?|awake', 'What did they choke on?'],
    details: PATIENT,
    opening: ['Person not breathing or choking.'],
    hints: ['Not breathing', 'Choking', 'Unconscious'],
  }),
  t('Medical', 'ME-05', 'Unconscious person', [M], 'Critical', true, 'unconscious collapsed fainted unresponsive', {
    ask: ['Is the person breathing?|breathing'],
    details: PATIENT,
    opening: ['Unconscious person.'],
    injuries: ['Unconscious'],
  }),
  t('Medical', 'ME-06', 'Stroke', [M], 'Critical', true, 'stroke face drooping slurred weak', {
    ask: ['When did it start?', 'Is the face drooping or speech slurred?'],
    details: PATIENT,
    opening: ['Possible stroke.'],
    injuries: ['Stroke signs'],
  }),
  t('Medical', 'ME-07', 'Severe bleeding', [M], 'Critical', true, 'bleeding blood haemorrhage', {
    ask: ['Where is the bleeding from?', 'Can someone press on the wound?'],
    details: PATIENT,
    opening: ['Severe bleeding.'],
    injuries: ['Severe bleeding'],
  }),
  t('Medical', 'ME-08', 'Drowning', [M, F], 'Critical', true, 'drowning drowned pool sea water', {
    ask: ['Is the person out of the water?', 'Are they breathing?|breathing'],
    details: PATIENT,
    opening: ['Drowning.'],
    injuries: ['Drowning'],
  }),
  t('Medical', 'ME-09', 'Electrocution', [M, F], 'Critical', true, 'electrocuted electric shock', {
    ask: ['Is the person still touching the power?'],
    details: PATIENT,
    opening: ['Electric shock.'],
    injuries: ['Electric shock'],
  }),
  t('Medical', 'ME-10', 'Seizure / fits', [M], 'High', true, 'seizure fits epilepsy convulsing', {
    ask: ['Is the person still fitting?', 'Are they breathing?|breathing'],
    details: PATIENT,
    opening: ['Seizure.'],
    injuries: ['Seizure'],
  }),
  t('Medical', 'ME-11', 'Breathing difficulty / asthma', [M], 'High', true, 'breathing asthma breathless', {
    ask: ['Can the person speak?', 'Do they have a pump?'],
    details: PATIENT,
    opening: ['Breathing difficulty.'],
    injuries: ['Breathing difficulty'],
  }),
  t('Medical', 'ME-12', 'Diabetic emergency', [M], 'High', true, 'diabetic sugar insulin', {
    ask: ['Is the person awake?|awake'],
    details: PATIENT,
    opening: ['Diabetic emergency.'],
  }),
  t('Medical', 'ME-13', 'Pregnancy / labour', [M], 'High', true, 'pregnant labour baby birth contractions', {
    ask: ['How far along is she?', 'Is the baby coming now?'],
    details: ['age', 'awake'],
    opening: ['Pregnancy emergency.'],
    hints: ['Pregnancy complications'],
  }),
  t('Medical', 'ME-14', 'Overdose / poisoning', [M], 'High', true, 'overdose poison pills swallowed', {
    ask: ['What was taken, and how much?|substance', 'Is the person awake?|awake'],
    details: ['substance', ...PATIENT],
    opening: ['Overdose or poisoning.'],
    injuries: ['Poisoning / overdose'],
  }),
  t('Medical', 'ME-15', 'Allergic reaction', [M], 'High', true, 'allergy allergic swelling bee sting', {
    ask: ['Is the throat swelling or breathing hard?'],
    details: PATIENT,
    opening: ['Allergic reaction.'],
    injuries: ['Allergic reaction'],
  }),
  t('Medical', 'ME-16', 'Burns', [M, F], 'High', true, 'burn burnt burned scald', {
    ask: ['How big are the burns, and where?'],
    details: PATIENT,
    opening: ['Burns.'],
    injuries: ['Burns'],
  }),
  t('Medical', 'ME-17', 'Fall / injury', [M], 'Medium', true, 'fell fall fallen injury', {
    ask: ['From how high?', 'Can the person move?'],
    details: PATIENT,
    opening: ['Fall.'],
    hints: ['Head injury', 'Broken bone / fracture', 'Spinal / neck injury'],
  }),
  t('Medical', '10-96', 'Mental health crisis / suicide attempt', [M, P], 'High', true, 'suicide mental crisis threatening self harm psych', {
    ask: ['Is the person alone?', 'Do they have a weapon or pills?'],
    details: PATIENT,
    opening: ['Mental health crisis.'],
    injuries: ['Mental distress / suicide risk'],
  }),
  t('Medical', 'ME-18', 'Sick person', [M], 'Medium', true, 'sick ill unwell fever', {
    ask: ['What are the symptoms?', 'Their age?|age'],
    details: PATIENT,
    opening: ['Sick person.'],
  }),
  t('Medical', '10-11C', 'Dog bite / animal attack', [M], 'Medium', true, 'dog bite bitten attack vicious animal', {
    ask: ['Is the animal still there?', 'What animal?|animal'],
    details: ['animal', ...PATIENT],
    opening: ['Animal attack.'],
    injuries: ['Dog bite'],
  }),
  t('Medical', '10-52', 'Ambulance Requested', [M], 'High', true, 'ambulance paramedics medical', {
    ask: ['What is wrong with the person?', 'Is the person awake and breathing?|breathing'],
    details: PATIENT,
    opening: ['Ambulance needed.'],
    v4: true,
  }),
  t('Medical', '10-56', 'Intoxicated Individual (Pedestrian)', [P], 'Low', false, 'drunk intoxicated pedestrian person', {
    ask: ['Is the person hurt?|hurt', 'Is the person in the road?'],
    details: ['personLooks', 'hurt'],
    opening: ['Intoxicated person.'],
    v4: true,
  }),
  t('Medical', '10-79', 'Coroner / Mortuary Van Needed', [P], 'Medium', false, 'mortuary van coroner deceased body', {
    ask: ['Has the death been confirmed?'],
    opening: ['Mortuary van needed.'],
    v4: true,
  }),

  // ── Public Order ──
  t('Public Order', 'PO-01', 'Protest', [P], 'Medium', false, 'protest march strike', {
    ask: ['How many people?|crowd', 'Is it peaceful?'],
    details: ['crowd'],
    opening: ['Protest.'],
  }),
  t('Public Order', '10-34', 'Violent protest / riot', [P], 'High', false, 'riot violent protest looting civil unrest', {
    ask: ['Is anyone hurt?|hurt', 'Is property being burnt?'],
    details: ['crowd', 'hurt'],
    opening: ['Violent protest.'],
    hints: ['Cuts and bruises', 'Head injury', 'Gunshot wound'],
    saps: ['Public violence'],
  }),
  t('Public Order', 'PO-02', 'Road barricaded / burning tyres', [P, F], 'High', false, 'barricade tyres burning road blocked', {
    ask: ['Which road, and where exactly?'],
    details: ['crowd', 'roadBlocked'],
    opening: ['Road barricaded.'],
    saps: ['Public violence'],
  }),
  t('Public Order', 'PO-03', 'Public violence', [P], 'High', false, 'violence fighting crowd', {
    ask: ['How many people, and any weapons?|crowd'],
    details: ['crowd', 'weapons', 'hurt'],
    opening: ['Public violence.'],
    hints: ['Cuts and bruises', 'Head injury', 'Gunshot wound'],
    saps: ['Public violence'],
  }),
  t('Public Order', 'PO-04', 'Illegal gathering', [P], 'Medium', false, 'gathering crowd illegal', {
    ask: ['How many people?|crowd'],
    details: ['crowd'],
    opening: ['Illegal gathering.'],
  }),
  t('Public Order', '10-15', 'Noise complaint', [P], 'Low', false, 'noise loud music party disturbance', {
    ask: ['Where exactly?'],
    opening: ['Noise complaint.'],
  }),

  // ── Disaster ──
  t('Disaster', 'DI-01', 'Flooding', [D], 'High', false, 'flood flooded water rising river', {
    ask: ['Are people trapped by the water?|trapped', 'How many homes are flooded?|homes'],
    details: ['homes', 'shelter', 'trapped'],
    opening: ['Flooding.'],
    hints: ['Trapped person', 'Drowning'],
  }),
  t('Disaster', 'DI-02', 'People trapped by flood water', [D, F, M], 'Critical', true, 'trapped flood water roof stranded', {
    ask: ['How many people, and where?'],
    details: ['homes', 'trapped'],
    opening: ['People trapped by flood water.'],
    injuries: ['Trapped person'],
    hints: ['Trapped person', 'Drowning'],
  }),
  t('Disaster', 'DI-03', 'Storm damage', [D], 'Medium', false, 'storm wind roof blown hail', {
    ask: ['Is anyone hurt?|hurt', 'How many homes are damaged?|homes'],
    details: ['homes', 'shelter', 'hurt'],
    opening: ['Storm damage.'],
    hints: ['Head injury', 'Cuts and bruises', 'Trapped person'],
  }),
  t('Disaster', 'DI-04', 'Landslide / mudslide', [D, F], 'High', false, 'landslide mudslide mud slip', {
    ask: ['Are homes or people buried?|trapped'],
    details: ['homes', 'trapped'],
    opening: ['Landslide.'],
    hints: ['Trapped person', 'Head injury'],
  }),
  t('Disaster', 'DI-05', 'Tree fallen on a home or road', [D, F], 'Medium', false, 'tree fallen fell branch', {
    ask: ['Is anyone trapped or hurt?|trapped'],
    details: ['roadBlocked', 'trapped', 'hurt'],
    opening: ['Tree fallen.'],
    hints: ['Trapped person', 'Head injury'],
  }),
  t('Disaster', 'DI-06', 'Sinkhole', [D], 'Medium', false, 'sinkhole hole collapse ground', {
    ask: ['Is it near homes or the road?'],
    details: ['roadBlocked'],
    opening: ['Sinkhole.'],
  }),
  t('Disaster', 'DI-07', 'Coastal surge / high seas', [D], 'High', false, 'sea surge waves coastal tide', {
    ask: ['Are people or homes in danger?'],
    details: ['homes'],
    opening: ['Coastal surge.'],
  }),
  t('Disaster', 'DI-08', 'People displaced', [D], 'High', false, 'displaced homeless evacuated shelter', {
    ask: ['How many people need shelter?|shelter'],
    details: ['shelter', 'homes'],
    opening: ['People displaced.'],
  }),

  // ── Animals (V4) ──
  t('Animals', '10-11', 'Animal Case (General)', [P], 'Low', false, 'animal dog cat', {
    ask: ['What animal, and what is the problem?|animal'], details: ['animal'], opening: ['Animal case.'], v4: true,
  }),
  t('Animals', '10-11A', 'Pick up Animal', [P], 'Low', false, 'animal pick up collect', {
    ask: ['What animal?|animal'], details: ['animal'], opening: ['Animal to be picked up.'], v4: true,
  }),
  t('Animals', '10-11B', 'Stray Animal', [P], 'Low', false, 'stray dog loose animal', {
    ask: ['What animal?|animal'], details: ['animal'], opening: ['Stray animal.'], v4: true,
  }),
  t('Animals', '10-11D', 'Dead Animal Removal', [P], 'Low', false, 'dead animal removal', {
    ask: ['What animal?|animal'], details: ['animal'], opening: ['Dead animal to be removed.'], v4: true,
  }),
  t('Animals', '10-11E', 'Injured Animal', [P], 'Low', false, 'injured hurt animal', {
    ask: ['What animal?|animal'], details: ['animal'], opening: ['Injured animal.'], v4: true,
  }),
  t('Animals', '10-45', 'Animal Carcass in Road', [P], 'Low', false, 'carcass dead animal road', {
    ask: ['Is it blocking the road?|roadBlocked'], details: ['animal', 'roadBlocked'], opening: ['Animal carcass in the road.'], v4: true,
  }),
  t('Animals', '10-54', 'Livestock on Road', [P], 'Medium', false, 'livestock cattle cows goats road', {
    ask: ['What animals, and how many?|animal', 'Is the road blocked?|roadBlocked'], details: ['animal', 'roadBlocked'],
    opening: ['Livestock on the road.'], v4: true,
  }),

  // ── Police service (V4) ──
  t('Police service', '10-17', 'Meet Complainant', [P], 'Low', false, 'meet complainant', { opening: ['Meet the complainant.'], v4: true }),
  t('Police service', '10-21', 'Call Complainant (Telephone)', [P], 'Low', false, 'call complainant phone back', { opening: ['Call the complainant back.'], v4: true }),
  t('Police service', '10-59', 'Escort (Funeral / VIP)', [P], 'Low', false, 'escort funeral vip convoy', {
    ask: ['What escort, and which route?|escort'], details: ['escort'], opening: ['Escort needed.'], v4: true,
  }),
  t('Police service', '10-91', 'Pick up Subject / Prisoner Transport', [P], 'Low', false, 'prisoner transport pick up subject', {
    opening: ['Prisoner transport needed.'], v4: true,
  }),
  t('Police service', '10-78', 'Request Assistance (Non-Emergency)', [P], 'Low', false, 'assistance help non-emergency', {
    opening: ['Assistance requested.'], v4: true,
  }),
];

/** Types replaced by V4's own, kept so calls already on record still read. */
export const RETIRED_TYPES: readonly string[] = ['Suspicious person or vehicle'];

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

/** Injuries listed first when a type has none of its own. */
const GROUP_HINTS: Record<string, string[]> = {
  Crime: ['Cuts and bruises', 'Head injury', 'Stab wound', 'Gunshot wound'],
  Traffic: ['Head injury', 'Broken bone / fracture', 'Spinal / neck injury', 'Severe bleeding', 'Trapped person'],
  Fire: ['Burns', 'Smoke inhalation', 'Trapped person'],
  'Public Order': ['Cuts and bruises', 'Head injury', 'Gunshot wound'],
  Disaster: ['Trapped person', 'Drowning', 'Head injury', 'Cuts and bruises'],
  Animals: ['Dog bite'],
};

/* ── Looking things up ──────────────────────────────────────────── */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const BY_NAME = new Map(INCIDENT_CATALOGUE.map((c) => [norm(c.name), c]));
const INJURY_BY_NAME = new Map(INJURY_TYPES.map((x) => [norm(x.name), x]));
/** Every catalogue question, to its field: an administrator's copy of a question still links. */
const QUESTION_FIELDS = new Map<string, string>();
for (const c of INCIDENT_CATALOGUE) for (const a of c.asks) if (a.field && !QUESTION_FIELDS.has(norm(a.q))) QUESTION_FIELDS.set(norm(a.q), a.field);

export function catalogueType(name: string | null | undefined): CatalogueType | null {
  return name ? BY_NAME.get(norm(name)) ?? null : null;
}

export function injuryType(name: string | null | undefined): InjuryType | null {
  return name ? INJURY_BY_NAME.get(norm(name)) ?? null : null;
}

/** The detail a question's answer fills, if it has one. */
export function askField(typeName: string | null | undefined, question: string): string | null {
  const own = catalogueType(typeName)?.asks.find((a) => norm(a.q) === norm(question))?.field;
  return own ?? QUESTION_FIELDS.get(norm(question)) ?? null;
}

/** The injuries for a type: its own and its group's first, then the rest. */
export function injuriesFor(typeName: string | null | undefined, group?: string | null): InjuryType[] {
  const c = catalogueType(typeName);
  const hints = [...(c?.injuries ?? []), ...(c?.injuryHints ?? []), ...(GROUP_HINTS[c?.group ?? group ?? ''] ?? [])];
  const first = [...new Set(hints)].map(injuryType).filter((x): x is InjuryType => Boolean(x));
  return [...first, ...INJURY_TYPES.filter((x) => !first.includes(x))];
}

/**
 * The SAPS crime categories a call may fall under, from its type; a burglary
 * becomes residential or non-residential once the premises are known.
 */
export function sapsCategories(typeName: string | null | undefined, details: IncidentDetails = {}): string[] {
  const list = catalogueType(typeName)?.saps ?? [];
  const premises = details.premises;
  if (typeof premises === 'string' && list.includes(BURGLARIES[0]!) && list.includes(BURGLARIES[1]!)) {
    return [premises === 'A home' ? BURGLARIES[0]! : BURGLARIES[1]!];
  }
  return [...list];
}

export type TypeMeta = {
  code: string | null;
  departments: DeskSilo[];
  severity: IncidentSeverity | null;
  medical: boolean;
  keywords: string[];
  injuries: string[];
  details: string[];
};

/**
 * What a configured type means: from the catalogue by its name, else (a type
 * an administrator added) from its group, as the desks have always been
 * suggested.
 */
export function typeMeta(name: string | null | undefined, group?: string | null): TypeMeta {
  const known = catalogueType(name);
  if (known) {
    return {
      code: known.code, departments: [...known.departments], severity: known.severity, medical: known.medical,
      keywords: known.keywords, injuries: known.injuries ?? [], details: known.details,
    };
  }
  const departments = suggestedDesks({ category: group ?? null, incidentType: name ?? null });
  return { code: null, departments, severity: null, medical: departments.includes('Medical'), keywords: [], injuries: [], details: [] };
}

/**
 * Search by any word of the name, the group, the code or what people say for
 * it. Every word typed must match something; names that start with the words
 * come first.
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

export function searchInjuries(query: string, list: readonly InjuryType[] = INJURY_TYPES): InjuryType[] {
  const words = norm(query).split(' ').filter(Boolean);
  if (!words.length) return [...list];
  return list.filter((x) => {
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
  /** The type's details answered so far. */
  details?: IncidentDetails;
};

export type IntakeAdvice = {
  /** Someone is, or may be, hurt: the patient questions, the injuries and EMS triage apply. */
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

/** Whether a question already has its answer, so it is not asked again. */
function answered(typeName: string | null, q: string, details: IncidentDetails): boolean {
  const field = askField(typeName, q);
  const v = field ? details[field] : details[`q:${q}`];
  return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== '';
}

/** The suggestion for the call so far, from the type, the injuries and the triage. */
export function intakeAdvice(s: IntakeState, prompts: readonly string[] = []): IntakeAdvice {
  const meta = typeMeta(s.incidentType, s.group);
  const details = s.details ?? {};
  const injuries = s.injuries.map(injuryType).filter((x): x is InjuryType => Boolean(x));
  const hurt = !s.emsNotRequired && ((s.victims ?? 0) > 0 || injuries.length > 0 || details.hurt === YES);
  const medical = !s.emsNotRequired && (meta.medical || hurt || s.targets.includes('Medical'));

  const wanted = new Set<DeskSilo>(meta.departments);
  for (const inj of injuries) for (const d of inj.departments) wanted.add(d);
  if (hurt) wanted.add('Medical');
  const departments = DESK_SILOS.filter((d) => wanted.has(d));

  const severity = maxSeverity(meta.severity, ...injuries.map((x) => x.severity));
  const priority = medical ? topPriority(s.injuries) : null;

  const ask: string[] = [];
  for (const q of [...prompts, ...(catalogueType(s.incidentType)?.prompts ?? []), ...injuries.flatMap((x) => x.ask)]) {
    if (!ask.includes(q) && !answered(s.incidentType, q, details)) ask.push(q);
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
 * The description, built from what the call taker answered: the type's first
 * sentence, then each detail, then the injuries and who is hurt.
 * "Break-in at a home. A cellphone and a TV taken. The suspects have left."
 * Written in English, the language of the record.
 */
export function composeDescription(args: {
  incidentType?: string | null;
  details?: IncidentDetails;
  injuries: readonly string[];
  victims: number | null;
  isCallerPatient: boolean | null;
}): string {
  const c = catalogueType(args.incidentType);
  const details = args.details ?? {};
  const who = args.isCallerPatient === true ? 'the caller' : args.isCallerPatient === false ? 'a person' : '';
  const parts: string[] = [];
  const used = new Set<string>();

  const openings = c?.opening ?? (args.incidentType ? [`${args.incidentType}.`] : []);
  for (const op of openings) {
    const r = renderClause(op, details, { who });
    if (r) {
      parts.push(r);
      for (const f of clauseFields(op)) used.add(f);
      break;
    }
  }

  const injuries = args.injuries.map((x) => x.toLowerCase());
  const hurtGiven = injuries.length > 0 || (args.victims ?? 0) > 0;
  for (const id of c?.details ?? Object.keys(details)) {
    if (used.has(id) || (id === 'hurt' && hurtGiven)) continue;
    const f = DETAIL_FIELDS[id];
    const r = f ? renderClause(f.clause, details) : null;
    if (r) parts.push(r);
  }

  if (injuries.length) {
    const list = injuries.length === 1 ? injuries[0]! : `${injuries.slice(0, -1).join(', ')} and ${injuries[injuries.length - 1]}`;
    parts.push(`${list.charAt(0).toUpperCase()}${list.slice(1)}.`);
  }
  if (args.victims !== null && args.victims > 0) {
    const whoHurt = args.isCallerPatient === true ? 'including the caller' : args.isCallerPatient === false ? 'not the caller' : null;
    const count = args.victims >= 5 ? '5 or more people' : `${args.victims} ${args.victims === 1 ? 'person' : 'people'}`;
    parts.push(`${count} hurt${whoHurt ? `, ${whoHurt}` : ''}.`);
  } else if (args.isCallerPatient === true && !used.has('who')) {
    parts.push('The caller is the patient.');
  }
  return parts.join(' ');
}

/** As composeDescription, without details (kept for callers that have none). */
export const draftDescription = (args: { incidentType?: string | null; injuries: readonly string[]; victims: number | null; isCallerPatient: boolean | null }) =>
  composeDescription(args);

/** What the form already holds, so Criti's questions do not ask for it again. */
export type KnownOnForm = {
  /** People hurt, chosen or counted from the patients named. */
  victims: number | null;
  isCallerPatient: boolean | null;
  injuries: readonly string[];
  patientsNamed: number;
};

const ASKS_HOW_MANY = /\bhow many\b.*\b(people|persons?|patients?|victims?|injured|hurt|casualt(y|ies)|wounded)\b/i;
const ASKS_ANYONE_HURT = /\b(is|are|was|were)\s+(any(one|body)|someone|people|anybody)\b.*\b(hurt|injured|wounded)\b/i;
const ASKS_CALLER_PATIENT = /\b(caller|you)\b.*\b(the )?(patient|hurt|injured)\b|\bpatient\b.*\bcaller\b/i;
const ASKS_WHO_PATIENT = /\b(who|name)\b.*\bpatients?\b|\bpatients?'?s? names?\b/i;

const words = (q: string) => new Set(q.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2));

/**
 * The questions to show, without those the form already answers (how many
 * are hurt, whether anyone is, whether the caller is the patient, who the
 * patients are) and without the same question asked twice in other words.
 * The AI is told what is filled in; this makes sure.
 */
export function withoutAnswered(questions: readonly string[], known: KnownOnForm): string[] {
  const hurtKnown = known.victims !== null || known.patientsNamed > 0 || known.isCallerPatient === true;
  const out: string[] = [];
  const seen: Array<Set<string>> = [];
  for (const raw of questions) {
    const q = raw.trim();
    if (!q) continue;
    if (hurtKnown && ASKS_HOW_MANY.test(q)) continue;
    if ((hurtKnown || known.injuries.length > 0) && ASKS_ANYONE_HURT.test(q)) continue;
    if (known.isCallerPatient !== null && ASKS_CALLER_PATIENT.test(q)) continue;
    if (known.patientsNamed > 0 && ASKS_WHO_PATIENT.test(q)) continue;
    // Asked already in other words: most of the words are the same.
    const w = words(q);
    const twice = seen.some((s) => {
      let same = 0;
      for (const x of w) if (s.has(x)) same++;
      return w.size > 0 && same / Math.min(w.size, s.size) >= 0.75;
    });
    if (twice) continue;
    seen.push(w);
    out.push(q);
  }
  return out;
}
