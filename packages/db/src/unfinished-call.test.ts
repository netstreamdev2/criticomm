import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finishCallBlock, mayFinishCall, seesAllUnfinished } from './unfinished-call.ts';

const me = (role: string, silo = 'Ethekwini', userId = 'me') => ({ userId, role, silo });
const call = (extra: Partial<{ created_by: string | null; status: string; intake_complete: boolean | null }> = {}) =>
  ({ created_by: 'me', status: 'Pending Dispatch', intake_complete: false, ...extra });

test('the person who logged it finishes it; the control room and administrators may too (as complete_call_intake)', () => {
  assert.equal(mayFinishCall(me('IncidentLogger'), call()), true);
  assert.equal(finishCallBlock(me('IncidentLogger', 'Ethekwini', 'other'), call()), 'not-yours');
  assert.equal(mayFinishCall(me('ControlRoom', 'Ethekwini', 'other'), call()), true, 'the control room');
  assert.equal(finishCallBlock(me('ControlRoom', 'MetroPolice', 'other'), call()), 'not-yours', 'a department desk is not the control room');
  assert.equal(mayFinishCall(me('Admin', 'Ethekwini', 'other'), call()), true);
  assert.equal(finishCallBlock(me('Admin', 'MetroFire', 'other'), call()), 'not-yours');
  assert.equal(mayFinishCall(me('SystemAdmin', 'MetroPolice', 'other'), call()), true);
  assert.equal(finishCallBlock(me('Dispatcher', 'MetroPolice'), call()), 'role', 'a dispatcher edits before dispatch instead');
  assert.equal(finishCallBlock(me('Police', 'MetroPolice'), call()), 'role');
});

test('only while it is unfinished and still open', () => {
  assert.equal(finishCallBlock(me('IncidentLogger'), call({ intake_complete: true })), 'finished');
  assert.equal(finishCallBlock(me('IncidentLogger'), call({ intake_complete: null })), 'finished', 'before 0076 every call counts as complete');
  assert.equal(finishCallBlock(me('IncidentLogger'), call({ status: 'Resolved' })), 'closed');
  assert.equal(finishCallBlock(me('ControlRoom'), call({ status: 'Closed', created_by: 'x' })), 'closed');
  assert.equal(mayFinishCall(me('IncidentLogger'), call({ status: 'On Scene' })), true, 'crews on the way: details still go in');
});

test('who sees every unfinished call, not just their own', () => {
  assert.equal(seesAllUnfinished(me('ControlRoom')), true);
  assert.equal(seesAllUnfinished(me('IncidentLogger')), false);
  assert.equal(seesAllUnfinished(me('ControlRoom', 'MetroPolice')), false);
  assert.equal(seesAllUnfinished(me('SuperAdmin', 'MetroFire')), true);
});
