/**
 * The eThekwini Municipal Disaster Management Plan's lists (rev. 7 Aug 2012,
 * ratified by EXCO 13 Aug 2013), as data for the Disaster desk. The database
 * (0112) checks the same lists; keep them in step.
 */

/** Classification of Potential Hazards (the Plan, pp. 7–8). */
export const HAZARD_GROUPS: Array<{ group: string; hazards: string[] }> = [
  { group: 'Natural: meteorological', hazards: ['Cyclone, hurricane or tornado', 'Storm tide', 'Severe storm', 'Wildfire', 'Extreme temperature', 'Drought', 'Flood'] },
  { group: 'Natural: geological', hazards: ['Earthquake', 'Landslip or debris flow', 'Erosion', 'Tsunami', 'Major sinkhole'] },
  { group: 'Natural: biological', hazards: ['Epidemic human disease', 'Animal disease', 'Insect or vermin plague', 'Food and crop disease', 'Emerging catastrophic disease'] },
  { group: 'Non-natural: human caused', hazards: ['Civil disturbance or riot', 'Terrorist attack', 'Arson', 'Sabotage of essential services', 'Shooting or massacre', 'IT virus or systems compromise'] },
  { group: 'Non-natural: technological', hazards: ['Structure or informal settlement fire', 'Structural collapse', 'Failure of critical infrastructure or services', 'Hazardous materials accident', 'Industrial accident', 'Major transport accident', 'Nuclear power accident', 'Dam failure', 'Aeronautical or space'] },
  { group: 'Other', hazards: ['Other'] },
];
export const HAZARDS: string[] = HAZARD_GROUPS.flatMap((g) => g.hazards);
export const hazardGroup = (hazard: string | null | undefined) => HAZARD_GROUPS.find((g) => g.hazards.includes(hazard ?? ''))?.group ?? null;

/** The municipalities a disaster can affect: eThekwini and KwaZulu-Natal's districts. */
export const MUNICIPALITIES = ['eThekwini Metro', 'Amajuba', 'Harry Gwala', 'iLembe', 'King Cetshwayo', 'Ugu', 'uMgungundlovu',
  'uMkhanyakude', 'uMzinyathi', 'uThukela', 'Zululand'] as const;

/** Levels of command, control and co-ordination (the Plan, pp. 16–18). */
export type CoordinationLevel = 'Bronze' | 'Silver' | 'Gold';
export const LEVELS: Array<{ level: CoordinationLevel; name: string; means: string }> = [
  { level: 'Bronze', name: 'Bronze (tactical)', means: 'EMACC and the services on scene, working together at a Forward Control Point (FCP).' },
  { level: 'Silver', name: 'Silver (operations)', means: 'A joint Emergency Operations Centre (EOC) set up at or near the scene.' },
  { level: 'Gold', name: 'Gold (strategic)', means: 'The Disaster Operations Centre (DOC) activated and the Strategic Co-ordination Group (SCG) in session.' },
];
export const levelRank = (l: string | null | undefined) => (l === 'Gold' ? 3 : l === 'Silver' ? 2 : l === 'Bronze' ? 1 : 0);

/** The DOC's initial core team and the stand-by roles (the Plan, p. 18). */
export const DUTIES = ['Principal Disaster Management Stand-by Officer', 'MDMC Duty Officer', 'DOC Commander',
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
