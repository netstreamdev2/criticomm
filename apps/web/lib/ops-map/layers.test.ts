import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  availableLayers, compass, crimeCount, crimeZones, defaultLayers, facilityKind, hasPosition, heatColour,
  isStale, offlineSince, OFFLINE_AFTER_MS, parseFacilities, parseTraffic, restoreLayers, ROUTE_GAP_MS, routeSegments,
  summariseIncidents, type CrimeStation, type RoutePoint,
} from './layers.ts';

const station = (over: Partial<CrimeStation>): CrimeStation => ({
  id: 1, station_name: 'durban central', latitude: -29.85, longitude: 31.02,
  murder: 0, carjacking: 0, burglary_residential: 0, robbery_residential: 0, drug_crime: 0, dui: 0,
  ...over,
});

test('CCTV is offered only to viewers who may open the camera screen', () => {
  assert.ok(availableLayers({ cameras: true }).includes('cameras'));
  assert.ok(!availableLayers({ cameras: false }).includes('cameras'));
  assert.ok(availableLayers({ cameras: false }).includes('crime'));
});

test('each desk opens with the layers its work needs', () => {
  assert.deepEqual(defaultLayers('Police'), ['incidents', 'units', 'zones', 'crime']);
  assert.deepEqual(defaultLayers('FireChief'), ['incidents', 'units', 'zones', 'hydrants']);
  assert.deepEqual(defaultLayers('Disaster'), ['incidents', 'units', 'zones', 'radar', 'shelters'], 'measured rain and the reception centres (0113)');
  assert.deepEqual(defaultLayers('Dispatcher'), ['incidents', 'units', 'zones', 'routes'], 'the desk that sends crews follows where they go');
  assert.deepEqual(defaultLayers('Supervisor'), ['incidents', 'units', 'zones', 'routes']);
  assert.deepEqual(defaultLayers('Viewer'), ['incidents', 'units', 'zones']);
});

test('routes are offered only to the desks and command who oversee crews', () => {
  assert.ok(availableLayers({ cameras: false, routes: true }).includes('routes'));
  assert.ok(!availableLayers({ cameras: false, routes: false }).includes('routes'));
  assert.ok(!availableLayers({ cameras: false }).includes('routes'), 'not unless asked for');
  const officer = availableLayers({ cameras: false });
  assert.deepEqual(restoreLayers(defaultLayers('Dispatcher'), officer, []), ['incidents', 'units', 'zones'], 'a default never grants a layer');
});

