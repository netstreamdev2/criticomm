import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EMS_CHECK_COUNT, EMS_STOCK, EMS_VEHICLE_CHECKS, emsChecklistError, emsCleared, emsFailedVehicle,
  emsOutcome, emsResumeStep, emsShortStock, emsVehicleError, type EmsStock, type EmsVehicleAnswers,
} from './ems-shift.ts';

const vehicle = (): EmsVehicleAnswers => Object.fromEntries(EMS_VEHICLE_CHECKS.map(([key]) => [key, true]));
const stock = (): EmsStock => Object.fromEntries(EMS_STOCK.map(([key]) => [key, true]));

test('the V4 list: five vehicle checks and eight inventory items', () => {
  assert.equal(EMS_VEHICLE_CHECKS.length, 5);
  assert.equal(EMS_STOCK.length, 8);
  assert.equal(EMS_CHECK_COUNT, 13);
});

test('every vehicle check must be answered, with no default yes', () => {
  assert.match(emsVehicleError({}, 'Full') ?? '', /all 5/);
  assert.match(emsVehicleError(vehicle(), null) ?? '', /fuel/);
  assert.match(emsVehicleError(vehicle(), 'anything') ?? '', /fuel/);
  assert.equal(emsVehicleError(vehicle(), '1/4'), null);
  for (const [key, label] of EMS_VEHICLE_CHECKS) {
    const missing = vehicle();
    delete missing[key];
    assert.match(emsVehicleError(missing, 'Full') ?? '', /all 5/, key);
    const failed = { ...vehicle(), [key]: false };
    assert.deepEqual(emsFailedVehicle(failed), [label]);
    assert.equal(emsOutcome(failed, stock(), false), 'off_road');
  }
});

test('stock not ticked is short, needs a note, and keeps the crew off duty', () => {
  assert.deepEqual(emsShortStock({}), EMS_STOCK.map(([, label]) => label));
  for (const [key, label] of EMS_STOCK) {
    const short = { ...stock(), [key]: false };
    assert.deepEqual(emsShortStock(short), [label]);
    assert.match(emsChecklistError(vehicle(), 'Full', short, '', true) ?? '', /missing/);
    assert.equal(emsChecklistError(vehicle(), 'Full', short, 'Restocking from station', true), null);
    assert.equal(emsCleared(vehicle(), short, false), false);
    assert.equal(emsOutcome(vehicle(), short, false), 'stock_short');
  }
});

test('cleaning takes the ambulance off the road even when everything else passes', () => {
  assert.equal(emsCleared(vehicle(), stock(), false), true);
  assert.equal(emsOutcome(vehicle(), stock(), false), 'cleared');
  assert.equal(emsCleared(vehicle(), stock(), true), false);
  assert.equal(emsOutcome(vehicle(), stock(), true), 'off_road');
});

test('the declaration is required and notes have a limit', () => {
  assert.match(emsChecklistError(vehicle(), 'Full', stock(), '', false) ?? '', /yourself/);
  assert.equal(emsChecklistError(vehicle(), 'Full', stock(), '', true), null);
  assert.match(emsChecklistError(vehicle(), 'Full', { ...stock(), oxygen_full: false }, 'x'.repeat(4001), true) ?? '', /4,000/);
});

test('resume never unlocks EMS without readiness and a currently assigned, checked ambulance', () => {
  assert.equal(emsResumeStep({ readiness: false, vehicle: true, hasReadinessRecord: false, hasAmbulance: true }), 'intro');
  assert.equal(emsResumeStep({ readiness: false, vehicle: true, hasReadinessRecord: true, hasAmbulance: true }), 'stood_down');
  assert.equal(emsResumeStep({ readiness: true, vehicle: false, hasReadinessRecord: true, hasAmbulance: false }), 'ambulance');
  assert.equal(emsResumeStep({ readiness: true, vehicle: false, hasReadinessRecord: true, hasAmbulance: true }), 'vehicle');
  assert.equal(emsResumeStep({ readiness: true, vehicle: true, hasReadinessRecord: true, hasAmbulance: false }), 'ambulance');
  assert.equal(emsResumeStep({ readiness: true, vehicle: true, hasReadinessRecord: true, hasAmbulance: true }), 'complete');
});
