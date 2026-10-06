import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIRE_CHECKS, fireChecksPassed, fireChecklistError, fireFailedChecks, fireResumeStep, type FireAnswers } from './fire-shift.ts';

const passed = (): FireAnswers => Object.fromEntries(FIRE_CHECKS.map(([key]) => [key, true]));

test('Fire requires every essential and fire equipment check, with no default yes', () => {
  assert.equal(fireChecksPassed({}), false);
  assert.equal(fireChecksPassed(passed()), true);
  for (const [key, label] of FIRE_CHECKS) {
    const failed = { ...passed(), [key]: false };
    assert.equal(fireChecksPassed(failed), false, key);
    assert.deepEqual(fireFailedChecks(failed), [label]);
    assert.match(fireChecklistError(failed, 'Full', '') ?? '', /Describe/);
    assert.equal(fireChecklistError(failed, 'Full', 'Reported to station officer'), null);
    const missing = passed();
    delete missing[key];
    assert.equal(fireChecksPassed(missing), false, key);
    assert.match(fireChecklistError(missing, 'Full', '') ?? '', /all 11/);
  }
});

test('fuel is recorded explicitly; low fuel is not silently upgraded', () => {
  assert.match(fireChecklistError(passed(), null, '') ?? '', /fuel/);
  assert.match(fireChecklistError(passed(), 'anything', '') ?? '', /fuel/);
  assert.equal(fireChecklistError(passed(), '1/4', ''), null);
  assert.equal(fireChecklistError(passed(), 'Full', ''), null);
});

test('resume never unlocks Fire without readiness and a currently assigned inspected appliance', () => {
  assert.equal(fireResumeStep({ readiness: false, vehicle: true, hasReadinessRecord: false, hasAppliance: true }), 'intro');
  assert.equal(fireResumeStep({ readiness: false, vehicle: true, hasReadinessRecord: true, hasAppliance: true }), 'stood_down');
  assert.equal(fireResumeStep({ readiness: true, vehicle: false, hasReadinessRecord: true, hasAppliance: false }), 'appliance');
  assert.equal(fireResumeStep({ readiness: true, vehicle: false, hasReadinessRecord: true, hasAppliance: true }), 'checks');
  assert.equal(fireResumeStep({ readiness: true, vehicle: true, hasReadinessRecord: true, hasAppliance: false }), 'appliance');
  assert.equal(fireResumeStep({ readiness: true, vehicle: true, hasReadinessRecord: true, hasAppliance: true }), 'complete');
});
