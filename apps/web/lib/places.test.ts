import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kindSearchWord, parsePlaceQuery, placeKindLabel, widenName } from './places.ts';

test('well-known eThekwini names widen to the name on the map', () => {
  assert.equal(widenName('Gateway'), 'Gateway Theatre of Shopping');
  assert.equal(widenName('gateway mall'), 'Gateway Theatre of Shopping');
  assert.equal(widenName('  pavilion  '), 'Pavilion Shopping Centre');
  assert.equal(widenName('KED'), 'King Edward VIII Hospital');
  assert.equal(widenName('the ICC'), 'Inkosi Albert Luthuli International Convention Centre');
  // Anything else stays as typed.
  assert.equal(widenName('12 Smith Street'), '12 Smith Street');
  assert.equal(widenName('Gateway Road'), 'Gateway Road');
});

test('"near" splits what from where, and names the kind of place', () => {
  assert.deepEqual(parsePlaceQuery('Engen near Pavilion'), { what: 'Engen', near: 'Pavilion Shopping Centre', kind: 'amenity:fuel', around: null, asked: 'Engen' });
  assert.deepEqual(parsePlaceQuery('the garage next to the Gateway'), { what: 'garage', near: 'Gateway Theatre of Shopping', kind: 'amenity:fuel', around: null, asked: 'garage' });
  assert.deepEqual(parsePlaceQuery('taxi rank opposite Durban Station'), { what: 'taxi rank', near: 'Durban Station', kind: 'amenity:bus_station', around: null, asked: 'taxi rank' });
  assert.deepEqual(parsePlaceQuery('Spar close to Umlazi Mega City'), { what: 'Spar', near: 'Umlazi Mega City', kind: 'shop:supermarket', around: null, asked: 'Spar' });
});

test('a plain search is widened but has no "near"', () => {
  assert.deepEqual(parsePlaceQuery('Gateway'), { what: 'Gateway Theatre of Shopping', near: null, kind: null, around: null, asked: null });
  assert.deepEqual(parsePlaceQuery('  45   Florida Road '), { what: '45 Florida Road', near: null, kind: null, around: null, asked: null });
});

test('a kind of place beside a name is looked for around that name', () => {
  assert.deepEqual(parsePlaceQuery('South Beach taxi rank'), { what: 'South Beach taxi rank', near: null, kind: 'amenity:bus_station', around: 'South Beach', asked: 'taxi rank' });
  assert.equal(parsePlaceQuery('taxi rank in Umlazi').around, 'Umlazi');
  assert.equal(parsePlaceQuery('Engen Umlazi').around, 'Umlazi');
  assert.equal(parsePlaceQuery('the Shell in Pinetown').around, 'Pinetown');
  assert.equal(parsePlaceQuery('the Shell in Pinetown').asked, 'Shell');
  assert.equal(parsePlaceQuery('the clinic at KED').around, 'King Edward VIII Hospital');
  // The kind alone has nothing around it.
  assert.equal(parsePlaceQuery('Engen').around, null);
  assert.equal(parsePlaceQuery('taxi rank').around, null);
});

test('place kinds read as plain words', () => {
  assert.equal(placeKindLabel('amenity', 'fuel'), 'Fuel station');
  assert.equal(placeKindLabel('shop', 'mall'), 'Shopping centre');
  assert.equal(placeKindLabel('shop', 'hardware'), 'Shop');
  assert.equal(placeKindLabel('amenity', 'social_facility'), 'Social facility');
  assert.equal(placeKindLabel('highway', 'residential'), null);
  assert.equal(placeKindLabel(undefined, 'fuel'), null);
  assert.equal(kindSearchWord('amenity:fuel'), 'fuel');
  assert.equal(kindSearchWord('amenity:bus_station'), 'taxi rank');
  assert.equal(kindSearchWord(null), null);
});
