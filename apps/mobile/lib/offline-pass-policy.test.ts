import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkOffline, dropPass, findPass, livePasses, newPass, park, remember, verifierFor, type OfflinePass,
} from './offline-pass-policy.ts';

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 9, 24, 6, 0);
const pass = (userId: string, now = T0, extra: Partial<OfflinePass> = {}) =>
  ({ ...newPass({ userId, name: `Officer ${userId}`, badge: `MP-${userId}`, pin: '482139', salt: `salt-${userId}`, now }), ...extra });

test('a pass checks the PIN with a slow hash tied to the officer, never the PIN itself', () => {
  const p = pass('1042');
  assert.ok(!JSON.stringify(p).includes('482139'));
  assert.equal(p.verifier, verifierFor('482139', '1042', 'salt-1042'));
  assert.notEqual(verifierFor('482139', '1043', 'salt-1042'), p.verifier, 'another officer with the same PIN has another hash');
  assert.equal(p.expiresAt - p.signedInAt, 12 * HOUR, 'one shift');
});

test('a device remembers the newest five officers, one pass each, and forgets expired ones', () => {
  let passes: OfflinePass[] = [];
  for (let i = 1; i <= 7; i++) passes = remember(passes, pass(String(i), T0 + i * 60_000), T0 + i * 60_000);
  assert.deepEqual(passes.map((p) => p.userId), ['7', '6', '5', '4', '3']);
  passes = remember(passes, pass('5', T0 + 10 * 60_000), T0 + 10 * 60_000);
  assert.deepEqual(passes.map((p) => p.userId), ['5', '7', '6', '4', '3'], 'signing in again moves them up, once');
  assert.equal(livePasses(passes, T0 + 13 * HOUR).length, 0, 'all expired after the shift');
});

test('found by id, or by badge however it is typed', () => {
  const passes = [pass('1042'), pass('1043')];
  assert.equal(findPass(passes, { userId: '1043' })?.userId, '1043');
  assert.equal(findPass(passes, { badge: ' mp 1042 ' })?.userId, '1042');
  assert.equal(findPass(passes, { badge: '' }), null);
  assert.equal(findPass(passes, { badge: 'MP-9999' }), null);
});

test('offline: the right PIN takes back the sign-in set aside at hand-over, once', () => {
  const parked = park([pass('1042')], '1042', '{"access_token":"a"}', T0 + HOUR);
  assert.equal(parked.parked, true);
  const { check, passes } = checkOffline(parked.passes, { userId: '1042' }, '482139', T0 + 2 * HOUR);
  assert.equal(check.ok, true);
  assert.equal(check.ok && check.session, '{"access_token":"a"}');
  assert.equal(passes[0]!.session, null, 'in use again, no longer kept aside');
  assert.equal(checkOffline(passes, { userId: '1042' }, '482139', T0 + 2 * HOUR).check.ok, false);
});

test('offline: a right PIN with nothing set aside, an unknown officer and an expired pass do not sign in', () => {
  assert.deepEqual(checkOffline([pass('1042')], { userId: '1042' }, '482139', T0).check, { ok: false, reason: 'no_session' });
  assert.deepEqual(checkOffline([pass('1042')], { userId: '9' }, '482139', T0).check, { ok: false, reason: 'none' });
  const old = park([pass('1042')], '1042', 's', T0).passes;
  const late = checkOffline(old, { userId: '1042' }, '482139', T0 + 12 * HOUR + 1);
  assert.deepEqual(late.check, { ok: false, reason: 'expired' });
  assert.equal(late.passes.length, 0, 'an expired pass is forgotten');
});

test('offline: five wrong PINs and the device forgets the officer; a right one clears the count', () => {
  let passes = park([pass('1042'), pass('1043')], '1042', 's', T0).passes;
  for (const left of [4, 3, 2, 1]) {
    const r = checkOffline(passes, { userId: '1042' }, '000001', T0);
    assert.deepEqual(r.check, { ok: false, reason: 'wrong', triesLeft: left });
    passes = r.passes;
  }
  const fifth = checkOffline(passes, { userId: '1042' }, '000001', T0);
  assert.deepEqual(fifth.check, { ok: false, reason: 'locked' });
  assert.deepEqual(fifth.passes.map((p) => p.userId), ['1043'], 'only that officer is forgotten');

  let again = park([pass('1042')], '1042', 's', T0).passes;
  again = checkOffline(again, { userId: '1042' }, '000001', T0).passes;
  again = checkOffline(again, { userId: '1042' }, '000001', T0).passes;
  assert.equal(again[0]!.failed, 2);
  assert.equal(checkOffline(again, { userId: '1042' }, '482139', T0).passes[0]!.failed, 0);
});

test('hand-over sets a sign-in aside only for an officer with a live pass', () => {
  assert.equal(park([], '1042', 's', T0).parked, false);
  assert.equal(park([pass('1042')], '1042', 's', T0 + 13 * HOUR).parked, false, 'not on an expired pass');
  assert.deepEqual(dropPass([pass('1042'), pass('1043')], '1042').map((p) => p.userId), ['1043']);
});
