import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeRequest, requestExpired } from './accounts.ts';

const base = { user_name: 'Const. Khumalo', from_role: 'Police', to_role: 'Police', from_silo: 'MetroPolice', to_silo: 'MetroPolice' } as const;

test('a request reads as one plain sentence for the approver', () => {
  assert.equal(describeRequest({ ...base, action: 'role', to_role: 'Admin' }), 'Change Const. Khumalo from Police to Admin');
  assert.equal(describeRequest({ ...base, action: 'role', to_role: 'Paramedic', to_silo: 'Medical' }),
    'Change Const. Khumalo from Police to Paramedic in Medical');
  assert.equal(describeRequest({ ...base, action: 'role', to_silo: 'MetroFire' }), 'Move Const. Khumalo from MetroPolice to MetroFire');
  assert.equal(describeRequest({ ...base, action: 'deactivate' }), 'Deactivate Const. Khumalo');
  assert.equal(describeRequest({ ...base, action: 'reactivate', user_name: null }), 'Reactivate this account');
});

test('an open request expires after 7 days', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  assert.equal(requestExpired({ requested_at: '2026-10-04T12:00:00Z' }, now), false, '6 days');
  assert.equal(requestExpired({ requested_at: '2026-10-03T11:59:00Z' }, now), true, 'just over 7 days');
});

test('an invitation request reads plainly too', () => {
  assert.equal(describeRequest({ ...base, action: 'invite', user_name: 'Ayanda Mkhize', to_role: 'Admin', to_silo: 'MetroFire' }),
    'Invite Ayanda Mkhize as Admin in Fire & Rescue');
});
