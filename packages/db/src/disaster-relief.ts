import type { Check } from './disaster-joc.ts';

/**
 * Needs assessment and relief (0118), as data for the desk: the relief
 * checklist, the counts kept for each ward (no names), and the relief
 * materials the Directorate budgets for (revision 2, section 7). The
 * database checks the same keys; keep them in step.
 */

export const RELIEF_STEPS: Array<Check & { who: string }> = [
  { key: 'relief_initial', label: 'Initial assessment done by the Disaster Management Centre', who: 'Disaster Management Centre' },
  { key: 'relief_needs', label: 'Needs assessment done to set relief', who: 'Disaster Management Centre' },
  { key: 'relief_halls', label: 'Community halls opened for evacuation or temporary shelter', who: 'Parks, Recreation and Cemeteries; Safer Cities' },
  { key: 'relief_task_team', label: 'Social Relief Technical Task Team alerted', who: 'Disaster Management' },
  { key: 'relief_soup', label: 'City soup kitchen activated (evacuation)', who: 'Disaster Management' },
  { key: 'relief_lists', label: 'Beneficiary lists produced and escalated to stakeholders', who: 'Disaster Management' },
  { key: 'relief_councillors', label: 'Relief coordinated through ward councillors', who: 'Ward councillors; Disaster Management' },
  { key: 'relief_vulnerable', label: 'Needs of people with disabilities, older persons and young children addressed', who: 'Disaster Management; Safer Cities; Health' },
];

/** Who was helped in a ward. */
export const WARD_PEOPLE = [
  { key: 'households', label: 'Households' },
  { key: 'people', label: 'People' },
  { key: 'disabled', label: 'People with disabilities' },
  { key: 'older', label: 'Older persons' },
  { key: 'under_five', label: 'Children under five' },
] as const;

/** What was issued in a ward: the relief materials budgeted each year. */
export const RELIEF_STOCK_ITEMS = [
  { key: 'blankets', label: 'Blankets' },
  { key: 'mattresses', label: 'Mattresses' },
  { key: 'food_hampers', label: 'Food hampers' },
  { key: 'start_house_kits', label: 'Start-house kits' },
] as const;
export type ReliefItemKey = (typeof RELIEF_STOCK_ITEMS)[number]['key'];

export type WardCounts = Record<(typeof WARD_PEOPLE)[number]['key'] | ReliefItemKey, number>;

/** What is wrong with a ward's counts, in one short sentence (the database says the same); null when fine. */
export function wardCountsProblem(c: Partial<WardCounts>): string | null {
  const n = (k: keyof WardCounts) => c[k] ?? 0;
  const vulnerable = Math.max(n('disabled'), n('older'), n('under_five'));
  if (vulnerable > 0 && n('people') === 0) return 'Give the number of people helped too.';
  if (vulnerable > n('people')) return 'People with disabilities, older persons or under-fives cannot be more than the people helped.';
  if (n('people') > 0 && n('households') > n('people')) return 'Households cannot be more than the people helped.';
  return null;
}

/**
 * The municipal financial year a moment falls in, July to June, as the IDP
 * writes it ("2026/27"), with its first and last moments in South African time.
 */
export function financialYear(at: Date = new Date()): { label: string; start: Date; end: Date } {
  const sa = new Date(at.getTime() + 2 * 3600_000);
  const y = sa.getUTCMonth() >= 6 ? sa.getUTCFullYear() : sa.getUTCFullYear() - 1;
  return {
    label: `${y}/${String((y + 1) % 100).padStart(2, '0')}`,
    start: new Date(`${y}-07-01T00:00:00+02:00`),
    end: new Date(`${y + 1}-07-01T00:00:00+02:00`),
  };
}
