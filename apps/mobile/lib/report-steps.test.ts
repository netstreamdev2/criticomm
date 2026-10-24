import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIRE_REPORT_FIELDS, fireReportPayload } from '@criticom/db/fire-report';
import { PCR_FIELDS, pcrPayload } from '@criticom/db/pcr';
import {
  FIRE_PHOTOS_STEP, PCR_CASUALTIES_STEP, PCR_SIGNOFF_STEP, fireAnswer, fireStepProblems, fireSteps, pcrAnswerPatch,
  pcrExtraKeys, pcrHeading, pcrStepCheck, pcrSteps, pcrWizardAnswers, problemsOn,
} from './report-steps.ts';

const keysOf = (steps: ReturnType<typeof fireSteps>) => steps.flatMap((s) => s.fields.map((f) => f.key));

/* ── Fire ─────────────────────────────────────────────────────────────── */

test('the fire wizard asks the fire report questions by their own keys', () => {
  const all = { search_and_rescue_performed: 'Yes', medical_aid_provided: 'Yes', utilities_secured: 'Yes', fire_investigation_conducted: 'Yes',
    civilian_injuries: '1', civilian_fatalities: '1', firefighter_injuries: '1', firefighter_fatalities: '1' };
  const asked = keysOf(fireSteps(all, 3));
  assert.deepEqual(asked, FIRE_REPORT_FIELDS.map((f) => f.key), 'every question, in order, nothing renamed');
});

test('a fire question tied to another answer shows only when it applies', () => {
  const no = keysOf(fireSteps({ search_and_rescue_performed: 'No', civilian_injuries: '0' }, 1));
  assert.ok(!no.includes('persons_rescued'));
  assert.ok(!no.includes('civilian_injury_details'));
  const yes = keysOf(fireSteps({ search_and_rescue_performed: 'Yes', civilian_injuries: '2' }, 1));
  assert.ok(yes.includes('persons_rescued') && yes.includes('rescue_location'));
  assert.ok(yes.includes('civilian_injury_details'));
});

test('fire choices become chips or a list, counts and amounts become numbers', () => {
  const fields = fireSteps({}, 1).flatMap((s) => s.fields);
  assert.equal(fields.find((f) => f.key === 'type_of_incident')?.kind, 'choice');
  assert.equal(fields.find((f) => f.key === 'civilian_injuries')?.kind, 'number');
  assert.equal(fields.find((f) => f.key === 'damage_estimate')?.kind, 'number');
  assert.equal(fireAnswer('civilian_injuries', '2.5x'), '25');
  assert.equal(fireAnswer('damage_estimate', 'R 1500.50'), '1500.50');
  assert.equal(fireAnswer('narrative_summary', 'R 15'), 'R 15');
});

test('the photos step asks why there are none only when the incident has none', () => {
  const photoStep = (n: number) => fireSteps({}, n).find((s) => s.key === FIRE_PHOTOS_STEP)!;
  assert.deepEqual(photoStep(0).fields.map((f) => f.key), ['no_photo_reason']);
  assert.deepEqual(photoStep(2).fields, []);
});

test('Next on a fire step stops only on that step\'s problems; Done sees them all', () => {
  const answers = { type_of_incident: 'Structure Fire', narrative_summary: 'too short', fire_cause: '' };
  const steps = fireSteps(answers, 0);
  const problems = fireStepProblems(answers, 0);
  const incident = steps.find((s) => s.key === 'incident')!;
  const narrative = steps.find((s) => s.key === 'narrative')!;
  assert.deepEqual(problemsOn(problems, [incident]), []);
  assert.deepEqual(problemsOn(problems, [narrative]).map((p) => p.key), ['narrative_summary']);
  assert.deepEqual(new Set(problemsOn(problems, steps).map((p) => p.key)), new Set(['narrative_summary', 'fire_cause', 'no_photo_reason']));
});

test('the fire payload is unchanged by the wizard: hidden answers still dropped', () => {
  const answers = { type_of_incident: 'Vehicle Fire', search_and_rescue_performed: 'No', persons_rescued: '3' };
  assert.equal(fireReportPayload(answers).persons_rescued, undefined);
});

/* ── Patient report ──────────────────────────────────────────────────── */

test('the patient wizard runs V4\'s sections, casualties after the crew, sign-off last', () => {
  const steps = pcrSteps({ transport_mode: 'Ambulance (Ground)' }).map((s) => s.key);
  assert.deepEqual(steps, ['patient', 'scene', 'crew', PCR_CASUALTIES_STEP, 'handover', 'assessment', 'vitals', 'interventions', 'inventory', PCR_SIGNOFF_STEP]);
});

