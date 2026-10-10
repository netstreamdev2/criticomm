import { test } from 'node:test';
import assert from 'node:assert/strict';
import { departmentOf, personTitle, wordsFor } from './department.ts';
import { callView, type FieldCall } from './response.ts';
import { describe as describeOp } from './outbox-policy.ts';
import { toPins, type PinSource } from './map-pins.ts';

/**
 * Every department's app says its own words: a paramedic is never called an
 * officer, a Disaster officer never reads about a vehicle or an incident
 * report, and a firefighter's backup note names the fire report.
 */

test('each department is itself; Ethekwini field staff work as police', () => {
  assert.equal(departmentOf('MetroPolice'), 'police');
  assert.equal(departmentOf('Ethekwini'), 'police');
  assert.equal(departmentOf('MetroFire'), 'fire');
  assert.equal(departmentOf('Medical'), 'ems');
  assert.equal(departmentOf('EthekwiniDisaster'), 'disaster');
});

test('who works the call, the report that closes it, the vehicle', () => {
  assert.deepEqual(
    ['MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster'].map((s) => {
      const w = wordsFor(s);
      return [w.person, w.report, w.unit];
    }),
    [
      ['officer', 'incident report', 'vehicle'],
      ['firefighter', 'fire report', 'appliance'],
      ['paramedic', 'patient report', 'ambulance'],
      ['officer', 'post-mortem', null],
    ],
  );
  assert.equal(personTitle('Medical'), 'Paramedic');
  assert.equal(personTitle('MetroFire'), 'Firefighter');
});

test('photos go to a case file for police only', () => {
  assert.equal(wordsFor('MetroPolice').file, 'case file');
  for (const s of ['MetroFire', 'Medical', 'EthekwiniDisaster']) {
    assert.equal(wordsFor(s).file, 'incident record');
    assert.equal(wordsFor(s).media, 'photos');
  }
});

const me = (silo: string) => ({ userId: 'me', silo, onDuty: true });
const ledByOther = (silo: string): FieldCall => ({
  id: 'i1', silo, status: 'En Route', dispatched_silos: [silo],
  responders: [
    { user_id: 'lead', name: null, role: 'lead', status: 'On Scene' },
    { user_id: 'me', name: 'Me', role: 'backup', status: 'On Scene' },
  ],
});

test('backup is told who files, in their own department’s words', () => {
  assert.equal(callView(ledByOther('MetroPolice'), me('MetroPolice')).note,
    'You are backup on this incident — the lead officer files the incident report.');
  assert.equal(callView(ledByOther('MetroFire'), me('MetroFire')).note,
    'You are backup on this incident — the lead firefighter files the fire report.');
  assert.equal(callView(ledByOther('Medical'), me('Medical')).note,
    'You are backup on this incident — the lead paramedic files the patient report.');
  assert.equal(callView(ledByOther('EthekwiniDisaster'), me('EthekwiniDisaster')).note,
    'You are backup on this incident — the lead officer files the post-mortem.');
});

test('a lead with no name is another of the same department', () => {
  const v = callView({ ...ledByOther('Medical'), responders: [{ user_id: 'lead', name: null, role: 'lead', status: 'On Scene' }] }, me('Medical'));
  assert.deepEqual(v.assignment, { kind: 'other', name: 'another paramedic' });
});

test('the sync tray names the SOS and the police report in the department’s words', () => {
  const panic = (silo: 'MetroPolice' | 'MetroFire' | 'Medical' | 'EthekwiniDisaster') =>
    describeOp({ kind: 'panic', silo, lat: null, lng: null, accuracy: null, responderName: 'x' });
  assert.equal(panic('MetroPolice'), 'EMERGENCY — officer needs assistance');
  assert.equal(panic('MetroFire'), 'EMERGENCY — firefighter needs assistance');
  assert.equal(panic('Medical'), 'EMERGENCY — paramedic needs assistance');
  assert.equal(describeOp({ kind: 'incident_report', incidentId: 'i', incidentNumber: 'INC-1', reportType: 'x', fields: {}, details: {} }),
    'Incident report · INC-1');
});

test('an SOS pin says whose emergency it is', () => {
  const sos = (silo: string): PinSource => ({
    id: silo, silo, status: 'Pending', incident_number: 'INC-1', incident_type: 'Emergency', incident_severity: 'Critical',
    location_address: 'Durban', location_lat: -29.85, location_lng: 31.02, dispatch_time: null,
    incident_created_at: '2026-10-10T08:00:00Z', source: 'Responder-Panic',
  });
  const pins = toPins([sos('MetroPolice'), sos('MetroFire'), sos('Medical')], me('MetroFire'), () => '#f00');
  assert.deepEqual(pins.map((p) => p.sosLabel), ['SOS · OFFICER EMERGENCY', 'SOS · FIREFIGHTER EMERGENCY', 'SOS · PARAMEDIC EMERGENCY']);
  const plain = toPins([{ ...sos('MetroFire'), source: 'Intake' }], me('MetroFire'), () => '#f00');
  assert.equal(plain[0]?.sosLabel, null);
});
