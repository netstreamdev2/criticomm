import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INCIDENT_CATALOGUE, INCIDENT_GROUPS, SAPS_CATEGORIES, askField, catalogueType, composeDescription, injuriesFor,
  intakeAdvice, sapsCategories, type IntakeState,
} from './intake.ts';
import { DETAIL_FIELDS, clauseFields, cleanDetails, detailLines, questionKind, renderClause } from './intake-details.ts';
import { departmentPrefix, formatIncidentNumber, isIncidentNumber } from './incident-number.ts';

/** V4's 52 codes (Data/ConfigSeeder.cs). Every one is in the catalogue. */
const V4_CODES = [
  '10-33', '10-32', '10-31', '10-34', '10-89', '10-90', '10-98',
  '10-50', '10-50 PI', '10-50 PD', '10-50 F', '10-55', '10-57', '10-80', '10-94', '10-46', '10-51',
  '10-53', '10-93', '10-92', '10-47', '10-48', '10-49', '10-58',
  '10-11', '10-11A', '10-11B', '10-11C', '10-11D', '10-11E', '10-45', '10-54',
  '10-10', '10-16', '10-15', '10-14', '10-37', '10-38', '10-99',
  '10-70', '10-71', '10-73', '10-25',
  '10-52', '10-56', '10-96', '10-79',
  '10-17', '10-21', '10-59', '10-91', '10-78',
];

test('every V4 code is here, our own codes are ours, and each code means one thing', () => {
  assert.equal(V4_CODES.length, 52);
  const codes = INCIDENT_CATALOGUE.map((c) => c.code);
  for (const v of V4_CODES) assert.ok(codes.includes(v), `${v} is in the catalogue`);
  for (const c of INCIDENT_CATALOGUE) {
    if (c.code.startsWith('10-')) assert.ok(V4_CODES.includes(c.code), `${c.name}: ${c.code} is one of V4's`);
    else assert.match(c.code, /^(CR|TR|FI|ME|PO|DI)-\d{2}$/, `${c.name}: our code`);
  }
  // Only V4's gas leak / hazmat code is shared, by our two types it covers.
  const shared = codes.filter((x, i) => codes.indexOf(x) !== i);
  assert.deepEqual([...new Set(shared)], ['10-25']);
  assert.equal(INCIDENT_CATALOGUE.length, 123);
});

test('every type is filed under a group, and every detail, question and sentence it names exists', () => {
  const groups = INCIDENT_GROUPS.map(([g]) => g);
  for (const c of INCIDENT_CATALOGUE) {
    assert.ok(groups.includes(c.group), `${c.name}: group ${c.group}`);
    for (const d of c.details) assert.ok(DETAIL_FIELDS[d], `${c.name}: detail ${d}`);
    for (const a of c.asks) if (a.field) assert.ok(DETAIL_FIELDS[a.field], `${c.name}: question field ${a.field}`);
    assert.ok(c.opening.length > 0, `${c.name}: has a first sentence`);
    for (const op of c.opening) {
      for (const f of clauseFields(op)) assert.ok(f === 'who' || DETAIL_FIELDS[f], `${c.name}: ${f} in "${op}"`);
    }
    // The last first sentence always reads, whatever is known.
    assert.ok(renderClause(c.opening[c.opening.length - 1]!, {}, { who: '' }), `${c.name}: a sentence with nothing known`);
    for (const s of c.saps) assert.ok(SAPS_CATEGORIES.includes(s), `${c.name}: ${s} is a SAPS category`);
  }
  for (const f of Object.values(DETAIL_FIELDS)) {
    for (const id of clauseFields(f.clause)) assert.equal(id, f.id, `${f.id}'s sentence names itself`);
  }
});

test('a burglary reads as the caller tells it', () => {
  const details = { premises: 'A home', taken: ['Cellphone', 'TV'], suspectThere: 'No' };
  assert.equal(
    composeDescription({ incidentType: 'Burglary', details, injuries: [], victims: null, isCallerPatient: null }),
    'Break-in at a home. A cellphone and a TV taken. The suspects have left.',
  );
  // Nothing known yet: the plain first sentence.
  assert.equal(composeDescription({ incidentType: 'Burglary', injuries: [], victims: null, isCallerPatient: null }), 'Break-in.');
  assert.deepEqual(sapsCategories('Burglary', details), ['Burglary at residential premises']);
  assert.deepEqual(sapsCategories('Burglary', { premises: 'A shop' }), ['Burglary at non-residential premises']);
  assert.deepEqual(sapsCategories('Burglary'), ['Burglary at residential premises', 'Burglary at non-residential premises']);
  assert.deepEqual(sapsCategories('Protest'), []);
});

test('an assault names who was hurt, and "Not known" leaves a sentence out', () => {
  assert.equal(
    composeDescription({
      incidentType: 'Assault', details: { suspectCount: '2', weapons: 'Knife', suspectThere: 'Not known' },
      injuries: ['Head injury'], victims: 1, isCallerPatient: true,
    }),
    'The caller was assaulted. Two suspects. Armed with a knife. Head injury. 1 person hurt, including the caller.',
  );
  assert.equal(
    composeDescription({ incidentType: 'Assault', details: { hurt: 'No' }, injuries: [], victims: null, isCallerPatient: false }),
    'A person was assaulted. No one is hurt.',
  );
});

