import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrivalFix, scenesToWatch, type SceneWatch } from './arrival-policy.ts';
import type { TrackPoint } from './track-policy.ts';

const scene: SceneWatch = { incidentId: 'a', lat: -29.8587, lng: 31.0218, since: '2026-10-22T10:00:00.000Z' };
const fix = (t: string, lat: number, lng: number, acc: number | null = 10): TrackPoint => ({ t, lat, lng, acc, spd: null, hdg: null });

test('a fix inside the radius puts the officer on scene at that fix', () => {
  const far = fix('2026-10-22T10:05:00.000Z', -29.87, 31.03);
  const near = fix('2026-10-22T10:09:00.000Z', -29.8590, 31.0220);
  const later = fix('2026-10-22T10:10:00.000Z', -29.8587, 31.0218);
  assert.equal(arrivalFix(scene, [later, far, near])?.t, near.t);
});

test('far away, rough, or before Responding does not count', () => {
  assert.equal(arrivalFix(scene, [fix('2026-10-22T10:05:00.000Z', -29.87, 31.03)]), null);
  assert.equal(arrivalFix(scene, [fix('2026-10-22T10:05:00.000Z', -29.8587, 31.0218, 300)]), null);
  assert.equal(arrivalFix(scene, [fix('2026-10-22T09:50:00.000Z', -29.8587, 31.0218)]), null);
});

test('a faked location never puts the officer on scene', () => {
  assert.equal(arrivalFix(scene, [{ ...fix('2026-10-22T10:05:00.000Z', -29.8587, 31.0218), mock: true }]), null);
});

test('the fix accuracy is allowed for, up to 100 m', () => {
  // About 220 m from the scene, accurate to 90 m: inside 150 m allowing for it.
  assert.ok(arrivalFix(scene, [fix('2026-10-22T10:05:00.000Z', -29.8607, 31.0218, 90)]));
  assert.equal(arrivalFix(scene, [fix('2026-10-22T10:05:00.000Z', -29.8607, 31.0218, 20)]), null);
});

test('queued Responding presses are watched until a later status is queued', () => {
  const queued = [
    { incidentId: 'b', status: 'En Route', occurredAt: '2026-10-22T10:00:00.000Z', scene: { lat: 1, lng: 2 }, incidentNumber: 'ETK-1' },
    { incidentId: 'c', status: 'En Route', occurredAt: '2026-10-22T10:00:00.000Z' },
  ];
  assert.deepEqual(scenesToWatch([scene], queued).map((w) => w.incidentId), ['a', 'b']);
  assert.deepEqual(scenesToWatch([scene], [...queued, { incidentId: 'a', status: 'On Scene', occurredAt: '2026-10-22T10:09:00.000Z' }]).map((w) => w.incidentId), ['b']);
});