test('the hospital handover step shows only when the patient is taken to hospital', () => {
  assert.ok(!pcrSteps({ transport_mode: 'Private Transport' }).some((s) => s.key === 'handover'));
  assert.ok(pcrSteps({ transport_mode: 'HEMS (Airlift)' }).some((s) => s.key === 'handover'));
});

test('every patient report answer is asked: plain questions by key, tick boxes inside a run', () => {
  const steps = pcrSteps({ transport_mode: 'Ambulance (Ground)', has_insurance: 'Yes' });
  const asked = new Set(steps.flatMap((s) => s.fields.map((f) => f.key)));
  for (const f of PCR_FIELDS) {
    if (f.kind === 'flag') continue;
    assert.ok(asked.has(f.key), `${f.key} is asked`);
  }
  // Each tick box is reachable: setting every run's every option sets every box.
  const ticked: Record<string, string> = {};
  for (const s of steps) for (const f of s.fields) {
    if (!f.key.startsWith('flags:')) continue;
    Object.assign(ticked, pcrAnswerPatch(f.key, f.kind === 'yesno' ? 'Yes' : (f.options ?? []).join('; ')));
  }
  for (const f of PCR_FIELDS.filter((x) => x.kind === 'flag')) assert.equal(ticked[f.key], 'true', `${f.key} can be ticked`);
});

test('a run of tick boxes is one question, and files as one true/false per box', () => {
  const run = pcrSteps({}).find((s) => s.key === 'vitals')!.fields.find((f) => f.label === 'Skin Condition')!;
  assert.equal(run.kind, 'multi');
  assert.deepEqual(pcrAnswerPatch(run.key, 'Cool; Pale'), {
    skin_unremarkable: 'false', skin_cool: 'true', skin_pale: 'true', skin_diaphoretic: 'false',
    skin_cyanotic: 'false', skin_moist: 'false', skin_flush: 'false', skin_dry: 'false',
  });
  assert.equal(pcrWizardAnswers({ skin_cool: 'true', skin_dry: 'true', skin_pale: 'false' })[run.key], 'Cool; Dry');
});

test('a tick box on its own is a Yes/No', () => {
  const lone = pcrSteps({}).find((s) => s.key === 'assessment')!.fields.find((f) => f.label.startsWith('Protocol Adherence'))!;
  assert.equal(lone.kind, 'yesno');
  assert.deepEqual(pcrAnswerPatch(lone.key, 'Yes'), { protocol_adherence: 'true' });
  assert.deepEqual(pcrAnswerPatch(lone.key, 'No'), { protocol_adherence: 'false' });
  assert.equal(pcrWizardAnswers({ protocol_adherence: 'true' })[lone.key], 'Yes');
  assert.equal(pcrWizardAnswers({})[lone.key], '');
});

test('the patient payload is the same: boxes still file as true/false, no wizard keys', () => {
  const answers = { ...pcrAnswerPatch('flags:inv_oxygen', 'Oxygen Cylinder (Main & Portable)'), age: '40' };
  const payload = pcrPayload(answers, [], false);
  assert.equal(payload.inv_oxygen, 'true');
  assert.equal(payload.inv_bvm, 'false');
  assert.ok(!Object.keys(payload).some((k) => k.startsWith('flags:')));
  assert.equal(pcrAnswerPatch('age', '4o').age, '4');
});

test('the signatures sit on the sign-off step, and Done takes the crew back to them', () => {
  const steps = pcrSteps({});
  const signoff = steps.find((s) => s.key === PCR_SIGNOFF_STEP)!;
  assert.ok(pcrExtraKeys(signoff).includes('responder_signature_image_base64'));
  const answers = { level_of_care: 'BLS', chief_complaint: 'Chest pain', patient_response: 'Improved' };
  assert.deepEqual(pcrStepCheck([signoff], answers).map((p) => p.key), ['responder_signature_image_base64']);
  assert.deepEqual(pcrStepCheck([steps[0]!], answers), []);
});

test('questions keep their V4 headings', () => {
  assert.equal(pcrHeading('chief_complaint'), 'Primary Assessment');
  assert.equal(pcrHeading('level_of_consciousness'), 'Neurological Assessment');
  assert.equal(pcrHeading('mechanism_of_injury'), undefined);
});
