import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestedDesks } from './desks.ts';

test('the incident code picks its dispatch desk', () => {
  assert.deepEqual(suggestedDesks({ category: 'Crime', incidentType: 'Burglary', emsNotRequired: true }), ['MetroPolice']);
  assert.deepEqual(suggestedDesks({ category: 'Traffic', incidentType: 'Traffic Violation', emsNotRequired: true }), ['MetroPolice']);
  assert.deepEqual(suggestedDesks({ category: 'Fire', incidentType: 'Structure Fire', emsNotRequired: true }), ['MetroFire']);
  assert.deepEqual(suggestedDesks({ category: 'Medical', incidentType: 'Cardiac' }), ['Medical']);
  assert.deepEqual(suggestedDesks({ category: 'Disaster', incidentType: 'Flooding', emsNotRequired: true }), ['EthekwiniDisaster']);
});

test('anyone hurt brings EMS in too', () => {
  assert.deepEqual(suggestedDesks({ category: 'Traffic', incidentType: 'Motor Vehicle Accident', victims: 2 }), ['MetroPolice', 'Medical']);
  assert.deepEqual(suggestedDesks({ category: 'Fire', victims: 1, emsNotRequired: true }), ['MetroFire']);
  assert.deepEqual(suggestedDesks({ category: 'Crime', victims: 0 }), ['MetroPolice']);
});

test('a group added under another name goes by its words; nothing is guessed from nothing', () => {
  assert.deepEqual(suggestedDesks({ category: 'Hazardous Materials', incidentType: 'Hazmat spill' }), ['MetroFire']);
  assert.deepEqual(suggestedDesks({ category: 'Animal Control', incidentType: 'Stray dog' }), []);
});
