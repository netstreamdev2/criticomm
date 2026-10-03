import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  POLICE_REPORT_TYPES, describeReportDetails, getReportType, reportTypeFor, splitReportAnswers,
  validateReportAnswers,
} from './report-types.ts';

/**
 * The incident type picks the officer's report form. A hijacking filed on the
 * general form loses the vehicle and tracker details command circulates, so
 * the matching is part of the record's completeness.
 */

test('the call type picks the specific report', () => {
  const cases: Array<[string, string]> = [
    ['10-31 Hijacking in progress', 'vehicle_crime'],
    ['Stolen vehicle', 'vehicle_crime'],
    ['Armed robbery', 'robbery'],
    ['Assault GBH', 'assault'],
    ['Domestic violence', 'assault'],
    ['Burglary - residential', 'burglary_theft'],
    ['MVA with injuries', 'accident'],
    ['Reckless driving', 'traffic'],
    ['Service delivery protest', 'public_order'],
    ['Shots fired', 'firearm_drugs'],
    ['Suspicious person', 'general'],
  ];
  for (const [type, want] of cases) {
    assert.equal(reportTypeFor({ incident_type: type }).id, want, type);
  }
});

test('the type outranks words in the description', () => {
  const t = reportTypeFor({ incident_type: 'Armed robbery', call_description: 'suspects fled in a stolen vehicle' });
  assert.equal(t.id, 'robbery');
  assert.equal(reportTypeFor({ incident_type: 'Other', call_description: 'car hijacked at the robot' }).id, 'vehicle_crime');
});

test('unknown report ids fall back to the general form', () => {
  assert.equal(getReportType('nope').id, 'general');
  assert.equal(getReportType(null).id, 'general');
});

test('every report requires the narrative and has unique keys', () => {
  for (const t of POLICE_REPORT_TYPES) {
    const keys = t.sections.flatMap((s) => s.fields.map((f) => f.key));
    assert.ok(keys.includes('officer_narrative'), t.id);
    assert.equal(new Set(keys).size, keys.length, `${t.id} has duplicate keys`);
  }
});

test('answers split into whitelisted columns and type details, blanks dropped', () => {
  const t = getReportType('vehicle_crime');
  const { fields, details } = splitReportAnswers(t, {
    license_plate: ' ND 123-456 ', vehicle_colour: 'White', tracking_company: '', officer_narrative: 'x',
    not_on_form: 'ignored',
  });
  assert.deepEqual(fields, { license_plate: 'ND 123-456', officer_narrative: 'x' });
  assert.deepEqual(details, { vehicle_colour: 'White' });
});

test('validation blocks a short narrative and non-numeric numbers', () => {
  const t = getReportType('robbery');
  assert.deepEqual(validateReportAnswers(t, {}), ['Officer narrative is required.']);
  const problems = validateReportAnswers(t, { officer_narrative: 'too short', estimated_value: 'lots' });
  assert.ok(problems.some((p) => p.includes('Estimated value')));
  assert.ok(problems.some((p) => p.includes('20 characters')));
  assert.deepEqual(validateReportAnswers(t, { officer_narrative: 'Arrived to find the complainant unharmed.' }), []);
});

test('details read back with their labels', () => {
  const t = getReportType('accident');
  assert.deepEqual(describeReportDetails(t, { fatalities: '0', injured: '2' }), [
    { label: 'Injured', value: '2' },
    { label: 'Fatalities', value: '0' },
  ]);
});
