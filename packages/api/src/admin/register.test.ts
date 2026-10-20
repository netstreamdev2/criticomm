import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerStatus, rolloutGroups, sharedBadges, type RegisterPerson } from './register.ts';

const person = (over: Partial<RegisterPerson>): RegisterPerson => ({
  id: 'p', first_name: 'Thandeka', last_name: 'Dlamini', badge_number: 'MP-1042', rank: 'Constable', silo: 'MetroPolice',
  station: 'Durban Central', work_email: null, work_cellphone: null, previous_role: null, force_number: null, user_id: null,
  left_at: null, proposed_role: null, role_confirmed_at: null, left_reason: null, left_by_name: null,
  role_confirmed_by_name: null, hr_import_id: null, hr_seen_at: null, created_at: '2026-10-04', invitation: null, account: null,
  ...over,
});

test('where someone stands, in one chip', () => {
  assert.equal(registerStatus(person({})).label, 'No role yet');
  assert.equal(registerStatus(person({ proposed_role: 'Police' })).label, 'Check the role');
  assert.equal(registerStatus(person({ proposed_role: 'Police', role_confirmed_at: 'x' })).key, 'ready');
  const inv = (status: 'sent' | 'opened' | 'locked' | 'expired' | 'ready' | 'awaiting_approval', delivery_error: string | null = null) =>
    person({ invitation: { id: 'i', status, channel: 'email', expires_at: null, delivery_error } });
  assert.equal(registerStatus(inv('sent')).label, 'Invited');
  assert.equal(registerStatus(inv('opened')).label, 'Invitation opened');
  assert.equal(registerStatus(inv('locked')).tone, 'crit');
  assert.equal(registerStatus(inv('ready', 'SMTP refused')).label, 'Not delivered');
  assert.equal(registerStatus(person({ user_id: 'u', account: { role: 'Police', active: true } })).key, 'active');
  assert.equal(registerStatus(person({ user_id: 'u', account: { role: 'Police', active: false } })).key, 'deactivated');
  assert.equal(registerStatus(person({ left_at: 'x', user_id: 'u' })).key, 'left', 'having left outranks everything');
});

test('badges shared by more than one current person', () => {
  const groups = sharedBadges([
    { id: '1', badge_number: 'ME3001', first_name: 'A', last_name: 'A', left_at: null },
    { id: '2', badge_number: 'me 3001', first_name: 'B', last_name: 'B', left_at: null },
    { id: '3', badge_number: 'ME-3001', first_name: 'C', last_name: 'C', left_at: '2026-01-01' },
    { id: '4', badge_number: 'P2006', first_name: 'D', last_name: 'D', left_at: null },
  ]);
  assert.deepEqual(groups.map((g) => g.map((p) => p.id)), [['1', '2']], 'people who have left do not count');
});

test('rollout progress by department and station', () => {
  const groups = rolloutGroups([
    person({ id: '1', user_id: 'u1' }),
    person({ id: '2', invitation: { id: 'i', status: 'sent', channel: 'code', expires_at: null, delivery_error: null } }),
    person({ id: '3' }),
    person({ id: '4', station: null }),
    person({ id: '5', left_at: 'x' }),
    person({ id: '6', silo: 'MetroFire', station: 'Pinetown' }),
  ]);
  assert.deepEqual(groups, [
    { silo: 'MetroFire', station: 'Pinetown', total: 1, active: 0, invited: 0, notInvited: 1 },
    { silo: 'MetroPolice', station: 'Durban Central', total: 3, active: 1, invited: 1, notInvited: 1 },
    { silo: 'MetroPolice', station: 'No station', total: 1, active: 0, invited: 0, notInvited: 1 },
  ]);
});
