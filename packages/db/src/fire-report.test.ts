import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIRE_REPORT_FIELDS, fireFieldShown, fireReportPayload, formatDuration, validateFireReport } from './fire-report.ts';

const good = {
  type_of_incident: 'Structure Fire', narrative_summary: 'Contained to the kitchen; one line; ventilated.', fire_cause: 'Accidental',
};

test('a complete fire report has no problems; each required answer is named when missing', () => {
  assert.deepEqual(validateFireReport(good), []);
  assert.deepEqual(validateFireReport({ ...good, type_of_incident: '' }), ['Choose the type of incident.']);
  assert.deepEqual(validateFireReport({ ...good, narrative_summary: 'short' }), ['Write the summary (at least 20 characters).']);
  assert.deepEqual(validateFireReport({ ...good, fire_cause: ' ' }), ['Give the cause, or Under investigation.']);
});

test('casualties need details, as the server insists', () => {
  assert.deepEqual(validateFireReport({ ...good, civilian_injuries: '2' }), ['Describe the injuries.']);
  assert.deepEqual(validateFireReport({ ...good, civilian_injuries: '2', civilian_injury_details: 'Smoke inhalation' }), []);
  assert.deepEqual(validateFireReport({ ...good, firefighter_fatalities: '1' }), ['Describe the fatalities.']);
});

test('follow-up questions show only when their answer calls for them, and only shown answers are filed', () => {
  const rescued = FIRE_REPORT_FIELDS.find((f) => f.key === 'persons_rescued')!;
  const injury = FIRE_REPORT_FIELDS.find((f) => f.key === 'civilian_injury_details')!;
  assert.equal(fireFieldShown(rescued, {}), false);
  assert.equal(fireFieldShown(rescued, { search_and_rescue_performed: 'Yes' }), true);
  assert.equal(fireFieldShown(injury, { civilian_injuries: '0' }), false);
  assert.equal(fireFieldShown(injury, { civilian_injuries: '3' }), true);
  const out = fireReportPayload({ ...good, search_and_rescue_performed: 'No', persons_rescued: '4', hazards_identified: '  wires  ' });
  assert.equal(out.persons_rescued, undefined, 'a hidden answer is not filed');
  assert.equal(out.hazards_identified, 'wires');
  assert.equal(out.search_and_rescue_performed, 'No');
});

test('every key is a firefighter_reports column the server reads', () => {
  const keys = new Set(FIRE_REPORT_FIELDS.map((f) => f.key));
  assert.equal(keys.size, FIRE_REPORT_FIELDS.length, 'no duplicate keys');
  for (const k of ['type_of_incident', 'narrative_summary', 'fire_cause', 'ventilation_type', 'property_value']) assert.ok(keys.has(k));
});

test('durations', () => {
  assert.equal(formatDuration(3900), '1h 05m');
  assert.equal(formatDuration(60), '0h 01m');
  assert.equal(formatDuration(null), '—');
});
