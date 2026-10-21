import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASSIGNABLE_ROLES, roleFitsDepartment } from '@criticom/db/roles';
import type { Silo } from '@criticom/db';
import { abilitiesFor } from './abilities.ts';
import { boardForModel, callDetailForModel, readModelJson, span, systemPrompt } from './model.ts';
import { DEFAULT_THRESHOLDS, type CritiCrew, type CritiIncident, type CritiMe } from './types.ts';

const NOW = new Date('2026-10-11T10:00:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const me = (role: CritiMe['role'], silo: Silo): CritiMe => ({ userId: 'u', name: 'Naledi', role, silo });
const prompt = (who: CritiMe, canConfirm = true) =>
  systemPrompt({ me: who, thresholds: DEFAULT_THRESHOLDS, abilities: abilitiesFor(who.role), canConfirm });

test('the model is told only the tasks this role may prepare', () => {
  const dispatcher = prompt(me('Dispatcher', 'MetroFire'));
  assert.match(dispatcher, /"kind":"assign_officer"/);
  assert.match(dispatcher, /"kind":"dispatch_all"/);
  assert.doesNotMatch(dispatcher, /"kind":"log_call"/, 'dispatchers do not log calls');
  assert.doesNotMatch(dispatcher, /LOGGING A CALL/);
  assert.match(dispatcher, /FIRE & RESCUE/);
  assert.doesNotMatch(dispatcher, /METRO POLICE\n/, 'a department desk is taught its own department');
  assert.match(dispatcher, /the Fire & Rescue dispatch desk: only calls sent to it/);

  const logger = prompt(me('IncidentLogger', 'Ethekwini'));
  assert.match(logger, /LOGGING A CALL/);
  assert.match(logger, /"kind":"log_call"/);
  assert.doesNotMatch(logger, /"kind":"assign_officer"/);
  for (const dept of ['CONTROL ROOM', 'METRO POLICE', 'FIRE & RESCUE', 'EMS (EMERGENCY MEDICAL SERVICES)', 'DISASTER MANAGEMENT']) {
    assert.ok(logger.includes(dept), `the control room is taught ${dept}`);
  }

  const viewer = prompt(me('Viewer', 'Ethekwini'));
  assert.match(viewer, /Always send "proposals":\[\]/);
  assert.match(viewer, /role does not carry out tasks through you/);

  const phone = prompt(me('Dispatcher', 'Ethekwini'), false);
  assert.match(phone, /This screen cannot carry out tasks/);
  assert.doesNotMatch(phone, /"kind":/);
});

test('every role in every department it fits gets a whole prompt of sensible size', () => {
  const silos: Silo[] = ['Ethekwini', 'MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster'];
  for (const role of ASSIGNABLE_ROLES) {
    for (const silo of silos) {
      if (!roleFitsDepartment(role, silo)) continue;
      const p = prompt(me(role, silo));
      assert.match(p, /REPLY FORMAT/, `${role} in ${silo}`);
      assert.ok(p.length < 16_000, `${role} in ${silo}: ${p.length} characters`);
      assert.doesNotMatch(p, /undefined|\[object Object\]/, `${role} in ${silo}`);
    }
  }
});

test("the model's answer is read as JSON however it was wrapped", () => {
  assert.deepEqual(readModelJson('{"reply":"Hi","proposals":[]}'), { reply: 'Hi', proposals: [] });
  assert.deepEqual(readModelJson('```json\n{"reply":"Fenced"}\n```'), { reply: 'Fenced' });
  assert.deepEqual(readModelJson('Sure! {"reply":"Inside"} Hope that helps.'), { reply: 'Inside' });
  assert.equal(readModelJson('No JSON at all'), null);
  assert.equal(readModelJson('[1,2,3]'), null, 'an array is not a reply');
  assert.equal(readModelJson('{"reply": "cut off'), null);
});

test('the board reads in plain lines', () => {
  const call: CritiIncident = {
    id: 'i1', incident_number: 'INC-20261011-0003', silo: 'Ethekwini', tagged_silos: ['MetroFire', 'Medical'], dispatched_silos: [],
    incident_type: 'Structure Fire', incident_category: 'Fire', incident_severity: 'Critical', status: 'Pending Dispatch',
    source: 'Master', location_address: '7 Chris Hani Rd,   Durban', location_lat: -29.85, location_lng: 31.02,
    caller_name: 'Thandi', caller_number: '+27821234567', call_timestamp: ago(12), incident_created_at: ago(12),
    dispatch_time: null, assigned_to: null, assigned_to_name: null, assigned_at: null, accepted_by: null, accepted_at: null,
    arrived_timestamp: null, responding_officer: null, number_of_victims: 2, medical_type: null, created_by: null, updated_at: ago(12),
  };
  const crew: CritiCrew = {
    userId: 'c1', name: 'Firefighter Dube', badge: 'FF12', silo: 'MetroFire', station: 'Station 4', unitNumber: 'FE-12',
    lat: null, lng: null, seenAt: ago(1), onDutySince: ago(130), busyWith: null, activeCalls: 0,
  };
  const text = boardForModel({ incidents: [call], crews: [crew] }, [], NOW);
  assert.match(text, /CALLS WAITING FOR DISPATCH \(1\):\n- INC-20261011-0003 \| Critical \| Structure Fire \(Fire\) \| 7 Chris Hani Rd, Durban \| waiting 12 min \| desks: Fire & Rescue and EMS \| 2 hurt \| caller Thandi/);
  assert.match(text, /CALLS IN PROGRESS \(0\):\nNone\./);
  assert.match(text, /- Firefighter Dube \(badge FF12\) \| Fire & Rescue \| free \| unit FE-12 \| Station 4 \| on duty 2 h 10 min \| no location/);
  assert.doesNotMatch(text, /MetroFire|Ethekwini/, 'department names, never system words');

  const detail = callDetailForModel(call, { call_description: 'Smoke from the roof', region: 'Central' }, [
    { timestamp: ago(11), message: 'Call logged by Lerato Logger and sent to the Fire & Rescue dispatch desk.', created_by_name: 'Lerato Logger' },
  ], NOW);
  assert.match(detail, /What the caller said: Smoke from the roof/);
  assert.match(detail, /Area: Central region/);
  assert.match(detail, /Timeline:\n {2}\S.* Lerato Logger: Call logged by Lerato Logger/);
  assert.equal(span(ago(3 * 24 * 60), NOW), '3 days');
});

test('Criti is told about an SOS dismissed as a mistake, and that it is no longer an emergency', () => {
  const text = boardForModel({
    incidents: [], crews: [],
    dismissedSos: [{ number: 'MP-20261002-0002', officer: 'Test Officer Two', by: 'Sipho Admin', at: '2026-10-21T08:15:00Z', reason: 'Pressed by mistake' }],
  }, [], NOW);
  assert.match(text, /SOS DISMISSED IN THE LAST 24 HOURS \(no longer emergencies; still on the record\) \(1\)/);
  assert.match(text, /MP-20261002-0002 from Test Officer Two, dismissed by Sipho Admin .*: Pressed by mistake/);
  assert.doesNotMatch(boardForModel({ incidents: [], crews: [] }, [], NOW), /SOS DISMISSED/, 'nothing said when none were dismissed');
});
