import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  circleAreaM2, dedupePoints, describeAudience, describeShape, distanceM, formatArea, formatDistance,
  fromGeometry, kindsForShape, pathLengthM, ringAreaM2, ringSelfIntersects, shapeProblem, toGeometry,
  zoneProblem, type LatLng, type ZoneDraft,
} from './zones.ts';

// A square about 100 m on a side near Durban City Hall.
const sq: LatLng[] = [
  { lat: -29.8580, lng: 31.0250 },
  { lat: -29.8580, lng: 31.026034 },
  { lat: -29.859, lng: 31.026034 },
  { lat: -29.859, lng: 31.0250 },
];

const draft = (over: Partial<ZoneDraft> = {}): ZoneDraft => ({
  shape: 'polygon', points: sq, radiusM: null, kind: 'cordon', name: 'Inner cordon', reason: 'Suspect package',
  incidentId: null, visibility: 'department', sharedSilos: [], activeUntil: null, ...over,
});

test('distances and areas are geodesic and close to the truth', () => {
  // One degree of latitude is ~111 km.
  assert.ok(Math.abs(distanceM({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }) - 111_319) < 50);
  const side = distanceM(sq[0]!, sq[1]!);
  assert.ok(Math.abs(side - 100) < 1, `east-west side ${side}`);
  const area = ringAreaM2(sq);
  // ~100 m × ~111 m (0.001° of latitude).
  assert.ok(Math.abs(area - 100 * 111.3) < 150, `area ${area}`);
  assert.ok(Math.abs(pathLengthM(sq, true) - 2 * (100 + 111.3)) < 2);
  assert.equal(Math.round(circleAreaM2(100)), 31416);
});

test('a bow-tie is caught; a square, and a concave shape, are fine', () => {
  assert.equal(ringSelfIntersects(sq), false);
  const bowTie = [sq[0]!, sq[2]!, sq[1]!, sq[3]!];
  assert.equal(ringSelfIntersects(bowTie), true);
  const concave = [sq[0]!, sq[1]!, { lat: -29.8585, lng: 31.0255 }, sq[2]!, sq[3]!];
  assert.equal(ringSelfIntersects(concave), false);
  assert.match(shapeProblem({ shape: 'polygon', points: bowTie, radiusM: null }) ?? '', /cross/);
});

test('a double-click does not leave a doubled corner or a closing duplicate', () => {
  const pts = dedupePoints([sq[0]!, sq[1]!, sq[2]!, sq[2]!, sq[3]!, sq[0]!]);
  assert.equal(pts.length, 4);
});

test('shapes need enough points and a sane radius', () => {
  assert.match(shapeProblem({ shape: 'polygon', points: sq.slice(0, 2), radiusM: null }) ?? '', /three/);
  assert.match(shapeProblem({ shape: 'line', points: [sq[0]!], radiusM: null }) ?? '', /two/);
  assert.match(shapeProblem({ shape: 'circle', points: [sq[0]!], radiusM: 0 }) ?? '', /radius/);
  assert.equal(shapeProblem({ shape: 'circle', points: [sq[0]!], radiusM: 300 }), null);
  assert.match(shapeProblem({ shape: 'point', points: [{ lat: 95, lng: 0 }], radiusM: null }) ?? '', /off the map/);
});

test('a shared zone must say why; a private draft need not', () => {
  assert.match(zoneProblem(draft({ reason: '' })) ?? '', /why/);
  assert.equal(zoneProblem(draft({ reason: '', visibility: 'private' })), null);
  assert.match(zoneProblem(draft({ visibility: 'departments' })) ?? '', /department/);
  assert.equal(zoneProblem(draft({ visibility: 'departments', sharedSilos: ['MetroPolice'] })), null);
  assert.match(zoneProblem(draft({ visibility: 'incident' })) ?? '', /call/);
  assert.match(zoneProblem(draft({ name: '  ' })) ?? '', /name/);
});

test('each type only takes the shapes it makes sense as', () => {
  assert.match(zoneProblem(draft({ kind: 'command_post' })) ?? '', /cannot be drawn/);
  assert.ok(kindsForShape('line').some((k) => k.key === 'road_closure'));
  assert.ok(!kindsForShape('point').some((k) => k.key === 'cordon'));
});

test('the end time must be ahead and within 30 days', () => {
  const now = Date.parse('2026-10-05T10:00:00Z');
  assert.match(zoneProblem(draft({ activeUntil: '2026-10-05T09:00:00Z' }), now) ?? '', /future/);
  assert.match(zoneProblem(draft({ activeUntil: '2026-11-20T09:00:00Z' }), now) ?? '', /30 days/);
  assert.equal(zoneProblem(draft({ activeUntil: '2026-10-05T14:00:00Z' }), now), null);
});

test('GeoJSON goes out longitude-first with the ring closed, and comes back open', () => {
  const g = toGeometry({ shape: 'polygon', points: sq, radiusM: null });
  assert.equal(g.type, 'Polygon');
  const ring = (g.coordinates as number[][][])[0]!;
  assert.equal(ring.length, 5);
  assert.deepEqual(ring[0], [31.025, -29.858]);
  assert.deepEqual(ring[0], ring[4]);
  assert.deepEqual(fromGeometry('polygon', g), sq);
  const c = toGeometry({ shape: 'circle', points: [sq[0]!], radiusM: 250 });
  assert.deepEqual(c, { type: 'Point', coordinates: [31.025, -29.858] });
  assert.deepEqual(fromGeometry('circle', c), [sq[0]]);
  assert.deepEqual(fromGeometry('line', { type: 'Point', coordinates: 'junk' }), []);
});

test('measurements read the way a crew says them', () => {
  assert.equal(formatDistance(850.4), '850 m');
  assert.equal(formatDistance(1240), '1.24 km');
  assert.equal(formatArea(640), '640 m²');
  assert.equal(formatArea(24_000), '2.40 ha');
  assert.equal(formatArea(1_320_000), '1.32 km²');
  assert.match(describeShape({ shape: 'circle', points: [sq[0]!], radiusM: 300 }), /^Radius 300 m · area 28\.27 ha$/);
  assert.equal(describeShape({ shape: 'point', points: [sq[0]!], radiusM: null }), '-29.858000, 31.025000');
});

test('the audience is said in department names', () => {
  const name = (s: string) => ({ MetroFire: 'Fire & Rescue', MetroPolice: 'Metro Police', Medical: 'EMS' }[s] ?? s);
  assert.equal(
    describeAudience({ visibility: 'departments', silo: 'MetroFire', shared_silos: ['MetroPolice', 'Medical'] }, name),
    'Fire & Rescue, Metro Police, EMS and the control room',
  );
  assert.equal(describeAudience({ visibility: 'department', silo: 'Ethekwini', shared_silos: [] }, name), 'The control room');
  assert.equal(
    describeAudience({ visibility: 'departments', silo: 'Ethekwini', shared_silos: ['MetroFire'] }, name),
    'Fire & Rescue and the control room',
  );
  assert.equal(describeAudience({ visibility: 'incident', silo: 'MetroFire', shared_silos: [] }, name, 'INC-7'), 'Everyone on INC-7');
  assert.equal(describeAudience({ visibility: 'private', silo: 'MetroFire', shared_silos: [] }, name), 'Only the person who set it');
});
