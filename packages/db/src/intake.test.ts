import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INCIDENT_CATALOGUE, INJURY_TYPES, MED_PRIORITIES, catalogueType, draftDescription, intakeAdvice, maxSeverity,
  searchInjuries, searchTypes, topPriority, typeMeta, withoutAnswered, type IntakeState,
} from './intake.ts';
import { DESK_SILOS } from './desks.ts';

const blank: IntakeState = {
  incidentType: null, group: null, injuries: [], victims: null, isCallerPatient: null,
  callerName: '', phoneOk: false, description: '', hasPin: false, region: '', severity: null,
  medPriority: '', emsNotRequired: false, targets: [],
};

test('the catalogue is well formed: unique names, known departments, injuries that exist', () => {
  const names = new Set<string>();
  for (const c of INCIDENT_CATALOGUE) {
    assert.ok(!names.has(c.name.toLowerCase()), `${c.name} once`);
    names.add(c.name.toLowerCase());
    assert.ok(c.name.length <= 100);
    assert.ok(c.departments.length > 0 && c.departments.every((d) => DESK_SILOS.includes(d)), `${c.name} departments`);
    for (const inj of c.injuries ?? []) assert.ok(INJURY_TYPES.some((x) => x.name === inj), `${c.name}: ${inj} is an injury`);
    if (c.departments.includes('Medical')) assert.ok(c.medical || c.name === 'Murder / body found', `${c.name} with EMS is medical`);
  }
  for (const x of INJURY_TYPES) assert.ok(MED_PRIORITIES.includes(x.priority), `${x.name} code`);
  // The original 10-codes keep their names, so existing calls still match.
  for (const name of ['Assault', 'Robbery', 'Burglary', 'Motor Vehicle Accident', 'Traffic Violation', 'Structure Fire',
    'Veld/Wildland Fire', 'Cardiac', 'Trauma', 'Protest', 'Flooding']) assert.ok(catalogueType(name), name);
});

test('the type search finds what people say: gun, heart, shack, knife', () => {
  const types = INCIDENT_CATALOGUE.map((c) => ({ name: c.name, group: c.group, code: null }));
  const first = (q: string) => searchTypes(types, q).map((x) => x.name);
  assert.ok(first('gun').slice(0, 2).includes('Shooting / gunshot wound'));
  assert.ok(first('gun').includes('Armed robbery'));
  assert.ok(first('heart').includes('Heart attack / chest pain'));
  assert.ok(first('shack').includes('Informal settlement fire'));
  assert.ok(first('knife').includes('Stabbing'));
  assert.deepEqual(first('heart attack')[0], 'Heart attack / chest pain', 'words in order rank first');
  assert.equal(first('zzzz').length, 0);
  assert.equal(first('').length, types.length);
  assert.ok(searchInjuries('shot').some((x) => x.name === 'Gunshot wound'));
});

test('a type the administrator added falls back on its group', () => {
  assert.deepEqual(typeMeta('Cable theft', 'Crime').departments, ['MetroPolice']);
  assert.deepEqual(typeMeta('Hospital transfer', 'Medical'), { code: null, departments: ['Medical'], severity: null, medical: true, keywords: [], injuries: [], details: [] });
  assert.deepEqual(typeMeta('Shooting / gunshot wound', 'Crime').departments, ['MetroPolice', 'Medical']);
});

test('a shooting: Police and EMS, Critical, P1, the right questions, ready to send early once placed', () => {
  const s = { ...blank, incidentType: 'Shooting / gunshot wound', group: 'Crime', injuries: ['Gunshot wound'] };
  let a = intakeAdvice(s);
  assert.equal(a.medical, true);
  assert.deepEqual(a.departments, ['MetroPolice', 'Medical']);
  assert.equal(a.severity, 'Critical');
  assert.equal(a.priority, MED_PRIORITIES[0]);
  assert.equal(a.ask[0], 'Is the shooter still there?');
  assert.ok(a.ask.length <= 4);
  assert.equal(a.canSendEarly, false, 'no pin, no department yet');
  assert.deepEqual(a.earlyMissing, ['Location on the map', 'Department']);

  a = intakeAdvice({ ...s, hasPin: true, targets: ['MetroPolice', 'Medical'] });
  assert.equal(a.canSendEarly, true, 'Criti’s Critical counts until the call taker chooses');
  assert.ok(a.missing.includes('Caller name') && a.missing.includes('Is the caller the patient?'));

  a = intakeAdvice({ ...s, hasPin: true, targets: ['MetroPolice'], severity: 'Medium' });
  assert.equal(a.canSendEarly, false, 'the call taker chose Medium: no early send');
  assert.deepEqual(a.earlyMissing, ['High or Critical severity']);
});

