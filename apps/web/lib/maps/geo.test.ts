import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areaMiddle, areaRings, pointInArea, wardAt } from './geo.ts';
import { BRIEFING_ROWS, recordRisk } from './records.ts';

/** A past event lands in the right ward, and counts towards the right risk. */

const square = (x: number, y: number, size: number) => [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]];

test('a point is inside an area, and not inside its hole', () => {
  const withHole = { type: 'Polygon', coordinates: [square(30, -30, 1), square(30.4, -29.6, 0.2)] };
  assert.equal(pointInArea(30.1, -29.9, withHole), true);
  assert.equal(pointInArea(30.5, -29.5, withHole), false, 'inside the hole');
  assert.equal(pointInArea(31.5, -29.9, withHole), false);
  const multi = { type: 'MultiPolygon', coordinates: [[square(30, -30, 1)], [square(32, -30, 1)]] };
  assert.equal(pointInArea(32.5, -29.5, multi), true);
  assert.equal(pointInArea(31.5, -29.5, { type: 'Point', coordinates: [31.5, -29.5] }), false);
});

test('the ward holding a point', () => {
  const wards = [
    { geometry: { type: 'Polygon', coordinates: [square(30.9, -29.9, 0.1)] }, properties: { ward: 23 } },
    { geometry: { type: 'Polygon', coordinates: [square(31.0, -29.9, 0.1)] }, properties: { ward: 24 } },
  ];
  assert.equal(wardAt(30.95, -29.85, wards), 23);
  assert.equal(wardAt(31.05, -29.85, wards), 24);
  assert.equal(wardAt(29, -29, wards), null);
});

test('the middle of an area, and its rings for a small map', () => {
  const [lng, lat] = areaMiddle({ type: 'Polygon', coordinates: [[[30, -30], [31, -30], [31, -29], [30, -29]]] })!;
  assert.equal(lng, 30.5);
  assert.equal(lat, -29.5);
  assert.deepEqual(areaRings({ type: 'Polygon', coordinates: [[[30, -30], [31, -30], [31, -29]]] })[0], [[-30, 30], [-30, 31], [-29, 31]]);
});

test('recorded events count towards their top ten risk', () => {
  assert.equal(recordRisk('Flood (Riverine)', 'HEAVY RAIN'), 'Floods');
  assert.equal(recordRisk('Debris flow, mudflow or landslide', 'LANDSLIDE'), 'Landslides');
  assert.equal(recordRisk('Damaging waves', 'HIGH SEAS'), 'Storm surge');
  assert.equal(recordRisk('Windstorm', 'STRONG WINDS'), 'Severe storms');
  assert.equal(recordRisk('Veldfire', 'FIRE'), null, 'a veld fire is not a settlement fire');
  for (const r of BRIEFING_ROWS) assert.ok(r.priority_risk, `${r.event} counts towards a risk`);
  const floods = BRIEFING_ROWS.find((r) => r.source_ref === '2022-floods')!;
  assert.equal(floods.deaths, 390);
  assert.equal(floods.affected, 41448);
});
