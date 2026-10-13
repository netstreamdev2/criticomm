/**
 * The schedule's rules, with no database: South African dates, which shift a
 * rotation gives a team on a day, what state a shift is in right now, and the
 * month grid. Shared by the console and the phone, and tested on their own
 * (rules.test.ts). They mirror migration 0072, which is what enforces them.
 */

/** South Africa keeps one offset all year (no daylight saving). */
const SA_OFFSET_MS = 2 * 3_600_000;
const DAY_MS = 86_400_000;

/** The South African calendar day of an instant: "2026-10-13". */
export function saDay(at: string | number | Date = Date.now()): string {
  const ms = typeof at === 'number' ? at : new Date(at).getTime();
  return new Date(ms + SA_OFFSET_MS).toISOString().slice(0, 10);
}

/** "06:00", South African time. */
export function saTime(at: string | number | Date): string {
  const ms = typeof at === 'number' ? at : new Date(at).getTime();
  return new Date(ms + SA_OFFSET_MS).toISOString().slice(11, 16);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "Tue 13 Oct" for a calendar day. */
export function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "October 2026" for "2026-10". */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS_LONG[(m ?? 1) - 1]} ${y}`;
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** "2026-10" → its first and last day. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const last = new Date(Date.UTC(y ?? 1970, m ?? 1, 0)).getUTCDate();
  return { from, to: `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}` };
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

/** The weeks of a month, Monday first, padded with the days either side. */
export function monthGrid(month: string): Array<Array<{ day: string; inMonth: boolean }>> {
  const { from, to } = monthRange(month);
  const lead = (new Date(`${from}T00:00:00Z`).getUTCDay() + 6) % 7; // days back to Monday
  const cells = Math.ceil((lead + daysBetween(from, to) + 1) / 7) * 7;
  const start = addDays(from, -lead);
  const weeks: Array<Array<{ day: string; inMonth: boolean }>> = [];
  for (let i = 0; i < cells; i++) {
    if (i % 7 === 0) weeks.push([]);
    const day = addDays(start, i);
    weeks[weeks.length - 1]!.push({ day, inMonth: day >= from && day <= to });
  }
  return weeks;
}

/** The start and end of a shift of this type on this day ("06:00:00", 720 minutes). */
export function templateTimes(day: string, startTime: string, minutes: number): { start: string; end: string } {
  const hhmm = startTime.slice(0, 5);
  const start = new Date(`${day}T${hhmm}:00+02:00`).getTime();
  return { start: new Date(start).toISOString(), end: new Date(start + minutes * 60_000).toISOString() };
}

/* ── Rotations ────────────────────────────────────────────────────────── */

export type RotationShape = {
  cycle: Array<string | null>;
  teams: string[];
  offsets: number[];
  anchor: string;
};

/** The shift type a team works on a day, or null for a day off (as generate_roster counts). */
export function rotationShift(rotation: RotationShape, team: string, day: string): string | null {
  const i = rotation.teams.findIndex((t) => t.toLowerCase() === team.toLowerCase());
  if (i < 0 || rotation.cycle.length === 0) return null;
  const len = rotation.cycle.length;
  const pos = (((daysBetween(rotation.anchor, day) - (rotation.offsets[i] ?? 0)) % len) + len) % len;
  return rotation.cycle[pos] ?? null;
}

/* ── A shift, right now ───────────────────────────────────────────────── */

const INACTIVE = new Set(['Leave', 'Cancelled', 'Absent', 'Sick', 'Family Responsibility']);

/** Whether the person is working this line (roster_active). */
export function lineActive(status: string | null | undefined, cancelledAt: string | null | undefined): boolean {
  return !cancelledAt && !INACTIVE.has(status ?? '');
}

export type AttendanceLike = {
  checked_in_at: string | null;
  late_minutes: number | null;
  outcome: string | null;
  ended_at: string | null;
};

export type ShiftState =
  | 'leave' | 'cancelled' | 'recorded'
  | 'upcoming' | 'due' | 'late' | 'not_started' | 'missed'
  | 'started' | 'started_late' | 'finished';

/**
 * What a shift is at this moment, from its line and its attendance. `due` is
 * the grace period after the start; after it, `late`; after the no-show
 * minutes, `not_started`; once the shift has ended unworked, `missed`.
 */
export function shiftState(
  line: { start_at: string; end_at: string; status?: string | null; cancelled_at?: string | null },
  attendance: AttendanceLike | null | undefined,
  settings: { grace: number; noshow: number },
  now: number = Date.now(),
): ShiftState {
  if (!lineActive(line.status, line.cancelled_at)) return line.status === 'Leave' ? 'leave' : 'cancelled';
  if (attendance?.outcome && !attendance.checked_in_at) return 'recorded';
  if (attendance?.checked_in_at) {
    if (attendance.ended_at) return 'finished';
    return (attendance.late_minutes ?? 0) > settings.grace ? 'started_late' : 'started';
  }
  const start = Date.parse(line.start_at);
  const end = Date.parse(line.end_at);
  if (now < start) return 'upcoming';
  if (now >= end) return 'missed';
  const mins = (now - start) / 60_000;
  if (mins < settings.grace) return 'due';
  if (mins < settings.noshow) return 'late';
  return 'not_started';
}

/** Plain words for a state, as the screens show it. */
export function stateWords(state: ShiftState, attendance?: AttendanceLike | null): string {
  switch (state) {
    case 'leave': return 'On leave';
    case 'cancelled': return 'Cancelled';
    case 'recorded': return attendance?.outcome ?? 'Recorded';
    case 'upcoming': return 'Not started yet';
    case 'due': return 'Starting';
    case 'late': return 'Late';
    case 'not_started': return 'Not started';
    case 'missed': return 'Missed';
    case 'started': return attendance?.checked_in_at ? `Started ${saTime(attendance.checked_in_at)}` : 'Started';
    case 'started_late': return attendance?.checked_in_at
      ? `Started ${saTime(attendance.checked_in_at)} · ${attendance.late_minutes} min late` : 'Started late';
    case 'finished': return 'Finished';
  }
}

/** Which states need someone's attention now. */
export function needsAttention(state: ShiftState): boolean {
  return state === 'late' || state === 'not_started' || state === 'missed';
}

/** "Day shift · 06:00–18:00" */
export function shiftLabel(line: { start_at: string; end_at: string }, name?: string | null): string {
  return `${name || 'Shift'} · ${saTime(line.start_at)}–${saTime(line.end_at)}`;
}

/** Days of leave asked for, inclusive, for showing before the server has costed it. */
export function calendarDays(from: string, to: string): number {
  const n = daysBetween(from, to);
  return n < 0 ? 0 : n + 1;
}
