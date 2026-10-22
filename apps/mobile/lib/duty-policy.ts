/**
 * Which screens are duty work, and when someone may open them. No
 * dependencies, so it can be tested (duty-policy.test.ts).
 */

/**
 * The screens that are duty work, by their first route segment (the tab is
 * '(tabs)/incidents' and '(tabs)/fines'). Everything else is open off duty.
 */
export const DUTY_ROUTES = [
  'incident', 'my-incidents', 'report', 'pcr', 'fire-report', 'post-mortem', 'route', 'talk', 'live-map', 'fines',
] as const;

/** Whether the screen at these route segments is duty work. */
export function isDutyRoute(segments: readonly string[]): boolean {
  const [first, second] = segments;
  if (first === '(tabs)') return second === 'incidents' || second === 'fines';
  return (DUTY_ROUTES as readonly string[]).includes(first ?? '');
}

/**
 * May work calls now: today's start of shift is done, and not off duty. An
 * unknown duty flag (no signal since the app opened) does not lock someone
 * out whose start of shift is on record today.
 */
export function clearedForDuty(shiftStarted: boolean | null, onDuty: boolean | null): boolean {
  return shiftStarted === true && onDuty !== false;
}
