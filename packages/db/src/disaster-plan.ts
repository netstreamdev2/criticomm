/**
 * The Disaster desk’s lists, as data. The levels, roles and the top ten
 * risks follow the Directorate’s current process (Disaster incident
 * management, revision 2, October 2026: the JOC, the IDP 2026/27 and the
 * Director’s December 2025 briefing); the rest is the eThekwini Municipal
 * Disaster Management Plan (rev. 7 Aug 2012). The database (0112, 0115)
 * checks the same lists; keep them in step.
 */

/** The eThekwini emergency number, on every Disaster screen. */
export const EMERGENCY_NUMBER = '031 361 0000';

/** eThekwini's top ten priority risks (IDP 2026/27), in rank order. */
export const PRIORITY_RISKS = [
  'Civil unrest and crime',
  'Severe storms',
  'Floods',
  'Human disease',
  'Fires in formal and informal settlements',
  'Critical infrastructure failure (water, electricity)',
  'Hazardous materials fire or explosion (storage)',
  'Storm surge',
  'Hazardous materials spill or release (transport)',
  'Landslides',
] as const;
export type PriorityRisk = (typeof PRIORITY_RISKS)[number];

/**
 * The 2012 Plan's Classification of Potential Hazards (pp. 7–8), less the
 * hazards a top ten risk now names, with the top ten first.
 */
export const HAZARD_GROUPS: Array<{ group: string; hazards: string[] }> = [
  { group: 'Top ten priority risks', hazards: [...PRIORITY_RISKS] },
  { group: 'Natural: meteorological', hazards: ['Cyclone, hurricane or tornado', 'Wildfire', 'Extreme temperature', 'Drought'] },
  { group: 'Natural: geological', hazards: ['Earthquake', 'Erosion', 'Tsunami', 'Major sinkhole'] },
  { group: 'Natural: biological', hazards: ['Animal disease', 'Insect or vermin plague', 'Food and crop disease', 'Emerging catastrophic disease'] },
  { group: 'Non-natural: human caused', hazards: ['Terrorist attack', 'Arson', 'Sabotage of essential services', 'Shooting or massacre', 'IT virus or systems compromise'] },
  { group: 'Non-natural: technological', hazards: ['Structural collapse', 'Industrial accident', 'Major transport accident', 'Nuclear power accident', 'Dam failure', 'Aeronautical or space'] },
  { group: 'Other', hazards: ['Other'] },
];
export const HAZARDS: string[] = HAZARD_GROUPS.flatMap((g) => g.hazards);

/**
 * The 2012 names a top ten risk replaced (0115 renamed them on open calls).
 * Older records keep them; they still count towards their risk.
 * "Hazardous materials accident" is not here: the top ten splits it into
 * storage and transport, so it stays as it was.
 */
export const EARLIER_HAZARD: Record<string, PriorityRisk> = {
  Flood: 'Floods',
  'Severe storm': 'Severe storms',
  'Storm tide': 'Storm surge',
  'Landslip or debris flow': 'Landslides',
  'Epidemic human disease': 'Human disease',
  'Civil disturbance or riot': 'Civil unrest and crime',
  'Structure or informal settlement fire': 'Fires in formal and informal settlements',
  'Failure of critical infrastructure or services': 'Critical infrastructure failure (water, electricity)',
};

export const hazardGroup = (hazard: string | null | undefined) =>
  HAZARD_GROUPS.find((g) => g.hazards.includes(hazard ?? ''))?.group
  ?? (hazard && (hazard in EARLIER_HAZARD || hazard === 'Hazardous materials accident') ? 'Earlier names (2012 plan)' : null);

/** The top ten risk an incident counts towards, if any (for the IDP figures). */
export function priorityRisk(hazard: string | null | undefined): PriorityRisk | null {
  if (!hazard) return null;
  if ((PRIORITY_RISKS as readonly string[]).includes(hazard)) return hazard as PriorityRisk;
  return EARLIER_HAZARD[hazard] ?? null;
}

/** The municipalities a disaster can affect: eThekwini and KwaZulu-Natal's districts. */
export const MUNICIPALITIES = ['eThekwini Metro', 'Amajuba', 'Harry Gwala', 'iLembe', 'King Cetshwayo', 'Ugu', 'uMgungundlovu',
  'uMkhanyakude', 'uMzinyathi', 'uThukela', 'Zululand'] as const;

/**
 * Levels of coordination (revision 2, section 1). At Gold the Joint
 * Operations Centre (JOC) sits at the Disaster Operations Centre (DOC), the
 * facility at the Disaster Management Centre.
 */
export type CoordinationLevel = 'Bronze' | 'Silver' | 'Gold';
export const LEVELS: Array<{ level: CoordinationLevel; name: string; title: string; means: string }> = [
  { level: 'Bronze', name: 'Bronze (tactical)', title: 'Bronze: tactical coordination', means: 'Services on scene coordinate through a Forward Control Point (FCP).' },
  { level: 'Silver', name: 'Silver (operations)', title: 'Silver: operations coordination', means: 'A joint Emergency Operations Centre (EOC) runs unified command at or near the scene.' },
  { level: 'Gold', name: 'Gold (JOC)', title: 'Gold: the JOC is activated', means: 'The Joint Operations Centre (JOC) is activated at the Disaster Operations Centre (DOC) to coordinate the City’s response.' },
];
export const levelRank = (l: string | null | undefined) => (l === 'Gold' ? 3 : l === 'Silver' ? 2 : l === 'Bronze' ? 1 : 0);

/** The JOC's core team and the stand-by roles (the 2012 Plan, p. 18, with the JOC's names). */
export const DUTIES = ['Principal Disaster Management Stand-by Officer', 'MDMC Duty Officer', 'JOC Commander',
  'Disaster Management Officer', 'Stand-by Incident Logger', 'EMACC Operator', 'CCTV Operator'] as const;

export const SHELTER_KINDS = ['Community hall', 'School', 'Church or place of worship', 'Sports centre', 'Library', 'Temporary structure', 'Other'] as const;

/** Relief handed out at a shelter, as counts. */
export const RELIEF_ITEMS: Array<{ key: string; label: string }> = [
  { key: 'hot_meals', label: 'Hot meals' }, { key: 'blankets', label: 'Blankets' }, { key: 'mattresses', label: 'Mattresses' },
  { key: 'food_parcels', label: 'Food parcels' }, { key: 'hygiene_packs', label: 'Hygiene packs' }, { key: 'clothing', label: 'Clothing' },
];

/** The partner list's types, in the order the desk reads them. */
export const PARTNER_TYPES = ['eThekwini services', 'Utilities', 'Fire Stations', 'Law Enforcement', 'Ambulance & EMS', 'Hospitals',
  'Government', 'Disaster centres', 'Relief & NGO'] as const;
export const PARTNER_SECTORS = ['eThekwini', 'Provincial', 'National', 'District', 'Civil society'] as const;

/** The Municipal Disaster Management Centre and its alternate (the Plan, p. 14). */
export const MDMC_ADDRESS = '3 Jelf Taylor Crescent, Durban';
export const MDMC_ALTERNATE = 'Pinetown Fire Station, St John’s Ave, Pinetown';

/**
 * A number as a phone link: "031 361 0000" → "tel:0313610000", "10111" →
 * "tel:10111". The desk's PC opens it in its calling app (Zoiper, Phone
 * Link or Teams, whichever is set to open phone links). Null when there is
 * nothing to dial.
 */
export function telLink(number: string | null | undefined): string | null {
  const digits = (number ?? '').replace(/[^\d+]/g, '');
  return digits.length >= 3 ? `tel:${digits}` : null;
}
