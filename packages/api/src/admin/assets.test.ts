import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildShiftBoard, discState, saDayStart, type ShiftBoardInput } from './assets.ts';
import { roundsShort } from '../shift/end.ts';

test('today starts at midnight in South Africa', () => {
  assert.equal(saDayStart(new Date('2026-10-04T22:30:00Z')).toISOString(), '2026-10-04T22:00:00.000Z', '00:30 SAST is already the 5th');
  assert.equal(saDayStart(new Date('2026-10-04T21:59:00Z')).toISOString(), '2026-10-03T22:00:00.000Z');
  assert.equal(saDayStart(new Date('2026-10-04T08:00:00Z')).toISOString(), '2026-10-03T22:00:00.000Z');
});

test('licence discs that have expired or soon will', () => {
  const now = new Date('2026-10-04T08:00:00Z');
  assert.equal(discState('2026-10-01', now), 'expired');
  assert.equal(discState('2026-10-20', now), 'soon');
  assert.equal(discState('2027-03-31', now), 'ok');
  assert.equal(discState(null, now), null);
  assert.equal(roundsShort(15, 13), 2);
  assert.equal(roundsShort(null, 13), 0);
});

const person = (user_id: string, over: Partial<ShiftBoardInput['people'][number]> = {}): ShiftBoardInput['people'][number] => ({
  user_id, first_name: user_id, last_name: 'Officer', rank: 'Const', badge_number: `B-${user_id}`, station: 'Durban Central',
  silo: 'MetroPolice', is_on_duty: false, duty_started_at: null, assigned_apparatus_id: null, ...over,
});

test('the shift board: who is working today, with what, and what needs a look', () => {
  const dayStart = new Date('2026-10-03T22:00:00Z');
  const board = buildShiftBoard({
    dayStart,
    now: new Date('2026-10-04T15:00:00Z'),
    people: [
      person('onduty', { is_on_duty: true, duty_started_at: '2026-10-04T05:30:00Z', assigned_apparatus_id: 'v1' }),
      person('ended'),
      person('kept', {}),
      person('failed'),
      person('overdue'),
      person('nightshift', { is_on_duty: true, duty_started_at: '2026-10-04T04:00:00Z' }),
      person('idle'),
    ],
    readiness: [
      { user_id: 'onduty', timestamp: '2026-10-04T05:00:00Z', passed: true },
      { user_id: 'ended', timestamp: '2026-10-04T05:00:00Z', passed: true },
      { user_id: 'kept', timestamp: '2026-10-04T05:00:00Z', passed: true },
      { user_id: 'failed', timestamp: '2026-10-04T05:00:00Z', passed: false },
    ],
    inspections: [
      { user_id: 'onduty', apparatus_id: 'v1', checked_at: '2026-10-04T05:10:00Z', passed: true, items_fault: 2 },
      { user_id: 'ended', apparatus_id: 'v2', checked_at: '2026-10-04T05:10:00Z', passed: false, items_fault: 3 },
    ],
    noFirearm: [{ user_id: 'ended', reason: 'Court duty, unarmed', created_at: '2026-10-04T05:20:00Z' }],
    firearmsOut: [
      { id: 'f1', serial_number: 'SN-100', make: 'Glock', model: '17', issued_to: 'onduty', issued_at: '2026-10-04T05:15:00Z' },
      { id: 'f2', serial_number: 'SN-200', make: 'Glock', model: '17', issued_to: 'kept', issued_at: '2026-10-04T05:15:00Z' },
      { id: 'f3', serial_number: 'SN-300', make: 'Glock', model: '17', issued_to: 'overdue', issued_at: '2026-10-03T05:00:00Z' },
      { id: 'f4', serial_number: 'SN-400', make: 'Glock', model: '17', issued_to: 'nightshift', issued_at: '2026-10-04T03:55:00Z' },
    ],
    ends: [
      { user_id: 'ended', ended_at: '2026-10-04T14:00:00Z', source: 'app', unit_number: 'MP-02' },
      { user_id: 'kept', ended_at: '2026-10-04T14:00:00Z', source: 'firearm_out', unit_number: 'MP-03' },
    ],
    vehicles: [
      { id: 'v1', unit_number: 'MP-01', name: 'Patrol 1', status: 'In Use', status_note: null, station_number: null, silo: 'MetroPolice' },
      { id: 'v2', unit_number: 'MP-02', name: 'Patrol 2', status: 'Out of Service', status_note: 'Failed inspection: brakes', station_number: null, silo: 'MetroPolice' },
      { id: 'v3', unit_number: 'MP-03', name: 'Patrol 3', status: 'Maintenance', status_note: 'Clutch', station_number: null, silo: 'MetroPolice' },
    ],
  });
  const row = (id: string) => board.rows.find((r) => r.userId === id);
  assert.equal(row('idle'), undefined, 'nobody without activity or kit is listed');
  assert.deepEqual(row('onduty')?.vehicle, { unit: 'MP-01', result: 'faults' });
  assert.equal(row('onduty')?.firearm?.serial, 'SN-100');
  assert.deepEqual(row('onduty')?.flags, []);
  assert.equal(row('ended')?.ended?.source, 'app');
  assert.equal(row('ended')?.noFirearm, 'Court duty, unarmed');
  assert.deepEqual(row('ended')?.flags, ['vehicle-failed']);
  assert.deepEqual(row('kept')?.flags, ['firearm-out-after-end']);
  assert.deepEqual(row('failed')?.flags, ['failed-readiness']);
  assert.deepEqual(row('overdue')?.flags, ['firearm-overdue'], 'a firearm out longer than a shift shows even without a shift today');
  assert.deepEqual(row('nightshift')?.flags, [], 'booked out 11 hours ago, before midnight SA time, is still within the shift');
  assert.deepEqual(board.rows.slice(0, 4).map((r) => r.flags.length > 0), [true, true, true, true], 'what needs a look comes first');
  assert.deepEqual(board.totals, { started: 4, onDuty: 2, ended: 2, firearmsOut: 4, overdue: 1, vehiclesInUse: 1, offRoad: 2 });
  assert.deepEqual(board.offRoad.map((v) => v.unit_number), ['MP-02', 'MP-03']);
});