test('an officer is offline once their phone has gone quiet for a few minutes', () => {
  const now = Date.parse('2026-10-11T10:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();
  assert.equal(offlineSince({ lastContactAt: ago(60_000), seenAt: ago(60_000) }, now), null);
  assert.equal(offlineSince({ lastContactAt: ago(OFFLINE_AFTER_MS + 1000), seenAt: ago(60_000) }, now), ago(OFFLINE_AFTER_MS + 1000));
  assert.equal(offlineSince({ lastContactAt: null, seenAt: ago(10 * 60_000) }, now), ago(10 * 60_000), 'before 0071: the last position stands in');
  assert.equal(offlineSince({ lastContactAt: 'not a time', seenAt: ago(0) }, now), null);
});

test('a route is drawn as stretches with and without signal, broken only where the phone went quiet', () => {
  const t0 = Date.parse('2026-10-11T08:00:00Z');
  const pt = (min: number, lat: number, offline = false): RoutePoint => ({ at: new Date(t0 + min * 60_000).toISOString(), lat, lng: 31, offline });
  const segs = routeSegments([
    pt(3, -29.83, true), pt(0, -29.80), pt(1, -29.81), pt(2, -29.82, true), pt(4, -29.84),
    pt(4 + ROUTE_GAP_MS / 60_000 + 1, -29.90), pt(25, -29.91), { at: 'bad', lat: -29.9, lng: 31, offline: false },
    { ...pt(26, 0), lng: 0 },
  ]);
  assert.deepEqual(segs.map((s) => [s.offline, s.points.map(([lat]) => lat)]), [
    [false, [-29.8, -29.81]],
    [true, [-29.81, -29.82, -29.83]],
    [false, [-29.83, -29.84]],
    [false, [-29.9, -29.91]],
  ], 'each stretch starts where the last ended; a long silence is a gap; bad points are dropped');
  assert.equal(segs[1]!.from, pt(1, 0).at);
  assert.equal(segs[1]!.to, pt(3, 0).at);
  assert.deepEqual(routeSegments([pt(0, -29.8)]), [], 'one fix is a marker, not a line');
  assert.deepEqual(routeSegments([]), []);
});

test('a saved choice keeps only layers the viewer may still use', () => {
  const available = availableLayers({ cameras: false });
  assert.deepEqual(restoreLayers(['crime', 'cameras', 'nope', 'crime'], available, ['incidents']), ['crime']);
  assert.deepEqual(restoreLayers([], available, ['incidents']), [], 'switching everything off is a choice');
  assert.deepEqual(restoreLayers('garbage', available, ['incidents', 'cameras']), ['incidents']);
});

test('the wall counts SOS apart from the urgent calls and notes calls with no position', () => {
  const row = (source: string, sev: string, lat = -29.8, lng = 31) =>
    ({ source, incident_severity: sev, location_lat: lat, location_lng: lng });
  const s = summariseIncidents([
    row('Responder-Panic', 'Critical'), row('Call', 'Critical'), row('Call', 'High'), row('Call', 'Low', 0, 0),
  ]);
  assert.deepEqual(s, { live: 4, urgent: 2, sos: 1, unplaced: 1 });
});

test('0,0 is not a position', () => {
  assert.equal(hasPosition(0, 0), false);
  assert.equal(hasPosition(null, 31), false);
  assert.equal(hasPosition(-29.8, 31), true);
});

test('crime zones grow by area, rank the worst first and skip stations with no position', () => {
  const zones = crimeZones([
    station({ id: 1, murder: 100 }),
    station({ id: 2, murder: 25 }),
    station({ id: 3, murder: 0 }),
    station({ id: 4, murder: 50, latitude: null }),
  ], 'murder');
  assert.equal(zones.length, 3);
  const [worst, quarter, none] = zones;
  assert.equal(worst!.rank, 1);
  assert.equal(quarter!.rank, 2);
  assert.equal(worst!.share, 1);
  // A quarter of the crime → half the radius span (√0.25).
  assert.equal(quarter!.radius, Math.round(350 + (2600 - 350) * 0.5));
  assert.equal(none!.radius, 350);
  assert.equal(none!.colour, heatColour(0));
});

test('"all" adds the six categories', () => {
  assert.equal(crimeCount(station({ murder: 1, carjacking: 2, burglary_residential: 3, robbery_residential: 4, drug_crime: 5, dui: 6 }), 'all'), 21);
  assert.equal(crimeCount(station({ dui: null }), 'dui'), 0);
});

test('an empty district does not divide by zero', () => {
  const [zone] = crimeZones([station({})], 'all');
  assert.equal(zone!.share, 0);
  assert.equal(zone!.rank, 1);
});

test('heat runs yellow to red and clamps', () => {
  assert.equal(heatColour(0), '#facc15');
  assert.equal(heatColour(1), '#dc2626');
  assert.equal(heatColour(7), '#dc2626');
  assert.equal(heatColour(Number.NaN), '#facc15');
});

test('a position older than a quarter hour is stale', () => {
  const now = Date.parse('2026-10-05T10:00:00Z');
  assert.equal(isStale('2026-10-05T09:50:00Z', now), false);
  assert.equal(isStale('2026-10-05T09:40:00Z', now), true);
  assert.equal(isStale('not a date', now), false);
});

test('wind bearings read as compass points', () => {
  assert.equal(compass(0), 'N');
  assert.equal(compass(44), 'NE');
  assert.equal(compass(350), 'N');
  assert.equal(compass(-90), 'W');
  assert.equal(compass(null), '');
});

test('TomTom facilities are sorted into hospital, police and fire', () => {
  assert.equal(facilityKind(['HOSPITAL_POLYCLINIC']), 'hospital');
  assert.equal(facilityKind(['POLICE_STATION']), 'police');
  assert.equal(facilityKind(['fire station']), 'fire');
  const parsed = parseFacilities({
    results: [
      { id: 'a', poi: { name: 'Addington Hospital', classifications: [{ code: 'HOSPITAL_POLYCLINIC' }] }, position: { lat: -29.86, lon: 31.04 }, address: { freeformAddress: 'Erskine Tce' } },
      { id: 'b', poi: { name: 'Nowhere Hospital', classifications: [{ code: 'HOSPITAL_POLYCLINIC' }] }, position: { lat: 0, lon: 0 } },
    ],
  });
  assert.deepEqual(parsed, [{ id: 'a', name: 'Addington Hospital', kind: 'hospital', lat: -29.86, lng: 31.04, address: 'Erskine Tce' }]);
  assert.deepEqual(parseFacilities({ configured: false }), []);
});

test('only facilities named as the real thing reach the map, each once', () => {
  const at = { lat: -29.86, lon: 31.02 };
  const poi = (id: string, name: string, code: string) => ({ id, poi: { name, classifications: [{ code }] }, position: at });
  const parsed = parseFacilities({
    results: [
      poi('1', 'Kzn Beauty Training Institute', 'HOSPITAL_POLYCLINIC'),
      poi('2', 'Mediclinic Durban', 'HOSPITAL_POLYCLINIC'),
      poi('2v', 'Westville Veterinary Hospital', 'HOSPITAL_POLYCLINIC'),
      poi('3', 'Healthlink', 'POLICE_STATION'),
      poi('4', 'Saps Durban Harbour Police Station', 'POLICE_STATION'),
      poi('5', 'Congela Fire Station', 'FIRE_STATION_BRIGADE'),
      poi('5', 'Congela Fire Station', 'FIRE_STATION_BRIGADE'),
      poi('6', 'Debt Save', 'HEALTH_CARE_SERVICE'),
    ],
  });
  assert.deepEqual(parsed.map((f) => [f.id, f.kind]), [['2', 'hospital'], ['4', 'police'], ['5', 'fire']]);
});

test('TomTom traffic flips coordinates to lat,lng and names the category', () => {
  const parsed = parseTraffic({
    incidents: [
      { geometry: { type: 'Point', coordinates: [31.0, -29.8] }, properties: { iconCategory: 1, events: [{ description: 'Crash' }] } },
      { geometry: { type: 'LineString', coordinates: [[31.0, -29.8], [31.1, -29.9]] }, properties: { iconCategory: 6, events: [] } },
      { geometry: { type: 'Point', coordinates: [] }, properties: {} },
    ],
  });
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed[0]!.points, [[-29.8, 31.0]]);
  assert.equal(parsed[0]!.label, 'Accident');
  assert.equal(parsed[1]!.description, 'Traffic jam');
  assert.equal(parsed[1]!.points.length, 2);
});
