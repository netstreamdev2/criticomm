import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearedForDuty, isDutyRoute } from './duty-policy.ts';

test('the duty screens: calls, their reports, Talk, the map and fines; everything else is open off duty', () => {
  for (const s of [
    ['(tabs)', 'incidents'], ['(tabs)', 'fines'], ['incident', '[id]'], ['my-incidents'], ['report', '[id]'], ['pcr', '[id]'], ['fire-report', '[id]'],
    ['post-mortem', '[id]'], ['route', '[id]'], ['talk'], ['live-map'], ['fines'], ['fines', 'new'],
  ]) assert.equal(isDutyRoute(s), true, s.join('/'));
  for (const s of [
    [], ['(tabs)'], ['(tabs)', 'index'], ['(tabs)', 'shift'], ['(tabs)', 'schedule'], ['(tabs)', 'profile'],
    ['leave'], ['my-performance'], ['alerts'], ['assistant'], ['end-shift'], ['firearm-check'], ['login'], ['activate'],
  ]) assert.equal(isDutyRoute(s), false, s.join('/') || 'home');
});

test('cleared: today’s start of shift on record, and not off duty', () => {
  assert.equal(clearedForDuty(true, true), true);
  assert.equal(clearedForDuty(true, null), true, 'no signal since opening: the record of today stands');
  assert.equal(clearedForDuty(true, false), false, 'went off duty');
  assert.equal(clearedForDuty(false, true), false, 'on duty from yesterday, but today’s check is not done');
  assert.equal(clearedForDuty(null, true), false, 'not known yet');
  assert.equal(clearedForDuty(false, false), false);
});
