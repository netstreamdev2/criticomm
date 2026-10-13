import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eveningBefore, HORIZON_DAYS, MAX_REMINDERS, PREFIX, reminderPlan, type ReminderLine } from './shift-reminders-policy.ts';

const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+02:00`).toISOString();
const line = (id: string, day: string, hhmm: string, hours = 12, over: Partial<ReminderLine> = {}): ReminderLine => ({
  id, start_at: at(day, hhmm), end_at: new Date(Date.parse(at(day, hhmm)) + hours * 3_600_000).toISOString(),
  name: 'Day shift', place: 'Station 4', status: 'Present', cancelled_at: null, started: false, ...over,
});

test('a day shift gets the evening before, an hour before, and the start', () => {
  const now = Date.parse(at('2026-10-12', '12:00'));
  const plan = reminderPlan([line('a', '2026-10-13', '06:00')], now);
  assert.deepEqual(plan.map((r) => [r.id, new Date(r.at).toISOString()]), [
    [`${PREFIX}a:eve`, at('2026-10-12', '19:00')],
    [`${PREFIX}a:hour`, at('2026-10-13', '05:00')],
    [`${PREFIX}a:start`, at('2026-10-13', '06:00')],
  ]);
  assert.equal(plan[0]!.title, 'Tomorrow: Day shift 06:00');
  assert.equal(plan[1]!.body, 'Day shift 06:00–18:00 · Station 4');
  assert.match(plan[2]!.body, /Start your shift\.$/);
});

test('nothing in the past, nothing for leave or a cancelled shift, nothing once started', () => {
  const now = Date.parse(at('2026-10-13', '05:30'));
  assert.deepEqual(reminderPlan([line('a', '2026-10-13', '06:00')], now).map((r) => r.id), [`${PREFIX}a:start`]);
  assert.deepEqual(reminderPlan([line('a', '2026-10-13', '06:00', 12, { started: true })], now), []);
  assert.deepEqual(reminderPlan([line('b', '2026-10-14', '06:00', 12, { status: 'Leave' })], now), []);
  assert.deepEqual(reminderPlan([line('c', '2026-10-14', '06:00', 12, { cancelled_at: '2026-10-12T10:00:00Z' })], now), []);
  assert.deepEqual(reminderPlan([line('d', '2026-10-12', '06:00')], now), [], 'a shift already over');
});

test('an evening shift is not reminded the evening before when that is the same hour', () => {
  // Starts 20:00: 19:00 the day before is 25 h ahead, so that one stands.
  const now = Date.parse(at('2026-10-12', '08:00'));
  const night = reminderPlan([line('n', '2026-10-13', '18:00')], now);
  assert.equal(night[0]!.id, `${PREFIX}n:eve`);
  // A 24-hour shift from 08:00, asked about at 18:00 the evening before.
  const late = Date.parse(at('2026-10-12', '18:00'));
  assert.equal(eveningBefore(Date.parse(at('2026-10-13', '08:00'))), Date.parse(at('2026-10-12', '19:00')));
  assert.equal(reminderPlan([line('f', '2026-10-13', '08:00', 24)], late).length, 3);
});

test('only the next two weeks, and never more than the phone allows', () => {
  const now = Date.parse(at('2026-10-01', '00:00'));
  const lines = Array.from({ length: 40 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 9, 2 + i)).toISOString().slice(0, 10);
    return line(`l${i}`, d, '06:00');
  });
  const plan = reminderPlan(lines, now);
  assert.ok(plan.length <= MAX_REMINDERS);
  assert.ok(plan.every((r) => r.at <= now + (HORIZON_DAYS + 1) * 86_400_000));
  assert.ok(plan.every((r, i) => i === 0 || plan[i - 1]!.at <= r.at), 'soonest first');
});
