import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regionFor } from './durban-regions.ts';

test('the suburb the address search returns decides the region', () => {
  assert.equal(regionFor(null, null, 'Umhlanga Rocks'), 'North');
  assert.equal(regionFor(null, null, 'Chatsworth'), 'South');
  assert.equal(regionFor(null, null, 'Pinetown'), 'West');
  assert.equal(regionFor(null, null, 'Hillcrest'), 'Outer');
  assert.equal(regionFor(null, null, 'Berea'), 'Central');
  assert.equal(regionFor(null, null, "Botha's Hill"), 'Outer');
});

test('without a suburb, the pin decides', () => {
  assert.equal(regionFor(-29.8587, 31.0218), 'Central', 'City Hall');
  assert.equal(regionFor(-29.7262, 31.0848), 'North', 'Gateway, Umhlanga');
  assert.equal(regionFor(-29.9800, 30.9000), 'South', 'Umlazi');
  assert.equal(regionFor(-29.8167, 30.8667), 'West', 'Pinetown');
  assert.equal(regionFor(-29.7820, 30.7660), 'Outer', 'Hillcrest');
});

test('a pin outside eThekwini gets no region, so the call-taker chooses', () => {
  assert.equal(regionFor(-29.6000, 30.3800), null, 'Pietermaritzburg');
  assert.equal(regionFor(-26.2041, 28.0473), null, 'Johannesburg');
  assert.equal(regionFor(null, null), null);
});

test('an unknown suburb falls back to the pin', () => {
  assert.equal(regionFor(-29.8587, 31.0218, 'Somewhere New'), 'Central');
});
