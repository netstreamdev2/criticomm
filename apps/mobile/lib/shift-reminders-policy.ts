/**
 * Which shift reminders the phone schedules for itself, with no dependencies.
 *
 * The phone, not the server, reminds a crew member of their shift: a
 * notification scheduled on the device fires with no signal, on a locked
 * phone, with the app closed. The server tells them about changes, lateness
 * and leave (pushed alerts); these are the reminders that must never depend
 * on a connection. Rebuilt from the saved roster each time the schedule is
 * read, so a change or a cancellation replaces what was scheduled.
 *
 *   evening before  19:00 the day before ("Tomorrow: Day shift 06:00")
 *   an hour before  ("Your shift starts in 1 hour")
 *   at the start    ("Your shift has started. Start your shift.") — unless
 *                   they have already started it
 *
 * Tested in shift-reminders-policy.test.ts.
 */

export type ReminderLine = {
  id: string;
  start_at: string;
  end_at: string;
  /** "Day shift" */
  name: string;
  /** "Station 4 · Sector 1 car" */
  place: string | null;
  status: string | null;
  cancelled_at: string | null;
  /** Already started (checked in), so no start-time nudge. */
  started: boolean;
};

export type Reminder = { id: string; at: number; title: string; body: string; lineId: string };

/** iOS keeps 64 scheduled notifications per app; leave room for anything else. */
export const MAX_REMINDERS = 48;
export const HORIZON_DAYS = 14;
export const PREFIX = 'shift:';

const SA_OFFSET_MS = 2 * 3_600_000;
const INACTIVE = new Set(['Leave', 'Cancelled', 'Absent', 'Sick', 'Family Responsibility']);

const saClock = (ms: number) => new Date(ms + SA_OFFSET_MS).toISOString().slice(11, 16);
const saDayOf = (ms: number) => new Date(ms + SA_OFFSET_MS).toISOString().slice(0, 10);

/** 19:00 South African time on the day before the shift's day. */
export function eveningBefore(startMs: number): number {
  const day = saDayOf(startMs);
  const d = new Date(`${day}T19:00:00+02:00`).getTime();
  return d - 86_400_000;
}

export function reminderPlan(lines: readonly ReminderLine[], now: number = Date.now()): Reminder[] {
  const out: Reminder[] = [];
  const horizon = now + HORIZON_DAYS * 86_400_000;
  for (const l of lines) {
    if (l.cancelled_at || INACTIVE.has(l.status ?? '')) continue;
    const start = Date.parse(l.start_at);
    const end = Date.parse(l.end_at);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= now || start > horizon) continue;
    const when = `${l.name} ${saClock(start)}–${saClock(end)}`;
    const where = l.place ? ` · ${l.place}` : '';

    const eve = eveningBefore(start);
    // Not when the shift starts within two hours of it (an evening shift the
    // next day is reminded an hour before instead).
    if (eve > now && start - eve > 2 * 3_600_000) {
      out.push({ id: `${PREFIX}${l.id}:eve`, at: eve, lineId: l.id, title: `Tomorrow: ${l.name} ${saClock(start)}`, body: `${when}${where}. Open My Schedule to confirm.` });
    }
    const hour = start - 3_600_000;
    if (hour > now && !l.started) {
      out.push({ id: `${PREFIX}${l.id}:hour`, at: hour, lineId: l.id, title: 'Your shift starts in 1 hour', body: `${when}${where}` });
    }
    if (start > now && !l.started) {
      out.push({ id: `${PREFIX}${l.id}:start`, at: start, lineId: l.id, title: 'Your shift has started', body: `${when}${where}. Start your shift.` });
    }
  }
  return out.sort((a, b) => a.at - b.at).slice(0, MAX_REMINDERS);
}
