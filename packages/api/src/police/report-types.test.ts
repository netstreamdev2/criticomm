import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  POLICE_REPORT_FORMS, composeReportType, describeReportDetails, formIdsOf, getReportType, reportReadout, reportTypeFor,
  rowCount, rowFieldKey, rowsKey, sectionFields, splitReportAnswers, suggestFormsFor, validateReportAnswers,
  CASE_SECTIONS, answeredCount, checkSections, formSections,
} from './report-types.ts';

/**
 * The seven DMPS forms an officer files a call on. A crash filed without its
 * CR1, or an arrest without its 12A, is a report the department sends back.
 */

test("the department's seven forms, in order, with their numbers", () => {
  assert.deepEqual(POLICE_REPORT_FORMS.map((f) => f.code), ['12A', 'CR1', 'VI', '216E', 'SANRAL', '211A', 'DOG']);
  assert.deepEqual(POLICE_REPORT_FORMS.map((f) => f.label), [
    'Arrest Report', 'Crash Report', 'Vehicle Inspection', 'Use of Official Firearm', 'Incident Report', 'Tow In', 'Dog Capture / Tackle',
  ]);
});

test('the call type suggests the form', () => {
  const cases: Array<[string, string]> = [
    ['Robbery', 'arrest'], ['Assault', 'arrest'], ['Burglary', 'arrest'], ['10-31 Hijacking in progress', 'arrest'],
    ['Motor Vehicle Accident', 'accident'], ['Traffic Violation', 'accident'], ['Shots fired', 'firearm'],
    ['Abandoned vehicle', 'tow'], ['Protest', 'incident'], ['Flooding', 'incident'], ['Suspicious person', 'incident'],
  ];
  for (const [type, want] of cases) assert.deepEqual(suggestFormsFor({ incident_type: type }), [want], type);
  assert.deepEqual(suggestFormsFor({ incident_type: 'Other', call_description: 'K9 unit tackled the suspect' }), ['dog']);
  assert.equal(reportTypeFor({ incident_type: 'Robbery' }).id, 'arrest');
});

test('several forms make one report, the case report around them', () => {
  const t = composeReportType(['tow', 'arrest']);
  assert.equal(t.id, 'arrest+tow', "in the department's order, whatever order they were picked");
  assert.equal(t.label, 'Arrest Report · Tow In');
  assert.equal(t.sections[0]?.title, 'Response');
  assert.equal(t.sections.at(-1)?.title, 'Narrative');
  assert.ok(t.sections.some((s) => s.title === '12A · Arrest type'));
  assert.ok(t.sections.some((s) => s.title === '211A · Vehicle details'));
  assert.deepEqual(formIdsOf('arrest+tow'), ['arrest', 'tow']);
  assert.equal(getReportType('arrest+tow').label, 'Arrest Report · Tow In');
  assert.equal(composeReportType([]).id, 'case');
});

test("every form's keys are its own: no two fields collide, and the narrative is always required", () => {
  const t = composeReportType(POLICE_REPORT_FORMS.map((f) => f.id));
  const keys = t.sections.filter((s) => !s.repeat).flatMap((s) => s.fields.map((f) => f.key));
  assert.equal(new Set(keys).size, keys.length, 'duplicate keys across the forms');
  for (const s of t.sections.filter((x) => x.repeat)) {
    const rowKeys = s.fields.map((f) => rowFieldKey(s, 1, f));
    assert.equal(new Set(rowKeys).size, rowKeys.length, `${s.title} has duplicate row keys`);
  }
  assert.ok(keys.includes('officer_narrative'));
  assert.deepEqual(validateReportAnswers(composeReportType([]), {}), ['Officer narrative is required.']);
});

test('repeated sections: two vehicles on a crash report by default, more when added, each its own answers', () => {
  const t = composeReportType(['accident']);
  const drivers = t.sections.find((s) => s.key === 'accident_drivers');
  assert.ok(drivers);
  assert.equal(rowCount(drivers, {}), 2, 'a crash has at least two vehicles');
  const surname = drivers.fields.find((f) => f.key === 'accident_surname');
  assert.ok(surname);
  assert.equal(rowFieldKey(drivers, 2, surname), 'accident_drivers_2_surname');
  assert.equal(rowCount(drivers, { [rowsKey(drivers)]: '3' }), 3);
  assert.equal(rowCount(drivers, { accident_drivers_4_surname: 'Naidoo' }), 4, 'an answered row is never hidden');
  const answers = {
    accident_drivers_1_surname: 'Dlamini', accident_drivers_2_surname: 'Pillay',
    officer_narrative: 'Two vehicles collided at the robot on Smith St.',
  };
  const { details } = splitReportAnswers(t, answers);
  assert.equal(details.accident_drivers_1_surname, 'Dlamini');
  assert.equal(details.accident_drivers_2_surname, 'Pillay');
  const read = reportReadout(t, { details, officer_narrative: answers.officer_narrative });
  assert.ok(read.sections.some((s) => s.title === 'CR1 · Vehicle and driver — Vehicle A' && s.items.some((i) => i.value === 'Dlamini')));
  assert.ok(read.sections.some((s) => s.title === 'CR1 · Vehicle and driver — Vehicle B'));
  assert.equal(sectionFields(drivers, details).length, drivers.fields.length * 2);
  assert.deepEqual(read.extra, []);
});

