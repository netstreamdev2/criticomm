import type { Silo } from './types.generated';

/**
 * The incident number (0096): ETK, the departments the call was sent to, the
 * date and time it was logged, and its number of the day.
 *
 *   ETK-20261021-1206-0001          sent early, still being logged
 *   ETK-MP-MD-20261021-1206-0001    finished: Metro Police and EMS
 *   ETK-MP-FD-MD-20261021-1206-0001 Fire added later
 *
 * The codes go in a fixed order (MP, FD, MD, DM), each with a dash, once the
 * logger has finished; a code once in the number stays. The date and time
 * are South African and never change. The number of the day counts every
 * call in the organisation, so no two calls share one. The database makes it
 * (next_incident_number and its trigger); this mirrors it for reading and
 * tests. Calls from before 0096 keep their numbers (0077: MP-…, MPFD-MD-…).
 *
 * No dependencies, so it can be tested.
 */

export const DEPARTMENT_CODES: ReadonlyArray<readonly [Exclude<Silo, 'Ethekwini'>, string]> = [
  ['MetroPolice', 'MP'], ['MetroFire', 'FD'], ['Medical', 'MD'], ['EthekwiniDisaster', 'DM'],
];
/** A call no department was named for (an SOS raised from the control room). */
export const CONTROL_ROOM_CODE = 'CR';

/** MP, MP-MD, MP-FD-MD-DM: the departments, in order, each with a dash; CR when none. */
export function departmentCodes(silos: readonly Silo[]): string {
  const codes = DEPARTMENT_CODES.filter(([s]) => silos.includes(s)).map(([, c]) => c);
  return codes.length ? codes.join('-') : CONTROL_ROOM_CODE;
}

const SAST = new Intl.DateTimeFormat('en-ZA', {
  timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** The number a call logged at `at` gets, as the database makes it; no departments until it is finished. */
export function formatIncidentNumber(silos: readonly Silo[], at: Date, seq: number, finished = true): string {
  const p = Object.fromEntries(SAST.formatToParts(at).map((x) => [x.type, x.value]));
  const n = seq < 10000 ? String(seq).padStart(4, '0') : String(seq);
  const core = `${p.year}${p.month}${p.day}-${p.hour}${p.minute}-${n}`;
  return finished ? `ETK-${departmentCodes(silos)}-${core}` : `ETK-${core}`;
}

/** Any form: ETK (0096), the departments-first one (0077), or INC-20261013-0004 from before that. */
export const INCIDENT_NUMBER = /\b(?:ETK(?:-(?:MP|FD|MD|DM|CR)){0,4}-\d{8}-\d{4}-\d{4,6}|INC-\d{8}-\d{3,4}|(?:CR|(?:MP|FD|MD|DM){1,2}(?:-(?:MP|FD|MD|DM){1,2})?)-\d{8}-\d{4}-\d{4,6})\b/gi;

export function isIncidentNumber(s: string): boolean {
  return new RegExp(`^${INCIDENT_NUMBER.source}$`, 'i').test(s.trim());
}
