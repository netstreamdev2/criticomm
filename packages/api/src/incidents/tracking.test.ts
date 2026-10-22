import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrivalWords, distanceWords, etaMinutes, metresApart, progressAlong, vehicleFor } from './tracking.ts';

test('distance, as the database measures it, in words', () => {
  const scene = { lat: -29.8, lng: 30.9 };
  assert.ok(Math.abs(metresApart(scene, { lat: -29.8 + 1000 / 111195, lng: 30.9 }) - 1000) < 2);
  assert.equal(distanceWords(38.4), '38 m');
  assert.equal(distanceWords(2400), '2.4 km');
  assert.equal(distanceWords(12_600), '13 km');
  assert.equal(distanceWords(null), null);
});

test('progress along the way: never backwards past the start, never at the scene before arriving', () => {
  assert.equal(progressAlong(3000, 1500), 0.5);
  assert.equal(progressAlong(3000, 4000), 0.02, 'went the wrong way: still at the start');
  assert.equal(progressAlong(3000, 0), 0.97, 'only arriving puts them at the scene');
  assert.equal(progressAlong(null, 100), 0.95, 'no start, but right there');
  assert.equal(progressAlong(null, 2000), null);
  assert.equal(progressAlong(3000, null), null);
});

test('ETA by road from the straight line, at the configured speed', () => {
  assert.equal(etaMinutes(4200, 42, 1.35), 8);
  assert.equal(etaMinutes(50), 1, 'never under a minute');
  assert.equal(etaMinutes(null), null);
});

test('how an arrival was recorded, honestly', () => {
  assert.deepEqual(arrivalWords({ arrived_by: 'gps', arrived_verified: true, arrived_distance_m: 38 }), { text: 'GPS ✓ · 38 m from the scene', tone: 'ok' });
  assert.deepEqual(arrivalWords({ arrived_by: 'officer', arrived_verified: false, arrived_distance_m: 3200 }), { text: 'Not verified · 3.2 km away when marked', tone: 'warn' });
  assert.equal(arrivalWords({ arrived_by: 'officer', arrived_verified: false, arrived_distance_m: null })?.text, 'Not verified · no position from the phone');
  assert.equal(arrivalWords({ arrived_by: 'officer', arrived_verified: true, arrived_distance_m: 250 })?.tone, 'ok');
  assert.equal(arrivalWords({ arrived_by: 'desk', arrived_verified: null, arrived_distance_m: null })?.text, 'Marked by dispatch (radio)');
  assert.equal(arrivalWords({ arrived_by: null, arrived_verified: null, arrived_distance_m: null }), null);
});

test('each department its own vehicle colour', () => {
  assert.equal(vehicleFor('MetroPolice').kind, 'car');
  assert.equal(vehicleFor('Medical').tone, '#dc2626');
  assert.equal(vehicleFor('MetroFire').tone, '#ea580c');
  assert.equal(vehicleFor('EthekwiniDisaster').tone, '#ca8a04');
  assert.equal(vehicleFor('nonsense').kind, 'car');
});
