import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardCounts, filterBoard, formatBoardDuration, phaseOf, toBoardEntry, type BoardRow } from './responder-board.ts';

const now = Date.parse('2026-10-17T10:00:00Z');
const row = (extra: Partial<BoardRow> = {}): BoardRow => ({
  id: 'a', incident_number: 'MP-20261017-0900-0001', incident_type: 'Armed robbery', incident_category: 'Crime',
  incident_code: 'P12', incident_severity: 'Critical', status: 'En Route', silo: 'Ethekwini',
  dispatched_silos: ['MetroPolice'], caller_name: 'Thabo', location_address: 'Pavilion', call_description: 'Two armed men',
  dispatch_time: '2026-10-17T09:50:00Z', arrived_timestamp: null, responding_officer: null,
  incident_created_at: '2026-10-17T09:45:00Z',
  responders: [
    { user_id: 'u2', name: 'Const. Zulu', silo: 'MetroPolice', role: 'backup', status: 'En Route', joined_at: '2026-10-17T09:52:00Z' },
    { user_id: 'u1', name: 'Const. Khumalo', silo: 'MetroPolice', role: 'lead', status: 'En Route', joined_at: '2026-10-17T09:51:00Z' },
  ],
  departments: null,
  ...extra,
});

test('the phase a call is in, from its status', () => {
  assert.equal(phaseOf('Dispatched'), 'responding');
  assert.equal(phaseOf('En Route'), 'responding');
  assert.equal(phaseOf('Arrived'), 'on_scene');
  assert.equal(phaseOf('On Scene'), 'on_scene');
  assert.equal(phaseOf('Transporting'), 'transporting');
});

test('an entry: crew lead first, departments without the control room, the clocks', () => {
  const e = toBoardEntry(row(), now);
  assert.deepEqual(e.crew.map((c) => c.name), ['Const. Khumalo', 'Const. Zulu']);
  assert.equal(e.lead, 'Const. Khumalo');
  assert.deepEqual(e.departments.map((d) => d.label), ['Metro Police'], 'the control room only logged it');
  assert.equal(e.sinceDispatchS, 600);
  assert.equal(e.onSceneS, null, 'not on scene yet');
  const there = toBoardEntry(row({ status: 'On Scene', arrived_timestamp: '2026-10-17T09:58:30Z' }), now);
  assert.equal(there.onSceneS, 90);
});

test('department parts: their own status and lead, finished parts left out, the earliest times', () => {
  const e = toBoardEntry(row({
    dispatch_time: null, arrived_timestamp: null, status: 'On Scene',
    departments: [
      { silo: 'MetroFire', status: 'On Scene', dispatched_at: '2026-10-17T09:40:00Z', arrived_at: '2026-10-17T09:55:00Z', lead_name: 'Capt. Dube', assigned_to_name: null },
      { silo: 'Medical', status: 'En Route', dispatched_at: '2026-10-17T09:42:00Z', arrived_at: null, lead_name: null, assigned_to_name: 'Medic Pillay' },
      { silo: 'MetroPolice', status: 'Not needed', dispatched_at: null, arrived_at: null, lead_name: null, assigned_to_name: null },
    ],
  }), now);
  assert.deepEqual(e.departments.map((d) => [d.label, d.status, d.lead]), [['Fire & Rescue', 'On Scene', 'Capt. Dube'], ['EMS', 'En Route', 'Medic Pillay']]);
  assert.equal(e.dispatchedAt, '2026-10-17T09:40:00Z');
  assert.equal(e.onSceneS, 300);
});

test('filters and order: most severe first, then the longest out', () => {
  const entries = [
    toBoardEntry(row({ id: 'low', incident_severity: 'Low', dispatch_time: '2026-10-17T08:00:00Z' }), now),
    toBoardEntry(row({ id: 'crit-new', dispatch_time: '2026-10-17T09:59:00Z' }), now),
    toBoardEntry(row({ id: 'crit-old', dispatch_time: '2026-10-17T09:00:00Z', status: 'On Scene', arrived_timestamp: '2026-10-17T09:10:00Z' }), now),
  ];
  assert.deepEqual(filterBoard(entries, {}).map((e) => e.id), ['crit-old', 'crit-new', 'low']);
  assert.deepEqual(filterBoard(entries, { phase: 'on_scene' }).map((e) => e.id), ['crit-old']);
  assert.equal(filterBoard(entries, { q: 'zulu' }).length, 3, 'by a crew member');
  assert.equal(filterBoard(entries, { q: 'p12' }).length, 3, 'by the code');
  assert.equal(filterBoard(entries, { department: 'MetroFire' }).length, 0);
  assert.equal(filterBoard(entries, { severity: 'Low' })[0]!.id, 'low');
  const c = boardCounts(entries);
  assert.deepEqual([c.total, c.responding, c.onScene, c.critical, c.officers, c.longestOnSceneS], [3, 2, 1, 2, 2, 3000]);
});

test('durations as the clock reads them', () => {
  assert.equal(formatBoardDuration(45), '45s');
  assert.equal(formatBoardDuration(725), '12m 05s');
  assert.equal(formatBoardDuration(3900), '1h 05m');
  assert.equal(formatBoardDuration(null), '—');
});
