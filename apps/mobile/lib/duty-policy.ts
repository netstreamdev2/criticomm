/**
 * Which screens are duty work, and when someone may open them. No
 * dependencies, so it can be tested (duty-policy.test.ts).
 */

/**
 * The screens that are duty work, by their first route segment (the tab is
 * '(tabs)/incidents' and '(tabs)/fines'). Everything else is open off duty.
 */
export const DUTY_ROUTES = [
  'incident', 'my-incidents', 'report', 'pcr', 'fire-report', 'post-mortem', 'assessment', 'route', 'talk', 'live-map', 'fines',
] as const;

/** Whether the screen at these route segments is duty work. */
export function isDutyRoute(segments: readonly string[]): boolean {
  const [first, second] = segments;
  if (first === '(tabs)') return second === 'incidents' || second === 'fines';
  return (DUTY_ROUTES as readonly string[]).includes(first ?? '');
}

/**
 * May work calls now. On duty is enough: the server lets nobody go on duty
 * without that day's start of shift (toggle_duty), and a shift runs past
 * midnight, so a night crew is not locked out at 00:00 by "today". Otherwise
 * today's start of shift is done and the duty flag is not known yet (no
 * signal since the app opened). Off duty, never.
 */
export function clearedForDuty(shiftStarted: boolean | null, onDuty: boolean | null): boolean {
  if (onDuty === true) return true;
  return shiftStarted === true && onDuty !== false;
}

/** Start of shift still to do: not done today, and not already on duty from an earlier start (a shift past midnight). */
export function needsShiftStart(shiftStarted: boolean | null, onDuty: boolean | null): boolean {
  return shiftStarted === false && onDuty !== true;
}
