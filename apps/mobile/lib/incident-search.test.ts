import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDistance, incidentHaystack, matchesQuery } from './incident-search.ts';

const now = new Date('2026-10-08T13:00:00Z');
const call = {
  incident_number: 'INC-POL-0042', incident_type: '10-57 Robbery', incident_severity: 'Critical',
  location_address: '12 Smith Street, Durban', suburb: 'Berea', status: 'Dispatched', at: '2026-10-08T08:00:00Z',
};
const old = { ...call, incident_severity: 'Low', at: '2026-08-05T08:00:00Z' };

test('every word must match: number, type, address, severity, status', () => {
  const h = incidentHaystack(call, now);
  assert.ok(matchesQuery(h, 'pol-0042'));
  assert.ok(matchesQuery(h, 'robbery smith'));
  assert.ok(matchesQuery(h, 'CRITICAL'));
  assert.ok(matchesQuery(h, 'berea dispatched'));
  assert.ok(!matchesQuery(h, 'robbery umlazi'));
  assert.ok(matchesQuery(h, '   '), 'an empty search shows everything');
});

test('the day an incident came in, however it is typed', () => {
  const today = incidentHaystack(call, now);
  assert.ok(matchesQuery(today, 'today'));
  assert.ok(!matchesQuery(today, 'yesterday'));
  const h = incidentHaystack(old, now);
  for (const q of ['05-08-2026', '2026-08-05', '05/08/2026', '5/8/2026', 'low 05-08']) assert.ok(matchesQuery(h, q), q);
  assert.ok(!matchesQuery(h, '06-08-2026'));
});

test('distances read in metres up close and kilometres further out', () => {
  assert.equal(formatDistance(0.004), '10 m');
  assert.equal(formatDistance(0.853), '850 m');
  assert.equal(formatDistance(4.23), '4.2 km');
  assert.equal(formatDistance(23.4), '23 km');
});
