import type { Ionicons } from '@expo/vector-icons';

/**
 * Each department's own words, so every screen says what that service is:
 * who works the call, the report that closes it, the vehicle they sign onto.
 * No dependencies, so the rules that use it can be tested. Department and
 * role names are shared with the console (departmentName, roleName in
 * @criticom/db).
 *
 * Ethekwini field staff work from the Metro Police fleet and armoury, so they
 * read as police — the same as their home, start of shift and report.
 */

type IconName = keyof typeof Ionicons.glyphMap;

export type Department = 'police' | 'fire' | 'ems' | 'disaster';

export function departmentOf(silo: string | null | undefined): Department {
  switch (silo) {
    case 'MetroFire': return 'fire';
    case 'Medical': return 'ems';
    case 'EthekwiniDisaster': return 'disaster';
    default: return 'police';
  }
}

export type DepartmentWords = {
  /** Who works a call: officer, firefighter, paramedic. */
  person: string;
  /** The report that closes a call. */
  report: string;
  /** The vehicle they sign onto; Disaster Management has none. */
  unit: string | null;
  /** The vehicle's icon, outline (cards, chips). */
  unitIcon: IconName;
  /** On the way to a call. */
  movingIcon: IconName;
  /** Where photos and voice notes go: police keep a case file of evidence. */
  file: string;
  /** What those photos and notes are called. */
  media: string;
};

const WORDS: Record<Department, DepartmentWords> = {
  police: {
    person: 'officer', report: 'incident report', unit: 'vehicle',
    unitIcon: 'car-sport-outline', movingIcon: 'car-sport', file: 'case file', media: 'evidence',
  },
  fire: {
    person: 'firefighter', report: 'fire report', unit: 'appliance',
    unitIcon: 'bus-outline', movingIcon: 'bus', file: 'incident record', media: 'photos',
  },
  ems: {
    person: 'paramedic', report: 'patient report', unit: 'ambulance',
    unitIcon: 'medkit-outline', movingIcon: 'car', file: 'incident record', media: 'photos',
  },
  disaster: {
    person: 'officer', report: 'post-mortem', unit: null,
    unitIcon: 'car-outline', movingIcon: 'car', file: 'incident record', media: 'photos',
  },
};

export function wordsFor(silo: string | null | undefined): DepartmentWords {
  return WORDS[departmentOf(silo)];
}

/** "Firefighter", "Paramedic", "Officer" — for a name that is missing. */
export function personTitle(silo: string | null | undefined): string {
  const { person } = wordsFor(silo);
  return person.charAt(0).toUpperCase() + person.slice(1);
}
