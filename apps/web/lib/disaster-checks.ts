import { tx } from '@criticom/db/i18n';

/**
 * The Disaster desk's checks on what is typed (0114): only the obvious ones,
 * each explained in one short sentence. Blank always passes: every field
 * these check is optional. The database checks the same (0114), so a form
 * that skips them is still refused.
 */

export type Problem = { text: string; vars?: Record<string, string | number> };

const digitsOf = (v: string) => v.replace(/[\s\-().]/g, '');

/**
 * A phone number: South African (082 123 4567, +27 82 123 4567) or
 * international (+44 …). An organisation may also have a short number
 * (10111, 10177, 112): `short` lets those through.
 */
export function checkPhone(value: string | null | undefined, opts: { short?: boolean } = {}): Problem | null {
  const v = digitsOf(value ?? '');
  if (!v) return null;
  if (opts.short && /^1\d{2,4}$/.test(v)) return null;
  const local = /^0([1-9]\d{8})$/.exec(v)?.[1] ?? /^\+?27([1-9]\d{8})$/.exec(v)?.[1];
  if (local) return /^(\d)\1+$/.test(local) ? { text: tx('That number is not real. Check it.') } : null;
  if (/^\+[1-9]\d{7,14}$/.test(v) && !v.startsWith('+27')) return null;
  return { text: tx('Give a full number, like 082 123 4567.') };
}

/** eThekwini's wards (2021): 1 to 111. Elsewhere in the province, up to 120. */
export const ETHEKWINI_WARDS = 111;
const MAX_WARD = 120;

/** "Ward 76" or "76" → "76"; null when blank or not a ward. */
export function wardNumber(value: string | null | undefined): string | null {
  const m = /^\s*(?:ward\s*)?0*(\d{1,3})\s*$/i.exec(value ?? '');
  return m ? m[1]! : null;
}

export function checkWard(value: string | null | undefined, municipality?: string | null): Problem | null {
  if (!(value ?? '').trim()) return null;
  const n = Number(wardNumber(value));
  if (!n) return { text: tx('Give the ward number, like 76.') };
  if ((!municipality || municipality === 'eThekwini Metro') && n > ETHEKWINI_WARDS) return { text: tx('eThekwini has wards 1 to {n}.'), vars: { n: ETHEKWINI_WARDS } };
  if (n > MAX_WARD) return { text: tx('Give the ward number, like 76.') };
  return null;
}

/** A person's name: letters, not numbers. */
export function checkName(value: string | null | undefined): Problem | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  if (/\d/.test(v)) return { text: tx('A name has no numbers in it.') };
  if ((v.match(/\p{L}/gu) ?? []).length < 2) return { text: tx('Write the name in full.') };
  return null;
}

/** Age in years: a whole number from 0 to 120. */
export function checkAge(value: string | null | undefined): Problem | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  return /^\d{1,3}$/.test(v) && Number(v) <= 120 ? null : { text: tx('Give the age in years, 0 to 120.') };
}

export function checkEmail(value: string | null | undefined): Problem | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? null : { text: tx('That email address is not complete.') };
}

/** A hall's capacity: 1 to 20 000 people (Moses Mabhida holds about 55 000; no hall does). */
export const MAX_CAPACITY = 20_000;
export function checkCapacity(value: string | null | undefined): Problem | null {
  const v = (value ?? '').trim();
  if (!v || v === '0') return null;
  return /^\d+$/.test(v) && Number(v) <= MAX_CAPACITY ? null : { text: tx('A hall holds 1 to {n} people.'), vars: { n: '20 000' } };
}

/** People and homes in a report: up to 500 000 (the 2022 floods displaced about 40 000). */
export const MAX_PEOPLE = 500_000;
/** Vehicles, tankers, skips, roads and the like: up to 1 000. */
export const MAX_THINGS = 1_000;
/** The figures that count things, not people or homes (packages/db disaster-departments, the database's disaster_figure_max). */
export const THING_FIGURES = new Set(['roads_closed', 'officers_deployed', 'appliances', 'centres_staffed', 'halls_opened', 'temporary_shelters',
  'vehicles_sent', 'water_tankers', 'temporary_toilets', 'skips', 'unsafe_buildings']);
export const figureMax = (key: string) => (THING_FIGURES.has(key) ? MAX_THINGS : MAX_PEOPLE);

export function checkCount(value: string | null | undefined, max: number): Problem | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  if (!/^\d+$/.test(v)) return { text: tx('Use a whole number.') };
  return Number(v) > max ? { text: tx('More than {n}? Check the number.'), vars: { n: max.toLocaleString('en-ZA') } } : null;
}

/** Any problem in a set of checks, for disabling Save. */
export const anyProblem = (...ps: Array<Problem | null>) => ps.some(Boolean);