test('questions are tied to their details, and an answered question is not asked again', () => {
  assert.equal(askField('Burglary', 'Are the suspects still inside?'), 'suspectThere');
  assert.equal(askField('Admin type', 'Is anyone home?'), 'occupantsHome', 'the same question on a type of their own');
  assert.equal(askField('Burglary', 'A question of their own?'), null);
  const s: IntakeState = {
    incidentType: 'Burglary', group: 'Crime', injuries: [], victims: null, isCallerPatient: null, callerName: '',
    phoneOk: false, description: '', hasPin: false, region: '', severity: null, medPriority: '', emsNotRequired: false, targets: [],
  };
  assert.deepEqual(intakeAdvice(s).ask, ['Are the suspects still inside?', 'Is anyone home?']);
  assert.deepEqual(intakeAdvice({ ...s, details: { suspectThere: 'Yes' } }).ask, ['Is anyone home?']);
  // "Is anyone hurt?" answered Yes: EMS's questions apply.
  const hurt = intakeAdvice({ ...s, details: { hurt: 'Yes' } });
  assert.equal(hurt.medical, true);
  assert.ok(hurt.departments.includes('Medical'));
});

test('the injuries that fit the type come first', () => {
  assert.deepEqual(injuriesFor('Assault').slice(0, 2).map((x) => x.name), ['Head injury', 'Cuts and bruises']);
  assert.equal(injuriesFor('Shooting / gunshot wound')[0]!.name, 'Gunshot wound');
  assert.equal(injuriesFor('House fire')[0]!.name, 'Burns');
  assert.equal(injuriesFor('A type of their own', 'Fire')[0]!.name, 'Burns', 'from the group');
  assert.equal(injuriesFor('Burglary').length, 27, 'every injury is still there');
});

test('only allowed answers are kept', () => {
  assert.deepEqual(
    cleanDetails({
      premises: 'A home', taken: ['TV', 'A spaceship', 'Cellphone'], suspectThere: 'Maybe', direction: '  towards   the rank ',
      nonsense: 'x', 'q:Are shots being fired?': 'Yes', 'q:Is it a bad answer?': 'Perhaps',
    }),
    { premises: 'A home', taken: ['Cellphone', 'TV'], direction: 'towards the rank', 'q:Are shots being fired?': 'Yes' },
  );
  assert.deepEqual(cleanDetails(null), {});
  assert.deepEqual(cleanDetails(['a']), {});
  assert.equal((cleanDetails({ suspectLooks: 'x'.repeat(500) }).suspectLooks as string).length, 200);
  assert.deepEqual(detailLines({ taken: ['Cellphone', 'TV'], 'q:Are shots being fired?': 'Yes' }, catalogueType('Burglary')!.details), [
    { label: 'What was taken', value: 'Cellphone, TV' },
    { label: 'Are shots being fired?', value: 'Yes' },
  ]);
});

test('the incident number: departments in pairs, South African date and time, the number of the day', () => {
  assert.equal(departmentPrefix(['MetroPolice']), 'MP');
  assert.equal(departmentPrefix(['MetroFire', 'MetroPolice']), 'MPFD', 'always in the same order');
  assert.equal(departmentPrefix(['MetroPolice', 'MetroFire', 'Medical']), 'MPFD-MD');
  assert.equal(departmentPrefix(['EthekwiniDisaster', 'Medical', 'MetroFire', 'MetroPolice']), 'MPFD-MDDM');
  assert.equal(departmentPrefix(['MetroFire', 'Medical']), 'FDMD');
  assert.equal(departmentPrefix(['MetroPolice', 'Medical', 'EthekwiniDisaster']), 'MPMD-DM');
  assert.equal(departmentPrefix(['Medical']), 'MD');
  assert.equal(departmentPrefix(['Ethekwini']), 'CR');
  // 09:15 UTC is 11:15 in South Africa; 22:30 UTC is the next day there.
  assert.equal(formatIncidentNumber(['MetroPolice'], new Date('2026-10-10T09:15:00Z'), 34), 'MP-20261010-1115-0034');
  assert.equal(formatIncidentNumber(['MetroPolice', 'MetroFire', 'Medical'], new Date('2026-10-10T22:30:00Z'), 1), 'MPFD-MD-20261011-0030-0001');
  assert.equal(formatIncidentNumber(['Medical'], new Date('2026-10-10T09:15:00Z'), 12345), 'MD-20261010-1115-12345', 'never cut short');
  for (const n of ['MP-20261010-1115-0034', 'MPFD-MDDM-20261010-1115-0034', 'INC-20261013-0004', 'CR-20261010-1115-0002']) {
    assert.ok(isIncidentNumber(n), n);
  }
  for (const n of ['MPX-20261010-1115-0034', 'MP-2026101-1115-0034', 'hello']) assert.ok(!isIncidentNumber(n), n);
});

test('a question is answered as it asks: yes or no, or in a few words', () => {
  assert.equal(questionKind('Is the bleeding heavy?'), 'yesno');
  assert.equal(questionKind('Can the person speak?'), 'yesno');
  assert.equal(questionKind('Where was the person shot?'), 'text');
  assert.equal(questionKind('How many are trapped, and where?'), 'text');
  assert.equal(questionKind('Cancer patient, how long?'), 'text', 'a whole word only');
  // Every question a type asks that is not tied to a detail is one or the other, and "where" never gets Yes / No.
  for (const c of INCIDENT_CATALOGUE) {
    for (const q of c.prompts) {
      if (askField(c.name, q)) continue;
      if (/^(where|what|which|how|when|who|why|from)\b/i.test(q)) assert.equal(questionKind(q), 'text', q);
    }
  }
  assert.deepEqual(cleanDetails({ 'q:Where was the person shot?': '  in the leg ', 'q:Is the bleeding heavy?': 'Maybe', 'q:Can the person speak?': 'No' }),
    { 'q:Where was the person shot?': 'in the leg', 'q:Can the person speak?': 'No' });
});
