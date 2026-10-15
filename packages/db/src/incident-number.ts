import type { Silo } from './types.generated';

/**
 * The incident number (0077): the departments a call was sent to, the date
 * and the time it was sent, and its number of the day.
 *
 *   MP-20261010-1115-0034          Metro Police
 *   MPFD-20261010-1115-0034        Metro Police and Fire
 *   MPFD-MD-20261010-1115-0034     and EMS
 *   MPFD-MDDM-20261010-1115-0034   all four
 *
 * The codes go in a fixed order (MP, FD, MD, DM), joined in pairs. The date
 * and time are South African. The number of the day counts every call in the
 * organisation, so no two calls share one. The database makes it
 * (next_incident_number); this mirrors it for reading and tests.
 *
 * No dependencies, so it can be tested.
 */

export const DEPARTMENT_CODES: ReadonlyArray<readonly [Exclude<Silo, 'Ethekwini'>, string]> = [
  ['MetroPolice', 'MP'], ['MetroFire', 'FD'], ['Medical', 'MD'], ['EthekwiniDisaster', 'DM'],
];
/** A call no department was named for (an SOS raised from the control room). */
export const CONTROL_ROOM_CODE = 'CR';

export function departmentPrefix(silos: readonly Silo[]): string {
  const codes = DEPARTMENT_CODES.filter(([s]) => silos.includes(s)).map(([, c]) => c);
  if (!codes.length) return CONTROL_ROOM_CODE;
  const pairs: string[] = [];
  for (let i = 0; i < codes.length; i += 2) pairs.push(codes.slice(i, i + 2).join(''));
  return pairs.join('-');
}

const SAST = new Intl.DateTimeFormat('en-ZA', {
  timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** The number a call sent at `at` gets, as the database makes it. */
export function formatIncidentNumber(silos: readonly Silo[], at: Date, seq: number): string {
  const p = Object.fromEntries(SAST.formatToParts(at).map((x) => [x.type, x.value]));
  const n = seq < 10000 ? String(seq).padStart(4, '0') : String(seq);
  return `${departmentPrefix(silos)}-${p.year}${p.month}${p.day}-${p.hour}${p.minute}-${n}`;
}

/** Either form: the new one, or INC-20261013-0004 on calls from before 0077. */
export const INCIDENT_NUMBER = /\b(?:INC-\d{8}-\d{3,4}|(?:CR|(?:MP|FD|MD|DM){1,2}(?:-(?:MP|FD|MD|DM){1,2})?)-\d{8}-\d{4}-\d{4,6})\b/gi;

export function isIncidentNumber(s: string): boolean {
  return new RegExp(`^${INCIDENT_NUMBER.source}$`, 'i').test(s.trim());
}
