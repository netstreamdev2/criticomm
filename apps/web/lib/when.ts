/**
 * When something happened, the way a chat list says it: "Just now", "12 min",
 * the time today ("14:05"), "Yesterday", then the date ("05-08-2026"). South
 * African time throughout, so midnight is Durban's midnight.
 */

const SA_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' });
const SA_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hour12: false });

/** "2026-08-05" → "05-08-2026". */
function dmy(isoDay: string) {
  const [y, m, d] = isoDay.split('-');
  return `${d}-${m}-${y}`;
}

export function chatTime(at: string | Date | null | undefined, now: Date = new Date()): string {
  if (!at) return '—';
  const when = typeof at === 'string' ? new Date(at) : at;
  if (Number.isNaN(when.getTime())) return '—';
  const mins = Math.floor((now.getTime() - when.getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min`;
  const day = SA_DAY.format(when);
  if (day === SA_DAY.format(now)) return SA_TIME.format(when);
  const yesterday = SA_DAY.format(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  if (day === yesterday) return 'Yesterday';
  return dmy(day);
}

/** How long something has waited, as the calendar counts it: years, months, days, hours, minutes. */
export type WaitParts = { y: number; mo: number; d: number; h: number; m: number };

const SA_OFFSET_MS = 2 * 3_600_000; // South Africa: UTC+2 all year, no daylight saving.
const DAY_MS = 86_400_000;

/** The same moment in a month `months` later, the day kept or clamped to the month's end (31 Jan + 1 → 28 Feb). */
function addMonths(at: Date, months: number): Date {
  const total = at.getUTCMonth() + months;
  const year = at.getUTCFullYear() + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(at.getUTCDate(), lastDay),
    at.getUTCHours(), at.getUTCMinutes(), at.getUTCSeconds(), at.getUTCMilliseconds()));
}

/**
 * The wait from `since` to `now` in calendar years and months (in South
 * African time, so a month is Durban's month), then days, hours and minutes.
 * Nothing waits a negative time: a moment in the future is a wait of zero.
 */
export function waitParts(since: string | Date, now: Date = new Date()): WaitParts {
  const zero = { y: 0, mo: 0, d: 0, h: 0, m: 0 };
  const from = new Date((typeof since === 'string' ? Date.parse(since) : since.getTime()) + SA_OFFSET_MS);
  const to = new Date(now.getTime() + SA_OFFSET_MS);
  if (Number.isNaN(from.getTime()) || !(to > from)) return zero;
  let months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  let anchor = addMonths(from, months);
  if (anchor > to) anchor = addMonths(from, --months);
  const rest = to.getTime() - anchor.getTime();
  return {
    y: Math.floor(months / 12),
    mo: months % 12,
    d: Math.floor(rest / DAY_MS),
    h: Math.floor((rest % DAY_MS) / 3_600_000),
    m: Math.floor((rest % 3_600_000) / 60_000),
  };
}

/** The parts worth showing, largest first: no leading zeros, but always hours and minutes. */
export function waitShown(p: WaitParts): Array<[number, 'y' | 'mo' | 'd' | 'h' | 'm']> {
  const all: Array<[number, 'y' | 'mo' | 'd' | 'h' | 'm']> = [[p.y, 'y'], [p.mo, 'mo'], [p.d, 'd'], [p.h, 'h'], [p.m, 'm']];
  const first = all.findIndex(([n], i) => n > 0 || i >= 3);
  return all.slice(first);
}

const SA_STAMP = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Johannesburg', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
});

/** "06 Apr 2026, 10:42" in South African time. */
export function saStamp(at: string | Date): string {
  const when = typeof at === 'string' ? new Date(at) : at;
  return Number.isNaN(when.getTime()) ? '—' : SA_STAMP.format(when);
}
