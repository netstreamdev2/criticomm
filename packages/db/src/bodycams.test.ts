import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BODYCAM_COLUMNS, checkBodycamList, hikCameraCodeFrom, type BodycamEntry } from './assets.ts';
import {
  bookingOverlaps, footageWindowError, liveFeedState, secondsToAnswer, STILL_WATCHING_AFTER_MS, STILL_WATCHING_GRACE_MS,
  viewReasonError, windowFor,
} from './bodycams.ts';
import { canAccess, canWatchBodycam } from './roles.ts';
import { mapSheetHeaders, sheetRowsFromTable } from './sheet.ts';

test('who may watch a bodycam live, and who may pull footage', () => {
  const police = 'MetroPolice';
  for (const role of ['SuperAdmin', 'SystemAdmin', 'SystemController', 'ControlRoom', 'Dispatcher'] as const) {
    assert.equal(canWatchBodycam({ role, silo: 'Ethekwini' }, police, 'live'), true, role);
    assert.equal(canAccess('/cameras', role, 'Ethekwini'), true, role);
  }
  assert.equal(canWatchBodycam({ role: 'Captain', silo: 'MetroPolice' }, police, 'live'), true);
  assert.equal(canWatchBodycam({ role: 'Supervisor', silo: 'MetroFire' }, police, 'live'), false, 'own department only');
  assert.equal(canWatchBodycam({ role: 'Supervisor', silo: 'Ethekwini' }, police, 'live'), true, 'the control silo reaches Metro Police kit');
  for (const role of ['Viewer', 'IncidentLogger', 'Admin', 'Police', 'CaseManager'] as const) {
    assert.equal(canWatchBodycam({ role, silo: 'Ethekwini' }, police, 'live'), false, role);
    assert.equal(canAccess('/cameras', role, 'Ethekwini'), false, role);
  }
  assert.equal(canWatchBodycam({ role: 'CaseManager', silo: 'Ethekwini' }, police, 'footage'), true);
  assert.equal(canAccess('/cameras/footage', 'CaseManager', 'Ethekwini'), true);
  assert.equal(canAccess('/cameras/footage', 'Viewer', 'Ethekwini'), false);
});

test('the SANRAL wall keeps the old camera rule; the register follows the armoury', () => {
  for (const role of ['Viewer', 'Dispatcher', 'Admin'] as const) {
    assert.equal(canAccess('/sanral', role, 'Ethekwini'), true, role);
  }
  assert.equal(canAccess('/sanral', 'IncidentLogger', 'Ethekwini'), false, 'the call logger has four screens, no cameras');
  assert.equal(canAccess('/sanral', 'Police', 'MetroPolice'), false);
  for (const role of ['Captain', 'Supervisor', 'SystemAdmin'] as const) {
    assert.equal(canAccess('/police/bodycams', role, 'MetroPolice'), true, role);
  }
  assert.equal(canAccess('/police/bodycams', 'Police', 'MetroPolice'), false, 'officers book out in the app');
});

test('a reason before any view', () => {
  assert.equal(viewReasonError({ incidentId: 'i1' }), null, 'an incident is the reason');
  assert.match(viewReasonError({}) ?? '', /Say why/);
  assert.match(viewReasonError({ reason: 'incident' }) ?? '', /Choose the incident/);
  assert.match(viewReasonError({ reason: 'other', note: 'hm' }) ?? '', /few words/);
  assert.equal(viewReasonError({ reason: 'other', note: 'Checking a complaint' }), null);
  assert.equal(viewReasonError({ reason: 'officer_safety' }), null);
  assert.match(viewReasonError({ reason: 'sos', note: 'x'.repeat(301) }) ?? '', /under 300/);
});

test('a live feed asks after ten minutes and stops a minute later', () => {
  const t0 = 1_000_000;
  assert.equal(liveFeedState(t0, t0 + 60_000), 'watching');
  assert.equal(liveFeedState(t0, t0 + STILL_WATCHING_AFTER_MS), 'asking');
  assert.equal(secondsToAnswer(t0, t0 + STILL_WATCHING_AFTER_MS), 60);
  assert.equal(liveFeedState(t0, t0 + STILL_WATCHING_AFTER_MS + STILL_WATCHING_GRACE_MS), 'expired');
  assert.equal(secondsToAnswer(t0, t0 + STILL_WATCHING_AFTER_MS + STILL_WATCHING_GRACE_MS + 5000), 0);
});

