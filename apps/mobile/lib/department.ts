import type { Ionicons } from '@expo/vector-icons';
import { tx, type Translate } from '@criticom/db/i18n';

/**
 * Each department's own words, so every screen says what that service is:
 * who works the call, the report that closes it, the vehicle they sign onto.
 * No app dependencies, so the rules that use it can be tested. Department and
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
    person: tx('officer'), report: tx('incident report'), unit: tx('vehicle'),
    unitIcon: 'car-sport-outline', movingIcon: 'car-sport', file: tx('case file'), media: tx('evidence'),
  },
  fire: {
    person: tx('firefighter'), report: tx('fire report'), unit: tx('appliance'),
    unitIcon: 'bus-outline', movingIcon: 'bus', file: tx('incident record'), media: tx('photos'),
  },
  ems: {
    person: tx('paramedic'), report: tx('patient report'), unit: tx('ambulance'),
    unitIcon: 'medkit-outline', movingIcon: 'car', file: tx('incident record'), media: tx('photos'),
  },
  disaster: {
    person: tx('officer'), report: tx('post-mortem'), unit: null,
    unitIcon: 'car-outline', movingIcon: 'car', file: tx('incident record'), media: tx('photos'),
  },
};

export function wordsFor(silo: string | null | undefined): DepartmentWords {
  return WORDS[departmentOf(silo)];
}

/** The same words in the person's language, for the sentences they go into. */
export function wordsIn(silo: string | null | undefined, t: Translate): DepartmentWords {
  const w = wordsFor(silo);
  return { ...w, person: t(w.person), report: t(w.report), unit: w.unit && t(w.unit), file: t(w.file), media: t(w.media) };
}

/** "Firefighter", "Paramedic", "Officer" — for a name that is missing; in the reader's language when `t` is given. */
export function personTitle(silo: string | null | undefined, t?: Translate): string {
  const person = t ? t(wordsFor(silo).person) : wordsFor(silo).person;
  return person.charAt(0).toUpperCase() + person.slice(1);
}
