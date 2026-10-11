import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BATCH, fromLocation, KEEP_FOR_MS, metresBetween, stillDeliverable, thin, worthKeeping, type TrackPoint,
} from './track-policy.ts';

const T0 = Date.parse('2026-10-11T08:00:00Z');
const at = (sec: number, lat: number, lng: number, acc: number | null = 5): TrackPoint => ({
  t: new Date(T0 + sec * 1000).toISOString(), lat, lng, acc, spd: null, hdg: null,
});
// About 11 m of latitude per 0.0001°.
const north = (m: number) => -29.85 + m / 111_320;

test('distances are in metres', () => {
  assert.ok(Math.abs(metresBetween({ lat: -29.85, lng: 31.02 }, { lat: north(100), lng: 31.02 }) - 100) < 0.5);
  assert.equal(metresBetween({ lat: 1, lng: 1 }, { lat: 1, lng: 1 }), 0);
});

test('a fix from the phone becomes a point, or nothing', () => {
  const p = fromLocation({ timestamp: T0, coords: { latitude: -29.8512345678, longitude: 31.0212345678, accuracy: 4.56, speed: 13.37, heading: 271.6 } });
  assert.deepEqual(p, { t: '2026-10-11T08:00:00.000Z', lat: -29.851235, lng: 31.021235, acc: 4.6, spd: 13.4, hdg: 272 });
  const unknown = fromLocation({ timestamp: T0, coords: { latitude: -29.85, longitude: 31.02, accuracy: null, speed: -1, heading: -1 } });
  assert.deepEqual([unknown?.acc, unknown?.spd, unknown?.hdg], [null, null, null], 'the phone says -1 for unknown');
  assert.equal(fromLocation({ timestamp: T0, coords: { latitude: 0, longitude: 0 } }), null, 'null island is no fix');
  assert.equal(fromLocation({ timestamp: T0, coords: { latitude: 91, longitude: 31 } }), null);
  assert.equal(fromLocation({ timestamp: Number.NaN, coords: { latitude: -29.85, longitude: 31.02 } }), null);
});

test('a crew on the move is kept every 20 m; a parked unit checks in once a minute', () => {
  const start = at(0, north(0), 31.02);
  assert.equal(worthKeeping(null, start), true, 'the first fix of a shift');
  assert.equal(worthKeeping(start, at(5, north(10), 31.02)), false, 'ten metres is noise');
  assert.equal(worthKeeping(start, at(5, north(25), 31.02)), true);
  assert.equal(worthKeeping(start, at(30, north(2), 31.02)), false, 'parked, half a minute');
  assert.equal(worthKeeping(start, at(60, north(2), 31.02)), true, 'parked, a minute');
  assert.equal(worthKeeping(start, at(0, north(50), 31.02)), false, 'not after the last one in time');
  assert.equal(worthKeeping(start, at(-5, north(50), 31.02)), false);
});

test('rough fixes wait for better ones; glitches are dropped', () => {
  const start = at(0, north(0), 31.02);
  assert.equal(worthKeeping(start, at(30, north(200), 31.02, 150)), false, 'a rough fix while good ones are coming');
  assert.equal(worthKeeping(start, at(150, north(200), 31.02, 150)), true, 'better a rough fix than none for two minutes');
  assert.equal(worthKeeping(start, at(300, north(200), 31.02, 800)), false, 'never a fix worse than 500 m');
  assert.equal(worthKeeping(start, at(10, north(5000), 31.02)), false, '5 km in 10 s is the chip, not the crew');
  assert.equal(worthKeeping(start, at(600, north(5000), 31.02)), true, '5 km in 10 minutes is a drive');
  assert.equal(worthKeeping(null, at(0, north(0), 31.02, 300)), true, 'a rough first fix still gives dispatch a marker');
});

test('a batch is thinned in time order after the last kept fix', () => {
  const prev = at(0, north(0), 31.02);
  const batch = [at(20, north(60), 31.02), at(5, north(5), 31.02), at(10, north(30), 31.02), at(12, north(35), 31.02)];
  assert.deepEqual(thin(prev, batch).map((p) => p.t), [at(10, 0, 0).t, at(20, 0, 0).t]);
  assert.deepEqual(thin(null, []), []);
});

test('only fixes the server still takes are sent', () => {
  const now = T0 + 10 * 3_600_000;
  const points = [
    { ...at(0, -29.8, 31), t: new Date(now - KEEP_FOR_MS - 1000).toISOString() },
    { ...at(0, -29.8, 31), t: new Date(now - 60_000).toISOString() },
    { ...at(0, -29.8, 31), t: new Date(now + 10 * 60_000).toISOString() },
  ];
  assert.deepEqual(stillDeliverable(points, now).map((p) => p.t), [points[1]!.t]);
  assert.ok(BATCH <= 1000, 'the server takes at most 1,000 at a time');
});
