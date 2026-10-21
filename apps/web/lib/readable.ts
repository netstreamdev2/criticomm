import { formatElapsed } from '@criticom/api/cases';

/**
 * A length of time in minutes, as people say it: "45 min", "2 h 15 min",
 * "3 days 4 h", "5 months", "1 year 2 months". At most two parts; never
 * hundreds of hours or days to work out. "—" when there is none.
 * For every dashboard and KPI page (packages/api formatElapsed).
 */
export function readable(minutes: number | string | null | undefined): string {
  if (minutes === null || minutes === undefined || minutes === '') return '—';
  return formatElapsed(typeof minutes === 'string' ? Number(minutes) : minutes);
}