test('a burglary is not medical until someone is hurt; then EMS is suggested', () => {
  const s = { ...blank, incidentType: 'Burglary', group: 'Crime' };
  let a = intakeAdvice(s);
  assert.equal(a.medical, false);
  assert.deepEqual(a.departments, ['MetroPolice']);
  assert.ok(!a.missing.includes('Is the caller the patient?'), 'no patient question');
  a = intakeAdvice({ ...s, injuries: ['Head injury'] });
  assert.equal(a.medical, true);
  assert.deepEqual(a.departments, ['MetroPolice', 'Medical']);
  assert.equal(a.severity, 'High', 'the injury raises it');
  a = intakeAdvice({ ...s, victims: 2 });
  assert.ok(a.departments.includes('Medical'));
  a = intakeAdvice({ ...s, victims: 2, emsNotRequired: true });
  assert.ok(!a.departments.includes('Medical') && !a.medical, 'no injuries switched on');
});

test('the full form lists exactly what is missing', () => {
  const a = intakeAdvice({
    ...blank, incidentType: 'Burglary', group: 'Crime', callerName: 'Thabo', phoneOk: true, description: 'Glass breaking',
    hasPin: true, region: 'Central', severity: 'High', targets: ['MetroPolice'],
  });
  assert.deepEqual(a.missing, []);
});

test('severity and codes: the highest wins, a death is P4 only when nobody else is hurt', () => {
  assert.equal(maxSeverity('Low', null, 'High', 'Medium'), 'High');
  assert.equal(maxSeverity(), null);
  assert.equal(topPriority(['Cuts and bruises', 'Gunshot wound']), MED_PRIORITIES[0]);
  assert.equal(topPriority(['Deceased']), MED_PRIORITIES[3]);
  assert.equal(topPriority(['Deceased', 'Head injury']), MED_PRIORITIES[1]);
  assert.equal(topPriority(['Not a real injury']), null);
});

test('the drafted description reads plainly', () => {
  assert.equal(
    draftDescription({ injuries: ['Gunshot wound', 'Severe bleeding'], victims: 1, isCallerPatient: false }),
    'Gunshot wound and severe bleeding. 1 person hurt, not the caller.',
  );
  assert.equal(draftDescription({ injuries: [], victims: 5, isCallerPatient: true, incidentType: 'Bus or taxi crash' }),
    'Bus or taxi crash. 5 or more people hurt, including the caller.');
  assert.equal(draftDescription({ injuries: [], victims: null, isCallerPatient: true }), 'The caller is the patient.');
  assert.equal(draftDescription({ injuries: [], victims: null, isCallerPatient: null }), '');
});

test('Criti does not ask again what the form already holds', () => {
  const asks = [
    'How many patients are there?', 'Is anyone hurt?', 'Is the caller the patient?', 'Is the shooter still there?',
    'Is the shooter still at the scene?', 'Where was the person shot?',
  ];
  assert.deepEqual(
    withoutAnswered(asks, { victims: 2, isCallerPatient: false, injuries: [], patientsNamed: 0 }),
    ['Is the shooter still there?', 'Where was the person shot?'],
  );
  assert.deepEqual(
    withoutAnswered(['How many people are hurt?', 'What are the patients names?'], { victims: null, isCallerPatient: null, injuries: [], patientsNamed: 1 }),
    [],
    'patients named at the top count',
  );
  assert.deepEqual(
    withoutAnswered(['How many people are hurt?', 'Is the caller the patient?'], { victims: null, isCallerPatient: null, injuries: [], patientsNamed: 0 }),
    ['How many people are hurt?', 'Is the caller the patient?'],
    'still asked while not known',
  );
});