test('answers split into whitelisted columns and form details, blanks dropped', () => {
  const t = composeReportType(['tow']);
  const { fields, details } = splitReportAnswers(t, {
    arrest_made: 'Yes', tow_reg_no: ' ND 123-456 ', tow_model: '', officer_narrative: 'x', not_on_form: 'ignored',
  });
  assert.deepEqual(fields, { arrest_made: 'Yes', officer_narrative: 'x' });
  assert.deepEqual(details, { tow_reg_no: 'ND 123-456' });
});

test('validation: required form fields, numbers, dates and times, and the narrative', () => {
  const t = composeReportType(['vehicle', 'tow']);
  const problems = validateReportAnswers(t, {
    officer_narrative: 'too short', vehicle_mileage: 'lots', tow_tow_date: '08/10/2026', tow_tow_time: '25:00',
  });
  assert.ok(problems.includes('NDM number is required.'));
  assert.ok(problems.includes('Current mileage (km) must be a number.'));
  assert.ok(problems.includes('Date must be a date (YYYY-MM-DD).'));
  assert.ok(problems.includes('Time of tow must be a time (HH:MM).'));
  assert.ok(problems.includes('Motor vehicle registration No. is required.'));
  assert.ok(problems.some((p) => p.includes('20 characters')));
});

test('reports filed on the retired types still read back with their labels', () => {
  assert.equal(getReportType('not_a_type').id, 'case', 'an unknown type reads as the case report');
  const robbery = getReportType('robbery');
  assert.equal(robbery.label, 'Robbery');
  assert.deepEqual(describeReportDetails(robbery, { estimated_value: '5000' }), [{ label: 'Estimated value (R)', value: '5000' }]);
});

test('an answer no field covers still reads back, under a readable name', () => {
  const t = composeReportType(['arrest']);
  const { extra } = reportReadout(t, { details: { arrest_old_field: 'kept' } });
  assert.deepEqual(extra, [{ label: 'Arrest old field', value: 'kept' }]);
});

test('each form has its own colour, used on the phone, the console and the PDF', () => {
  const tones = POLICE_REPORT_FORMS.map((f) => f.tone);
  assert.equal(new Set(tones).size, POLICE_REPORT_FORMS.length);
  for (const t of tones) assert.match(t, /^#[0-9a-f]{6}$/);
});

test("one form's sections stand alone: prefixed, tagged with the form, as the composed report holds them", () => {
  const tow = formSections('tow');
  assert.ok(tow.length > 0);
  assert.ok(tow.every((s) => s.form === 'tow' && s.title.startsWith('211A · ')));
  const composed = composeReportType(['tow']).sections.filter((s) => s.form === 'tow');
  assert.deepEqual(composed.map((s) => s.title), tow.map((s) => s.title));
  assert.ok(CASE_SECTIONS.every((s) => !s.form), 'the case report is no form');
  assert.deepEqual(formSections('nope'), []);
});

test('a wizard step is checked on its own; the readout says which form a section is from', () => {
  const tow = formSections('tow');
  const missing = checkSections(tow, {});
  assert.ok(missing.some((p) => p.key === 'tow_reg_no' && p.message === 'Motor vehicle registration No. is required.'));
  assert.deepEqual(checkSections(CASE_SECTIONS, { officer_narrative: 'Scene secured and statements taken from both drivers.' }), []);
  const { answered, total } = answeredCount(tow, { tow_reg_no: 'ND 123-456' });
  assert.equal(answered, 1);
  assert.ok(total > 1);
  const { sections } = reportReadout(composeReportType(['tow']), { details: { tow_reg_no: 'ND 123-456' }, officer_narrative: 'x' });
  assert.equal(sections.find((s) => s.items.some((i) => i.value === 'ND 123-456'))?.form, 'tow');
});
