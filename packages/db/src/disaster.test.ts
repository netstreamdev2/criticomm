import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSESSMENT_COUNTS, RELIEF_ITEMS, STANDBY_KIT, assessmentPayload, assessmentProblems, assessmentTotals, hazardFor, kitMissing,
  standbyNumber, standbyProblems,
} from './disaster.ts';

/**
 * The standby officer is reached by phone, and the assessment's figures go to
 * the JOC, the province and the relief lists: the number must be one that can
 * be dialled and the figures whole numbers.
 */

const kitAll = Object.fromEntries(STANDBY_KIT.map((k) => [k.key, true]));

test('the standby number is one the call centre can dial', () => {
  assert.equal(standbyNumber('082 123 4567'), '+27821234567');
  assert.equal(standbyNumber('+27 82 123 4567'), '+27821234567');
  assert.equal(standbyNumber('27821234567'), '+27821234567');
  assert.equal(standbyNumber('1234'), null);
  assert.equal(standbyNumber(''), null);
});

test('standby needs a number and every item of kit answered; a No is recorded, not refused', () => {
  assert.deepEqual(standbyProblems({ number: '0821234567', kit: kitAll }), []);
  assert.deepEqual(standbyProblems({ number: '0821234567', kit: { ...kitAll, torch: false } }), []);
  assert.equal(standbyProblems({ number: 'x', kit: {} }).length, 2);
  assert.deepEqual(kitMissing({ ...kitAll, torch: false, rain_gear: false }), ['Raincoat and boots', 'Torch']);
});

test('an assessment needs the place and what happened; counts are whole numbers', () => {
  assert.deepEqual(assessmentProblems({ place: 'Quarry Road settlement', hazard: 'Flooding' }), []);
  const p = assessmentProblems({ counts: { households_affected: '-3' }, relief: { blankets: '2.5' } });
  assert.deepEqual(p.flatMap((x) => x.keys).sort(), ['blankets', 'hazard', 'households_affected', 'place']);
});

test('people in a shelter need the shelter named', () => {
  assert.match(assessmentProblems({ place: 'Block A', hazard: 'Fire', people_sheltered: '40' }).map((p) => p.message).join(), /hall or shelter/);
  assert.deepEqual(assessmentProblems({ place: 'Block A', hazard: 'Fire', people_sheltered: '40', shelter_name: 'Chesterville Community Hall' }), []);
});

test('the payload is whole numbers and known choices only', () => {
  const p = assessmentPayload({
    place: ' Block A ', hazard: 'Fire', counts: { households_affected: '12', people_displaced: '' },
    relief: { blankets: '30' }, services: ['Electricity', 'Spaceships'], needs: ['Food', 'Shelter'],
  });
  assert.equal(p.place, 'Block A');
  assert.equal(p.households_affected, 12);
  assert.equal(p.people_displaced, 0);
  assert.deepEqual(p.relief, { blankets: 30, mattresses: 0, food_parcels: 0, hygiene_packs: 0, hot_meals: 0 });
  assert.deepEqual(p.services, ['Electricity']);
  assert.deepEqual(p.needs, ['Food', 'Shelter']);
});

test("a call's figures add up every place assessed", () => {
  const t = assessmentTotals([
    { households_affected: 12, people_displaced: 40, homes_destroyed: 5, relief: { blankets: 30 }, people_sheltered: 40 },
    { households_affected: 3, people_displaced: 0, homes_damaged: 3, relief: { blankets: 6, food_parcels: 3 }, people_sheltered: 0 },
  ]);
  assert.equal(t.places, 2);
  assert.equal(t.households_affected, 15);
  assert.equal(t.homes_destroyed, 5);
  assert.equal(t.homes_damaged, 3);
  assert.equal(t.blankets, 36);
  assert.equal(t.food_parcels, 3);
  assert.equal(t.people_sheltered, 40);
  assert.equal(ASSESSMENT_COUNTS.length + RELIEF_ITEMS.length, 13);
});

test('what happened is suggested from the call type', () => {
  assert.equal(hazardFor('Flooding'), 'Flooding');
  assert.equal(hazardFor('Shack fire'), 'Fire');
  assert.equal(hazardFor('Motor Vehicle Accident'), 'Major accident');
  assert.equal(hazardFor('Multi-vehicle pile-up'), 'Major accident');
  assert.equal(hazardFor('Building collapse'), 'Building collapse');
  assert.equal(hazardFor('Chemical spill'), 'Hazardous spill');
  assert.equal(hazardFor('Assault'), null);
});
