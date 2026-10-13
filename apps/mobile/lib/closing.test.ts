import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLOSE_WINDOW_MS, finishOf, finishRank, type ClosingCall } from './closing.ts';

/**
 * The Closed tab offers Close only to the lead, only once the report is
 * filed (or waiting on this phone), and never on a case already closed —
 * the server refuses the rest, so the phone must not offer it.
 */

const me = { userId: 'cop', silo: 'MetroPolice' };
const none = { report: false, close: false };
const NOW = Date.parse('2026-10-13T12:00:00Z');
const part = (extra: Record<string, unknown> = {}) => ({
  silo: 'MetroPolice', status: 'Resolved', lead_id: 'cop', report_filed_at: '2026-10-13T11:00:00Z', ...extra,
});
const call = (p: ReturnType<typeof part> | null, extra: Partial<ClosingCall> = {}): ClosingCall => ({
  status: 'Resolved', departments: p ? [p, { silo: 'MetroFire', status: 'On Scene', lead_id: 'ff', report_filed_at: null }] : [], ...extra,
});

test('the lead closes once the report is filed', () => {
  assert.deepEqual(finishOf(call(part()), me, none, NOW), { kind: 'to_close', reportSending: false });
});

test('backup sees the report filed, never Close', () => {
  assert.deepEqual(finishOf(call(part()), { userId: 'cop2', silo: 'MetroPolice' }, none, NOW), { kind: 'filed' });
});

test('a call still worked by my department is not on the Closed tab', () => {
  assert.equal(finishOf(call(part({ status: 'On Scene', report_filed_at: null }), { status: 'On Scene' }), me, none, NOW), null);
});

test('a report waiting for signal can be closed behind it', () => {
  const live = call(part({ status: 'On Scene', report_filed_at: null }), { status: 'On Scene' });
  assert.deepEqual(finishOf(live, me, { report: true, close: false }, NOW), { kind: 'to_close', reportSending: true });
  assert.deepEqual(finishOf(live, me, { report: true, close: true }, NOW), { kind: 'closing' });
});

test('closed on scene, with who and when', () => {
  const f = finishOf(call(part({ closed_at: '2026-10-13T11:30:00Z', closed_by_name: 'Const. Khumalo' })), me, none, NOW);
  assert.deepEqual(f, { kind: 'closed', at: '2026-10-13T11:30:00Z', by: 'Const. Khumalo' });
});

test('stood down, cancelled and case-closed calls need no Close', () => {
  assert.equal(finishOf(call(part({ status: 'Not needed', report_filed_at: null }), { status: 'Closed' }), me, none, NOW)?.kind, 'not_needed');
  assert.equal(finishOf(call(part({ status: 'Cancelled', report_filed_at: null }), { status: 'Closed' }), me, none, NOW)?.kind, 'cancelled');
  assert.equal(finishOf(call(part(), { status: 'Closed', close_kind: 'Reviewed' }), me, none, NOW)?.kind, 'case_closed');
});

test('Close is offered for a week after the report', () => {
  const old = new Date(NOW - CLOSE_WINDOW_MS - 1000).toISOString();
  assert.deepEqual(finishOf(call(part({ report_filed_at: old })), me, none, NOW), { kind: 'filed' });
});

test('a call from before departments were tracked uses the call itself', () => {
  assert.deepEqual(
    finishOf({ status: 'Resolved', accepted_by: 'cop', report_filed_at: '2026-10-13T11:00:00Z' }, me, none, NOW),
    { kind: 'to_close', reportSending: false },
  );
});

test('still to close comes first', () => {
  assert.ok(finishRank({ kind: 'to_close', reportSending: false }) < finishRank({ kind: 'closed', at: null, by: null }));
  assert.ok(finishRank({ kind: 'closing' }) < finishRank({ kind: 'filed' }));
});
