import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forDepartment, openParts, partFor, partOpen, partStep, partWords, sortParts, statusForPart, waitingParts, type DepartmentPart } from './parts.ts';

const part = (silo: DepartmentPart['silo'], status: DepartmentPart['status'], extra: Partial<DepartmentPart> = {}): DepartmentPart => ({
  id: `${silo}-part`, tenant_id: 't', incident_id: 'i', silo, status, sent_at: '2026-10-12T08:00:00Z',
  dispatched_at: null, dispatched_by: null, dispatched_by_name: null, assigned_to: null, assigned_to_name: null, assigned_at: null,
  lead_id: null, lead_name: null, accepted_at: null, arrived_at: null, report_filed_at: null,
  finished_at: null, finished_by: null, finished_by_name: null, finish_reason: null,
  closed_at: null, closed_by: null, closed_by_name: null, close_note: null,
  radio_filed_by: null, radio_filed_by_name: null, radioed_by: null, radioed_by_name: null, updated_at: '2026-10-12T08:00:00Z',
  ...extra,
});

const call = {
  status: 'On Scene' as const,
  accepted_by: 'cop', accepted_at: '2026-10-12T08:02:00Z', responding_officer: 'Const. Khumalo',
  assigned_to: null, assigned_to_name: null, report_filed_at: null,
  dispatch_time: '2026-10-12T08:01:00Z', arrived_timestamp: '2026-10-12T08:10:00Z',
  responders: [{ silo: 'MetroPolice', user_id: 'cop' }, { silo: 'MetroFire', user_id: 'ff' }],
  departments: [
    part('MetroPolice', 'Resolved', { lead_id: 'cop', lead_name: 'Const. Khumalo', report_filed_at: '2026-10-12T09:00:00Z' }),
    part('MetroFire', 'En Route', { lead_id: 'ff', lead_name: 'FF Naidoo', accepted_at: '2026-10-12T08:20:00Z', dispatched_at: '2026-10-12T08:15:00Z' }),
    part('Medical', 'Waiting'),
  ],
};

test('a firefighter sees the fire part: their lead, status and crew, not the police report', () => {
  const v = forDepartment(call, 'MetroFire');
  assert.equal(v.status, 'En Route');
  assert.equal(v.accepted_by, 'ff');
  assert.equal(v.responding_officer, 'FF Naidoo');
  assert.equal(v.report_filed_at, null, 'Police filed, Fire has not');
  assert.equal(v.dispatch_time, '2026-10-12T08:15:00Z');
  assert.deepEqual(v.responders, [{ silo: 'MetroFire', user_id: 'ff' }]);
});

test('the police officer sees their part finished; EMS sees it waiting; a department not sent sees nothing to do', () => {
  const p = forDepartment(call, 'MetroPolice');
  assert.equal(p.status, 'Resolved');
  assert.equal(p.report_filed_at, '2026-10-12T09:00:00Z');
  assert.equal(forDepartment(call, 'Medical').status, 'Pending Dispatch');
  const d = forDepartment(call, 'EthekwiniDisaster');
  assert.equal(d.status, 'Pending Dispatch');
  assert.equal(d.accepted_by, null);
  assert.deepEqual(d.responders, []);
});

test('a call read before 0073 is returned as it is', () => {
  const { departments: _, ...old } = call;
  assert.deepEqual(forDepartment(old, 'MetroFire'), old);
});

test('statuses: stood down and cancelled read as closed; a closed call is closed for everyone', () => {
  assert.equal(statusForPart(part('Medical', 'Not needed'), 'On Scene'), 'Closed');
  assert.equal(statusForPart(part('Medical', 'Cancelled'), 'On Scene'), 'Closed');
  assert.equal(statusForPart(part('Medical', 'On Scene'), 'Closed'), 'Closed');
  assert.equal(statusForPart(null, 'Dispatched'), 'Pending Dispatch');
  assert.equal(partOpen('Waiting'), true);
  assert.equal(partOpen('Resolved'), false);
  assert.equal(partStep('On Scene'), 4);
  assert.equal(partStep('Not needed'), null);
});

test('parts read in desk order, in plain words', () => {
  assert.deepEqual(sortParts([part('Medical', 'Waiting'), part('MetroPolice', 'Waiting')]).map((p) => p.silo), ['MetroPolice', 'Medical']);
  assert.equal(partFor(call.departments, 'MetroFire')?.lead_name, 'FF Naidoo');
  assert.deepEqual(openParts(call.departments).map((p) => p.silo), ['MetroFire', 'Medical']);
  assert.equal(partWords(part('Medical', 'Waiting')), 'Waiting to dispatch');
  assert.equal(partWords(part('Medical', 'Dispatched', { assigned_to_name: 'Priya' })), 'Assigned to Priya');
  assert.equal(partWords(part('MetroFire', 'On Scene', { lead_name: 'FF Naidoo' })), 'On Scene · FF Naidoo');
  assert.equal(partWords(part('MetroPolice', 'Resolved')), 'Report filed');
  assert.equal(partWords(part('MetroPolice', 'Resolved', { closed_at: '2026-10-12T09:05:00Z' })), 'Closed on scene');
});

test('a closed part waits on departments still working, or filed and not closed (0074)', () => {
  const parts = [
    part('MetroPolice', 'Resolved', { closed_at: '2026-10-12T09:05:00Z' }),
    part('MetroFire', 'On Scene'),
    part('Medical', 'Resolved'),
    part('EthekwiniDisaster', 'Not needed'),
  ];
  assert.deepEqual(waitingParts(parts, 'MetroPolice').map((p) => p.silo), ['MetroFire', 'Medical']);
  assert.deepEqual(
    waitingParts([part('MetroPolice', 'Resolved'), part('MetroFire', 'Resolved', { closed_at: 'x' }), part('Medical', 'Cancelled')], 'MetroPolice'),
    [],
    'every other department has closed or is done',
  );
  assert.deepEqual(waitingParts([part('MetroFire', 'Waiting')], 'MetroPolice').map((p) => p.silo), ['MetroFire'], 'not dispatched yet');
});
