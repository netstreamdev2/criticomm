import type { Silo } from './types.generated';
import { tx } from './i18n/index.ts';

/**
 * How a call ended for a department: the disposition code the lead (or the
 * desk, for a crew on the radio) picks when closing their part on scene
 * (migration 0098). One short list per department, as dispatch centres
 * keep them, so the figures say what actually happened.
 *
 * The database checks a code is one of these (incident_departments_disposition_check).
 * No dependencies beyond the words, so it can be tested.
 */

export type Disposition = { code: string; label: string };

const GOA = { code: 'GOA', label: tx('Gone on arrival') } as const;
const REFERRED = { code: 'REFERRED', label: tx('Referred to another agency') } as const;
const UNFOUNDED = { code: 'UNFOUNDED', label: tx('Unfounded or false call') } as const;

export const DISPOSITIONS: Record<Exclude<Silo, 'Ethekwini'>, readonly Disposition[]> = {
  MetroPolice: [
    { code: 'ARREST', label: tx('Arrest made') },
    { code: 'REPORT', label: tx('Report taken, case opened') },
    { code: 'ADVICE', label: tx('Advice given, no further action') },
    UNFOUNDED, GOA, REFERRED,
    { code: 'DUPLICATE', label: tx('Duplicate of another call') },
  ],
  MetroFire: [
    { code: 'EXTINGUISHED', label: tx('Fire put out') },
    { code: 'RESCUE', label: tx('Rescue done') },
    { code: 'SAFE', label: tx('Scene made safe') },
    { code: 'FALSE_ALARM', label: tx('False alarm') },
    GOA, REFERRED,
  ],
  Medical: [
    { code: 'TRANSPORTED', label: tx('Patient taken to hospital') },
    { code: 'TREATED', label: tx('Treated on scene, not taken') },
    { code: 'REFUSED', label: tx('Patient refused help') },
    { code: 'DOA', label: tx('Dead on arrival') },
    GOA, REFERRED,
  ],
  EthekwiniDisaster: [
    { code: 'ASSISTED', label: tx('Residents assisted') },
    { code: 'ASSESSED', label: tx('Damage assessed') },
    { code: 'SAFE', label: tx('Scene made safe') },
    UNFOUNDED, REFERRED,
  ],
};

/** The list for a department; the control room's field officers work from the police one. */
export function dispositionsFor(silo: Silo | string | null | undefined): readonly Disposition[] {
  if (silo && silo in DISPOSITIONS) return DISPOSITIONS[silo as keyof typeof DISPOSITIONS];
  return DISPOSITIONS.MetroPolice;
}

/** Every code any department uses, once each: what the database allows. */
export const DISPOSITION_CODES: readonly string[] = [
  ...new Set(Object.values(DISPOSITIONS).flatMap((list) => list.map((d) => d.code))),
];

/** A code in words ("Arrest made"); the code itself when it is not one of ours. */
export function dispositionLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  for (const list of Object.values(DISPOSITIONS)) {
    const hit = list.find((d) => d.code === code);
    if (hit) return hit.label;
  }
  return code;
}
