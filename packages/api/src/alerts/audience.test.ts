import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audienceGroup, audienceLabel, type AudienceRow } from './audience.ts';

const row = (extra: Partial<AudienceRow>): AudienceRow => ({
  audience: 'person', silo: 'MetroPolice', target_user_id: 'u', target_users: null, target_roles: null, all_departments: false, ...extra,
});

test('whom a notification is for, in words', () => {
  assert.equal(audienceLabel(row({})), 'Just you');
  assert.equal(audienceLabel(row({ audience: 'people', target_users: ['a', 'b'] })), 'You and 1 other');
  assert.equal(audienceLabel(row({ audience: 'people', target_users: ['a', 'b', 'c'] })), 'You and 2 others');
  assert.equal(audienceLabel(row({ audience: 'role', target_roles: ['Admin'] })), 'Metro Police admins');
  assert.equal(audienceLabel(row({ audience: 'role', target_roles: ['Admin', 'Captain'] })), 'Metro Police admins and captains');
  assert.equal(audienceLabel(row({ audience: 'role', target_roles: ['Captain', 'FireChief', 'Admin'], all_departments: true })), 'Captains, fire chiefs and admins in every department');
  assert.equal(audienceLabel(row({ audience: 'department', silo: 'MetroFire' })), 'Fire & Rescue');
  assert.equal(audienceLabel(row({ audience: 'organisation' })), 'Everyone');
});

test('the page’s groups: mine, shared, my department, everyone', () => {
  assert.equal(audienceGroup(row({})), 'mine');
  assert.equal(audienceGroup(row({ audience: 'people', target_users: ['a'] })), 'mine');
  assert.equal(audienceGroup(row({ audience: 'people', target_users: ['a', 'b'] })), 'shared');
  assert.equal(audienceGroup(row({ audience: 'role', target_roles: ['Admin'] })), 'shared');
  assert.equal(audienceGroup(row({ audience: 'department' })), 'department');
  assert.equal(audienceGroup(row({ audience: 'organisation' })), 'everyone');
});

test('a row from before 0084 reads as the migration backfills it', () => {
  const old = (target: string | null) => ({ ...row({ target_user_id: target }), audience: undefined as unknown as AudienceRow['audience'] });
  assert.equal(audienceLabel(old('u')), 'Just you');
  assert.equal(audienceGroup(old('u')), 'mine');
  assert.equal(audienceLabel(old(null)), 'Metro Police');
  assert.equal(audienceGroup(old(null)), 'department');
});
