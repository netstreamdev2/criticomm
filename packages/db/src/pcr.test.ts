import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HOSPITALS, PCR_FIELDS, PCR_SECTIONS, gcsTotal, inventoryShort, pcrPayload, pcrProblems, pcrSignatureRequired, validatePcr,
} from './pcr.ts';

const signed = 'data:image/png;base64,AAAA';
const handover = {
  arrival_time: '14:30', handover_doctor_name: 'Dr Dale Naidoo', handover_patient_status: 'Stable, GCS 15',
  doctor_signature_image_base64: 'data:image/png;base64,BBBB',
};
const minimal = {
  chief_complaint: 'Chest pain', level_of_care: 'ALS', patient_response: 'Improved',
  responder_signature_image_base64: signed,
};

test('the sections follow the old ePCR, keys are unique, and the hospital list is the old one', () => {
  assert.deepEqual(PCR_SECTIONS.map((s) => s.title), [
    'Personal Information', 'Scene & Transport', 'Crew Assignment', 'Hospital Handover',
    'Clinical Assessment & Psychological Presentation', 'Signs, Symptoms & Vitals',
    'Interventions & Medication Administration', 'Vehicle Inventory & Restock Checklist',
  ]);
  const keys = PCR_FIELDS.map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(HOSPITALS.length, 6);
});

test('a complete report has no problems; the missing basics are named', () => {
  assert.deepEqual(validatePcr(minimal), []);
  const problems = pcrProblems({});
  assert.deepEqual(problems.flatMap((p) => p.keys).sort(), [
    'chief_complaint', 'level_of_care', 'patient_response', 'responder_signature_image_base64',
  ]);
});

test('a patient taken by ambulance or air needs a destination; private transport does not', () => {
  assert.match(validatePcr({ ...minimal, transport_mode: 'Ambulance (Ground)' }).join(), /destination/);
  assert.match(validatePcr({ ...minimal, transport_mode: 'HEMS (Airlift)' }).join(), /destination/);
  assert.deepEqual(validatePcr({ ...minimal, transport_mode: 'Private Transport' }), []);
  assert.deepEqual(validatePcr({ ...minimal, transport_mode: 'Ambulance (Ground)', destination_hospital: HOSPITALS[1], ...handover }), []);
});

test('a patient taken to hospital is handed over: time, receiving doctor, condition and the doctor signs', () => {
  const taken = { ...minimal, transport_mode: 'Ambulance (Ground)', destination_hospital: HOSPITALS[1] };
  assert.deepEqual(pcrProblems(taken).flatMap((p) => p.keys).sort(), [
    'arrival_time', 'doctor_signature_image_base64', 'handover_doctor_name', 'handover_patient_status',
  ]);
  assert.deepEqual(validatePcr({ ...taken, ...handover }), []);
  assert.match(validatePcr({ ...taken, ...handover, handover_patient_status: 'x'.repeat(501) }).join(), /too long/);
  // Not taken to hospital: no handover asked for, and none sent.
  assert.deepEqual(validatePcr({ ...minimal, transport_mode: 'Private Transport' }), []);
  const p = pcrPayload({ ...minimal, transport_mode: 'Private Transport', ...handover }, [], false);
  assert.equal(p.handover_doctor_name, undefined);
  assert.equal(p.arrival_time, undefined);
  assert.equal(pcrSignatureRequired('doctor_signature_image_base64', taken), true);
  assert.equal(pcrSignatureRequired('doctor_signature_image_base64', minimal), false);
  assert.equal(pcrSignatureRequired('responder_signature_image_base64', minimal), true);
});

test('times, dates and the pain scale are checked', () => {
  assert.match(validatePcr({ ...minimal, departure_time: '25:00' }).join(), /Depart Scene must be a time/);
  assert.match(validatePcr({ ...minimal, date_of_birth: '1/2/90' }).join(), /Date of Birth must be a date/);
  assert.match(validatePcr({ ...minimal, pain_scale: '11' }).join(), /Pain Scale/);
  assert.deepEqual(validatePcr({ ...minimal, departure_time: '14:05', date_of_birth: '1990-02-01', pain_scale: '7' }), []);
});

test('GCS adds up once all three are scored', () => {
  assert.equal(gcsTotal({ gcs_eye: '4 - Spontaneously', gcs_verbal: '5 - Oriented' }), null);
  assert.equal(gcsTotal({ gcs_eye: '4 - Spontaneously', gcs_verbal: '5 - Oriented', gcs_motor: '6 - Obeys Commands' }), 15);
  assert.equal(gcsTotal({ gcs_eye: '1 - No Eye Opening', gcs_verbal: '0 - Not Testable (Intubated)', gcs_motor: '1 - No Motor Response' }), 2);
});

test('the payload carries ticks, casualties and the cleaning answer, and drops hidden fields', () => {
  const p = pcrPayload(
    { ...minimal, has_insurance: 'No', insurance_information: 'Discovery 123', skin_pale: 'true', inv_oxygen: 'true' },
    [{ name: 'Driver', age: '40', gender: 'Male', triage: 'Red (Immediate)', injuries: 'Head wound' }, { name: '', age: '', gender: '', triage: '', injuries: '' }],
    true,
  );
  assert.equal(p.insurance_information, undefined, 'insurance hidden when No');
  assert.equal(p.skin_pale, 'true');
  assert.equal(p.skin_cool, 'false');
  assert.equal(p.requires_cleaning, 'true');
  assert.deepEqual(JSON.parse(p.secondary_patients_json!), [{ name: 'Driver', age: '40', gender: 'Male', triage: 'Red (Immediate)', injuries: 'Head wound' }]);
  assert.equal(p.responder_signature_image_base64, signed);
});

test('stock not ticked is listed as short', () => {
  const short = inventoryShort({ inv_oxygen: 'true', inv_bvm: true, inv_suction: 'true', inv_iv: 'true', inv_bandages: 'true', inv_aed: 'true', inv_drugs: 'true', inv_sharps: 'true' });
  assert.deepEqual(short, ['Gloves & PPE']);
});

import { pcrReadout } from './pcr.ts';

test('the readout lists answers by section, ticked boxes under their heading, and the GCS total', () => {
  const out = pcrReadout({
    chief_complaint: 'Chest pain', skin_pale: 'true', skin_cool: 'true', protocol_adherence: 'true',
    gcs_eye: '4 - Spontaneously', gcs_verbal: '5 - Oriented', gcs_motor: '6 - Obeys Commands',
    psych_health_risk: 'true', has_insurance: 'No', insurance_information: 'hidden', inv_oxygen: 'true',
  });
  const section = (t: string) => out.find((s) => s.title === t)?.items ?? [];
  assert.deepEqual(section('Signs, Symptoms & Vitals').find((i) => i.label === 'Skin Condition'), { label: 'Skin Condition', value: 'Cool, Pale' });
  assert.deepEqual(section('Signs, Symptoms & Vitals').find((i) => i.label === 'GCS total'), { label: 'GCS total', value: '15 / 15' });
  const assessment = section('Clinical Assessment & Psychological Presentation');
  assert.ok(assessment.some((i) => i.label === 'Psychological Presentation' && i.value.startsWith('Mental/Physical')));
  assert.ok(assessment.some((i) => i.label === 'Protocol Adherence (HPCSA Guidelines Followed)' && i.value === 'Yes'));
  assert.ok(!section('Personal Information').some((i) => i.label === 'Provider & Policy Number'), 'hidden when no insurance');
  assert.deepEqual(section('Vehicle Inventory & Restock Checklist'), [{ label: 'Airway & Breathing', value: 'Oxygen Cylinder (Main & Portable)' }]);
});
