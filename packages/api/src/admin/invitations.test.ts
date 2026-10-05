import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeInvitation, invitationActions, staffSearchTerms } from './invitations.ts';

const now = Date.parse('2026-10-03T12:00:00Z');
const base = {
  channel: 'email' as const, expires_at: null, delivery_error: null, invited_by_name: 'Sipho Admin',
  closed_at: null, close_note: null, accepted_at: null, opened_at: null,
};

test('the invitations list says where each one stands', () => {
  assert.deepEqual(describeInvitation({ ...base, status: 'sent', expires_at: '2026-10-06T12:00:00Z' }, now),
    { label: 'Sent', tone: 'info', detail: 'expires in 3 days' });
  assert.equal(describeInvitation({ ...base, status: 'sent', channel: 'code', expires_at: '2026-10-03T15:00:00Z' }, now).label, 'Code issued');
  assert.equal(describeInvitation({ ...base, status: 'sent', expires_at: '2026-10-03T15:00:00Z' }, now).detail, 'expires in 3 hours');
  assert.deepEqual(describeInvitation({ ...base, status: 'sent', expires_at: '2026-10-02T12:00:00Z' }, now),
    { label: 'Expired', tone: 'dim', detail: 'not accepted in time' }, 'past its time, even before the database notices');
  assert.equal(describeInvitation({ ...base, status: 'awaiting_approval' }, now).detail, 'asked by Sipho Admin');
  assert.deepEqual(describeInvitation({ ...base, status: 'ready', delivery_error: 'SMTP refused the sender' }, now),
    { label: 'Not delivered', tone: 'crit', detail: 'SMTP refused the sender' });
  assert.equal(describeInvitation({ ...base, status: 'ready', channel: 'code' }, now).label, 'Ready to print');
  assert.equal(describeInvitation({ ...base, status: 'locked' }, now).tone, 'crit');
  assert.equal(describeInvitation({ ...base, status: 'reported' }, now).label, 'Reported: not me');
});

test('what an administrator can still do', () => {
  assert.deepEqual(invitationActions('sent', 'email'), { send: true, sendLabel: 'Resend', cancel: true });
  assert.deepEqual(invitationActions('ready', 'code'), { send: true, sendLabel: 'Print slip', cancel: true });
  assert.deepEqual(invitationActions('locked', 'code'), { send: true, sendLabel: 'New slip', cancel: true });
  assert.deepEqual(invitationActions('awaiting_approval', 'email'), { send: false, sendLabel: 'Resend', cancel: true });
  for (const final of ['accepted', 'rejected', 'cancelled', 'reported'] as const) {
    const a = invitationActions(final, 'email');
    assert.equal(a.send || a.cancel, false, final);
  }
});

test('a staff search keeps only what a name or badge number holds', () => {
  assert.deepEqual(staffSearchTerms('  Thandeka   Dlamini '), ['Thandeka', 'Dlamini']);
  assert.deepEqual(staffSearchTerms('MP-1042'), ['MP-1042']);
  assert.deepEqual(staffSearchTerms("O'Brien"), ["O'Brien"]);
  assert.deepEqual(staffSearchTerms('Ndlovu,last_name.ilike.*(x)'), ['Ndlovu', 'last', 'name']);
  assert.deepEqual(staffSearchTerms('a b c d'), ['a', 'b', 'c'], 'at most three words');
  assert.deepEqual(staffSearchTerms(' - , * '), [], 'nothing searchable');
  assert.deepEqual(staffSearchTerms('Zwelithini Ñuñez'), ['Zwelithini', 'Ñuñez'], 'letters beyond English are names too');
});