test('footage windows', () => {
  const now = new Date('2026-10-05T12:00:00Z');
  assert.equal(footageWindowError(new Date('2026-10-05T10:00:00Z'), new Date('2026-10-05T11:00:00Z'), now), null);
  assert.match(footageWindowError(new Date('2026-10-04T10:00:00Z'), new Date('2026-10-05T11:00:00Z'), now) ?? '', /24 hours/);
  assert.match(footageWindowError(new Date('2026-10-05T11:00:00Z'), new Date('2026-10-05T10:00:00Z'), now) ?? '', /starts and ends/);
  assert.match(footageWindowError(new Date('2026-10-05T13:00:00Z'), new Date('2026-10-05T14:00:00Z'), now) ?? '', /not happened/);

  const open = windowFor('2026-10-05T06:00:00Z', null, now);
  assert.deepEqual(open, { from: '2026-10-05T06:00:00.000Z', to: '2026-10-05T12:00:00.000Z', capped: false });
  const long = windowFor('2026-10-03T06:00:00Z', '2026-10-05T06:00:00Z', now);
  assert.equal(long.to, '2026-10-04T06:00:00.000Z');
  assert.equal(long.capped, true);

  const booking = { booked_at: '2026-10-05T06:00:00Z', returned_at: '2026-10-05T09:00:00Z' };
  assert.equal(bookingOverlaps(booking, '2026-10-05T08:00:00Z', '2026-10-05T10:00:00Z', now), true);
  assert.equal(bookingOverlaps(booking, '2026-10-05T09:30:00Z', '2026-10-05T10:00:00Z', now), false);
  assert.equal(bookingOverlaps({ ...booking, returned_at: null }, '2026-10-05T11:00:00Z', '2026-10-05T11:30:00Z', now), true, 'still out');
});

const bodycam = (over: Partial<BodycamEntry>): BodycamEntry => ({
  id: 'b1', serial_number: 'BC-0001', model: 'DS-MCW407', sim_number: '0821234567', hik_camera_code: null,
  silo: 'MetroPolice', station: 'Durban Central', notes: null, status: 'Available', ...over,
});

test('bodycam headings and codes, however they were written', () => {
  const h = mapSheetHeaders(['Device Serial', 'Model No', 'MSISDN', 'cameraIndexCode', 'Dept', 'Dock'], BODYCAM_COLUMNS);
  assert.deepEqual(h.columns, { serial_number: 0, model: 1, sim_number: 2, hik_camera_code: 3, department: 4, station: 5 });
  assert.deepEqual(hikCameraCodeFrom(' b235b2988c174602b1597143d3738b49 '), { code: 'b235b2988c174602b1597143d3738b49', ok: true });
  assert.deepEqual(hikCameraCodeFrom(''), { code: null, ok: true });
  assert.equal(hikCameraCodeFrom('not a code!').ok, false);
});

test('checking a bodycam list against the register', () => {
  const table = [
    ['Serial number', 'Model', 'SIM number', 'Hikvision camera code', 'Department', 'Station'],
    ['BC-0002', 'ds-mcw407', '', '', 'Metro Police', 'Pinetown'],
    ['bc 0001', '', '082 123 4567', '', 'Metro Police', ''],
    ['BC-0003', 'DS-MCW407', '', 'b235b2988c174602b1597143d3738b49', 'Metro Police', ''],
    ['BC-0004', 'DS-MCW407', '', 'bad code!', 'Metro Police', ''],
    ['BC-0005', 'DS-MCW407', '', 'abc123', 'Metro Police', ''],
    ['BC-0006', 'DS-MCW407', '', 'abc123', 'Metro Police', ''],
    ['BC-0007', 'DS-MCW407', '', '', 'Space Force', ''],
  ];
  const parsed = sheetRowsFromTable(table, BODYCAM_COLUMNS, 'bodycam');
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  const register = [
    bodycam({}),
    bodycam({ id: 'b9', serial_number: 'BC-0009', hik_camera_code: 'b235b2988c174602b1597143d3738b49', status: 'Booked out' }),
  ];
  const res = checkBodycamList(parsed.rows, register);
  const at = (line: number) => res.rows.find((r) => r.line === line)!;
  assert.equal(at(2).outcome, 'add');
  assert.equal(at(2).item.model, 'DS-MCW407', 'models in one form');
  assert.equal(at(3).outcome, 'unchanged', 'a serial and a SIM match however they were typed');
  assert.equal(at(4).issues[0]?.code, 'code-elsewhere', 'one Hikvision code, one bodycam');
  assert.equal(at(5).issues[0]?.code, 'bad-code');
  assert.equal(at(6).issues[0]?.code, 'code-in-file');
  assert.equal(at(7).issues[0]?.code, 'code-in-file');
  assert.equal(at(8).issues[0]?.code, 'unknown-department');
  assert.deepEqual(res.counts, { add: 1, update: 0, unchanged: 1, merged: 0, attention: 5, skipped: 0 });

  const fixed = checkBodycamList(parsed.rows, register, { 4: { skip: true }, 5: { dropValue: true }, 6: { skip: true }, 8: { silo: 'MetroPolice' } });
  assert.equal(fixed.rows.find((r) => r.line === 5)?.outcome, 'add');
  assert.equal(fixed.rows.find((r) => r.line === 5)?.item.hik_camera_code, null);
  assert.equal(fixed.rows.find((r) => r.line === 7)?.outcome, 'add', 'the other row keeps the code once its twin is skipped');
  assert.equal(fixed.counts.attention, 0);
  assert.equal(fixed.toImport.length, 5);

  const second = sheetRowsFromTable([
    ['Serial number', 'Hikvision camera code', 'Department'],
    ['BC-0001', 'f00d', 'Metro Police'],
  ], BODYCAM_COLUMNS, 'bodycam');
  assert.ok(second.ok);
  if (!second.ok) return;
  const update = checkBodycamList(second.rows, register);
  assert.equal(update.rows[0]?.outcome, 'update');
  assert.deepEqual(update.rows[0]?.changes.map((c) => c.label), ['Hikvision camera code']);
});
