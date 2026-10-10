import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  badgeSignInEmail, departmentsInvitableBy, formatActivationCode, isBadgeSignInEmail, maskEmail, maskPhone,
  normaliseActivationCode, normaliseBadge, passwordAcceptable, passwordChecklist, roleDepartmentProblem, rolesInvitableBy, signInEmailFor,
} from './onboarding.ts';
import { TENANT_WIDE_ROLES } from './roles.ts';

test('badge numbers compare however they are typed', () => {
  assert.equal(normaliseBadge(' mp-1042 '), 'MP1042');
  assert.equal(normaliseBadge('MP 1042'), normaliseBadge('MP-1042'));
  assert.equal(normaliseBadge(null), '');
});

test('staff without email sign in with their badge number', () => {
  assert.equal(badgeSignInEmail('MP-1042'), 'mp1042@ethekwini.badge.internal');
  assert.equal(badgeSignInEmail('mp 1042'), badgeSignInEmail('MP-1042'), 'any way of typing it');
  assert.throws(() => badgeSignInEmail(' - '));
  assert.equal(signInEmailFor('EM-3007'), 'em3007@ethekwini.badge.internal');
  assert.equal(signInEmailFor('  T.Dlamini@Example.org '), 't.dlamini@example.org', 'an email is used as typed');
  assert.ok(isBadgeSignInEmail('em3007@ethekwini.badge.internal'));
  assert.ok(!isBadgeSignInEmail('t.dlamini@example.org'));
});

test('activation codes forgive case, spaces and dashes', () => {
  assert.equal(normaliseActivationCode(' k7q4-m9xp '), 'K7Q4M9XP');
  assert.equal(formatActivationCode('k7q4m9xp'), 'K7Q4-M9XP');
  assert.equal(formatActivationCode('k7q'), 'K7Q');
});

test('who may invite whom', () => {
  assert.ok(rolesInvitableBy('SuperAdmin').includes('SuperAdmin'));
  assert.ok(!rolesInvitableBy('SystemAdmin').includes('SuperAdmin'));
  assert.ok(rolesInvitableBy('SystemAdmin').includes('Admin'));
  for (const wide of TENANT_WIDE_ROLES) assert.ok(!rolesInvitableBy('Admin').includes(wide), wide);
  assert.ok(rolesInvitableBy('Admin').includes('Police'));
  assert.deepEqual(rolesInvitableBy('Supervisor'), []);
  assert.equal(roleDepartmentProblem('Firefighter', 'EthekwiniDisaster'), 'A Firefighter works in Fire & Rescue. Choose a Disaster Management role.');
  assert.equal(roleDepartmentProblem('Disaster', 'EthekwiniDisaster'), null);
  assert.equal(roleDepartmentProblem('Dispatcher', 'EthekwiniDisaster'), null);
  assert.deepEqual(departmentsInvitableBy({ role: 'Admin', silo: 'MetroFire' }), ['MetroFire']);
  assert.equal(departmentsInvitableBy({ role: 'SystemAdmin', silo: 'Ethekwini' }).length, 5);
});

test('a password must be long and must not be the person’s name or badge', () => {
  const about = { name: 'Thandeka Dlamini', badge: 'MP-1042' };
  assert.equal(passwordAcceptable('short', about), false);
  assert.equal(passwordAcceptable('thandeka-rocks-2026', about), false, 'contains the name');
  assert.equal(passwordAcceptable('river-mp1042-stone', about), false, 'contains the badge');
  assert.equal(passwordAcceptable('river-MP-1042-stone', about), false, 'contains the badge, dashed');
  assert.equal(passwordAcceptable('blue-harbour-lantern-9', about), true);
  assert.deepEqual(passwordChecklist('', about).map((c) => c.ok), [false, false, false], 'nothing passes while empty');
});

test('contact details are shown partly hidden before identity is proven', () => {
  assert.equal(maskEmail('t.dlamini@example.org'), 't.•••••••@example.org');
  assert.equal(maskEmail('ab@x.org'), 'ab•••@x.org');
  assert.equal(maskPhone('082 555 4417'), '••• ••• 4417');
  assert.equal(maskEmail(null), '');
});
