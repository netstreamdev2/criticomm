import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasLocation, toPins, type PinSource } from './map-pins.ts';

const me = { userId: 'me', silo: 'MetroPolice', onDuty: true };
const color = (s: string) => `c:${s}`;

const incident = (over: Partial<PinSource> = {}): PinSource => ({
  id: 'i1',
  silo: 'MetroPolice',
  status: 'Dispatched',
  dispatched_silos: ['MetroPolice'],
  responders: [],
  incident_number: 'INC-1',
  incident_type: 'Armed robbery',
  incident_severity: 'Critical',
  location_address: '12 Smith St',
  location_lat: -29.85,
  location_lng: 31.02,
  dispatch_time: '2026-10-02T08:00:00Z',
  incident_created_at: '2026-10-02T07:58:00Z',
  ...over,
});

test('a pin sits on the coordinates dispatch captured', () => {
  const [pin] = toPins([incident()], me, color);
  assert.equal(pin?.lat, -29.85);
  assert.equal(pin?.lng, 31.02);
  assert.equal(pin?.color, 'c:Critical');
  assert.equal(pin?.sentAt, '2026-10-02T08:00:00Z', 'dispatch time, not logging time');
});

test('incidents without a usable location get no pin', () => {
  assert.equal(hasLocation(0, 0), false, 'intake stores 0,0 for unknown');
  assert.equal(hasLocation(null, 31), false);
  assert.equal(hasLocation(-91, 31), false);
  assert.equal(hasLocation(-29.85, 31.02), true);
  assert.equal(toPins([incident({ location_lat: 0, location_lng: 0 })], me, color).length, 0);
});

test('the card says who holds it; mine is marked', () => {
  const open = toPins([incident()], me, color)[0];
  assert.equal(open?.holder, 'Open — first to respond leads');
  assert.equal(open?.mine, false);

  const assigned = toPins([incident({ assigned_to: 'me' })], me, color)[0];
  assert.equal(assigned?.holder, 'Assigned to you');
  assert.equal(assigned?.mine, true);

  const led = toPins([incident({
    accepted_by: 'a', responders: [{ user_id: 'a', name: 'Sgt Dube', role: 'lead', status: 'En Route' }],
  })], me, color)[0];
  assert.equal(led?.holder, 'Led by Sgt Dube');
});

test('new arrivals are flagged so they drop in', () => {
  const pins = toPins([incident(), incident({ id: 'i2' })], me, color, { fresh: new Set(['i2']) });
  assert.deepEqual(pins.map((p) => p.fresh), [false, true]);
});

test('an officer SOS gets its own pin', () => {
  const pins = toPins([incident({ source: 'Responder-Panic' }), incident({ id: 'i2', source: 'Intake' })], me, color);
  assert.deepEqual(pins.map((p) => p.sos), [true, false]);
});
