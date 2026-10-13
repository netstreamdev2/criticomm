import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, calendarDays, dayLabel, daysBetween, lineActive, monthGrid, monthLabel, monthRange, needsAttention,
  rotationShift, saDay, saTime, shiftLabel, shiftMonth, shiftState, stateWords, templateTimes,
} from './rules.ts';

test('South African days and times, whatever the clock of the machine', () => {
  assert.equal(saDay('2026-10-12T21:59:00Z'), '2026-10-12');
  assert.equal(saDay('2026-10-12T22:00:00Z'), '2026-10-13', 'midnight in Durban is 22:00 UTC');
  assert.equal(saTime('2026-10-13T04:00:00Z'), '06:00');
  assert.equal(dayLabel('2026-10-13'), 'Tue 13 Oct');
  assert.equal(monthLabel('2026-02'), 'February 2026');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(daysBetween('2026-01-01', '2026-10-13'), 285);
  assert.deepEqual(monthRange('2028-02'), { from: '2028-02-01', to: '2028-02-29' }, 'a leap year');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(calendarDays('2026-12-14', '2026-12-18'), 5);
  assert.equal(calendarDays('2026-12-18', '2026-12-14'), 0);
});

test('a shift of a type on a day starts at that time in South Africa', () => {
  assert.deepEqual(templateTimes('2026-10-13', '06:00:00', 720), {
    start: '2026-10-13T04:00:00.000Z', end: '2026-10-13T16:00:00.000Z',
  });
  const night = templateTimes('2026-10-13', '18:00:00', 720);
  assert.equal(saDay(night.end), '2026-10-14', 'a night shift ends the next morning');
  assert.equal(shiftLabel({ start_at: night.start, end_at: night.end }, 'Night shift'), 'Night shift · 18:00–06:00');
});

test('the month grid is whole weeks, Monday first', () => {
  const october = monthGrid('2026-10'); // 1 October 2026 is a Thursday
  assert.ok(october.every((w) => w.length === 7));
  assert.equal(october[0]![0]!.day, '2026-09-28');
  assert.equal(october[0]![3]!.day, '2026-10-01');
  assert.equal(october[0]![2]!.inMonth, false);
  const all = october.flat().filter((d) => d.inMonth).map((d) => d.day);
  assert.equal(all.length, 31);
  assert.equal(all.at(-1), '2026-10-31');
  assert.equal(monthGrid('2027-02').length, 4, 'February 2027 starts on a Monday and fills four weeks');
});

test('rotations give each team the same days as the database (and V4) do', () => {
  const D = 'day', N = 'night';
  const r224 = { cycle: [D, D, N, N, null, null, null, null], teams: ['A', 'B', 'C', 'D'], offsets: [0, 2, 4, 6], anchor: '2026-01-01' };
  const a = Array.from({ length: 8 }, (_, i) => rotationShift(r224, 'A', addDays('2026-01-01', i)));
  assert.deepEqual(a, [D, D, N, N, null, null, null, null]);
  const b = Array.from({ length: 8 }, (_, i) => rotationShift(r224, 'b', addDays('2026-01-01', i)));
  assert.deepEqual(b, [null, null, D, D, N, N, null, null], 'team B is two days behind, any case');
  // Every day, exactly two teams work: one on days, one on nights.
  for (let i = -20; i < 40; i++) {
    const day = addDays('2026-01-01', i);
    const on = ['A', 'B', 'C', 'D'].map((t) => rotationShift(r224, t, day)).filter(Boolean).sort();
    assert.deepEqual(on, [D, N], day);
  }
  const fire = { cycle: ['24', null, null], teams: ['Red', 'Blue', 'Green'], offsets: [0, 1, 2], anchor: '2026-01-01' };
  for (let i = 0; i < 9; i++) {
    const day = addDays('2026-10-01', i);
    assert.equal(['Red', 'Blue', 'Green'].filter((t) => rotationShift(fire, t, day)).length, 1, 'one watch on each day');
  }
  assert.equal(rotationShift(fire, 'Yellow', '2026-10-01'), null);
});

test('what a shift is right now', () => {
  const start = Date.parse('2026-10-13T04:00:00Z');
  const line = { start_at: new Date(start).toISOString(), end_at: new Date(start + 12 * 3_600_000).toISOString(), status: 'Present', cancelled_at: null };
  const s = { grace: 10, noshow: 60 };
  const min = (m: number) => start + m * 60_000;
  assert.equal(shiftState(line, null, s, min(-30)), 'upcoming');
  assert.equal(shiftState(line, null, s, min(5)), 'due');
  assert.equal(shiftState(line, null, s, min(12)), 'late');
  assert.equal(shiftState(line, null, s, min(75)), 'not_started');
  assert.equal(shiftState(line, null, s, min(13 * 60)), 'missed');
  const on = { checked_in_at: new Date(min(4)).toISOString(), late_minutes: 4, outcome: null, ended_at: null };
  assert.equal(shiftState(line, on, s, min(30)), 'started');
  assert.equal(stateWords('started', on), 'Started 06:04');
  const late = { ...on, checked_in_at: new Date(min(25)).toISOString(), late_minutes: 25 };
  assert.equal(shiftState(line, late, s, min(30)), 'started_late');
  assert.equal(stateWords('started_late', late), 'Started 06:25 · 25 min late');
  assert.equal(shiftState(line, { ...on, ended_at: new Date(min(720)).toISOString() }, s, min(721)), 'finished');
  assert.equal(shiftState(line, { checked_in_at: null, late_minutes: null, outcome: 'Excused', ended_at: null }, s, min(75)), 'recorded');
  assert.equal(shiftState({ ...line, status: 'Leave' }, null, s, min(75)), 'leave');
  assert.equal(shiftState({ ...line, cancelled_at: '2026-10-12T10:00:00Z' }, null, s, min(75)), 'cancelled');
  assert.ok(needsAttention('late') && needsAttention('not_started') && !needsAttention('started'));
  assert.equal(lineActive('Allocated', null), true);
  assert.equal(lineActive('Sick', null), false);
});
