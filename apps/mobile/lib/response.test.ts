import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityOf, callView, nextStep, photosRemaining, pickActivity, type FieldCall } from './response.ts';

/**
 * The officer's ladder decides when a call can be closed. A police call that
 * could be marked Resolved without its report would leave command with no
 * record of what happened — the server refuses it, so the phone must never
 * offer it.
 */

const police = { silo: 'MetroPolice' };
const routedToPolice = { silo: 'Ethekwini', dispatched_silos: ['MetroPolice'] };
const fire = { silo: 'MetroFire' };

test('police calls go en route, on scene, then report', () => {
  assert.deepEqual(nextStep(police, 'Dispatched'), { kind: 'status', status: 'En Route', label: 'Accept · Mark En Route' });
  assert.deepEqual(nextStep(police, 'En Route'), { kind: 'arriving', status: 'On Scene', label: 'On scene is marked when you arrive' });
  assert.equal(nextStep(police, 'On Scene')?.kind, 'report');
  assert.equal(nextStep(routedToPolice, 'On Scene')?.kind, 'report', 'routed from the control room');
});

test('police calls are never offered a bare Resolved', () => {
  for (const s of ['Dispatched', 'En Route', 'Arrived', 'On Scene', 'Transporting'] as const) {
    const step = nextStep(police, s);
    assert.ok(!(step?.kind === 'status' && step.status === 'Resolved'), s);
  }
});

test('nothing is left once the report is filed or the call is closed', () => {
  assert.equal(nextStep({ ...police, report_filed_at: '2026-10-01T10:00:00Z' }, 'On Scene'), null);
  assert.equal(nextStep(police, 'Resolved'), null);
  assert.equal(nextStep(fire, 'Closed'), null);
});

test('other services keep the full ladder', () => {
  assert.deepEqual(nextStep(fire, 'En Route'), { kind: 'arriving', status: 'Arrived', label: 'On scene is marked when you arrive' });
  assert.deepEqual(nextStep(fire, 'Transporting'), { kind: 'status', status: 'Resolved', label: 'Mark Resolved' });
});

test('the photo allowance counts queued photos and never goes negative', () => {
  assert.equal(photosRemaining(0, 0), 10);
  assert.equal(photosRemaining(7, 2), 1);
  assert.equal(photosRemaining(10, 3), 0);
});

test('home activity follows the open call', () => {
  const call = (status: Parameters<typeof nextStep>[1] | null) => ({ id: 'i1', incident_number: 'INC-1', status });
  assert.deepEqual(activityOf(null, false), { kind: 'idle' });
  assert.deepEqual(activityOf(null, true), { kind: 'idle' }, 'no call, nothing to report on');
  assert.equal(activityOf(call('En Route'), false).kind, 'en_route');
  assert.equal(activityOf(call(null), false).kind, 'en_route', 'accepted offline, status not back yet');
  assert.equal(activityOf(call('Arrived'), false).kind, 'on_scene');
  assert.equal(activityOf(call('On Scene'), false).kind, 'on_scene');
  assert.equal(activityOf(call('Transporting'), false).kind, 'transporting');
  assert.deepEqual(activityOf(call('On Scene'), true), { kind: 'reporting', incidentId: 'i1', incidentNumber: 'INC-1' });
});

test('the most pressing of several calls shows on home', () => {
  const calls = [
    { id: 'a', incident_number: 'INC-A', status: 'En Route' as const },
    { id: 'b', incident_number: 'INC-B', status: 'On Scene' as const },
  ];
  assert.equal(pickActivity([], () => false).kind, 'idle');
  assert.deepEqual(pickActivity(calls, () => false), { kind: 'on_scene', incidentId: 'b', incidentNumber: 'INC-B' });
  assert.equal(pickActivity(calls, (id) => id === 'a').kind, 'reporting', 'a report outranks being on scene');
});

/* ── Lead and backup (migration 0042) ─────────────────────────────────── */

const me = { userId: 'me', silo: 'MetroPolice', onDuty: true };
const sent: FieldCall = { id: 'i1', silo: 'MetroPolice', status: 'Dispatched', dispatched_silos: ['MetroPolice'], responders: [] };

test('a call sent to all, nobody responding: I can respond and would lead', () => {
  const v = callView(sent, me);
  assert.equal(v.assignment.kind, 'open');
  assert.deepEqual(v.action, { kind: 'respond', asLead: true, label: 'Accept' });
  assert.equal(v.role, null);
});

test('assigned to me: I lead; assigned to someone else: I can back up', () => {
  const toMe = callView({ ...sent, assigned_to: 'me' }, me);
  assert.equal(toMe.assignment.kind, 'you');
  assert.deepEqual(toMe.action, { kind: 'respond', asLead: true, label: 'Accept' });

  const toOther = callView({ ...sent, assigned_to: 'a', assigned_to_name: 'Sgt Dube' }, me);
  assert.deepEqual(toOther.assignment, { kind: 'other', name: 'Sgt Dube' });
  assert.deepEqual(toOther.action, { kind: 'respond', asLead: false, label: 'Accept' });
});

test('assigned to me works even outside my department', () => {
  const v = callView({ ...sent, dispatched_silos: ['MetroFire'], assigned_to: 'me' }, me);
  assert.equal(v.action?.kind, 'respond');
});

test('not sent to my department, or not sent yet: view only', () => {
  assert.equal(callView({ ...sent, dispatched_silos: ['MetroFire'] }, me).action, null);
  assert.equal(callView({ ...sent, status: 'Pending Dispatch' }, me).action, null);
});

test('off duty: the button shows but is blocked', () => {
  const v = callView(sent, { ...me, onDuty: false });
  assert.equal(v.action?.kind, 'respond');
  assert.ok(v.blocked);
});

test('the lead works the ladder; backup marks on scene and stops', () => {
  const lead = callView({
    ...sent, status: 'En Route', accepted_by: 'me',
    responders: [{ user_id: 'me', name: 'Me', role: 'lead', status: 'En Route' }],
  }, me);
  assert.equal(lead.role, 'lead');
  assert.deepEqual(lead.action, { kind: 'arriving', status: 'On Scene', label: 'On scene is marked when you arrive' });
  assert.equal(callView({ ...sent, status: 'On Scene', accepted_by: 'me' }, me).action?.kind, 'report');

  const withBackup: FieldCall = {
    ...sent, status: 'On Scene', accepted_by: 'a',
    responders: [
      { user_id: 'a', name: 'Sgt Dube', role: 'lead', status: 'On Scene' },
      { user_id: 'me', name: 'Me', role: 'backup', status: 'En Route' },
    ],
  };
  const backup = callView(withBackup, me);
  assert.equal(backup.role, 'backup');
  assert.equal(backup.myStatus, 'En Route', "my own status, not the lead's");
  assert.deepEqual(backup.action, { kind: 'arriving', status: 'On Scene', label: 'On scene is marked when you arrive' });
  assert.equal(backup.backups.length, 1);

  const arrived = callView(withBackup, me, 'On Scene');
  assert.equal(arrived.action, null);
  assert.ok(arrived.note);
});

test("responding offline counts at once, under the server's lead rule", () => {
  assert.equal(callView(sent, me, 'En Route').role, 'lead');
  assert.equal(callView({ ...sent, accepted_by: 'a' }, me, 'En Route').role, 'backup');
});

test('a closed call offers nothing', () => {
  assert.equal(callView({ ...sent, status: 'Resolved' }, me).action, null);
});

test('assigned and not yet responded replaces idle, never the work in hand', () => {
  const waiting = [
    { id: 'n', incident_number: 'INC-NEW' },
    { id: 'o', incident_number: 'INC-OLD' },
  ];
  assert.deepEqual(pickActivity([], () => false, waiting), {
    kind: 'assigned', incidentId: 'n', incidentNumber: 'INC-NEW', count: 2,
  });
  const working = [{ id: 'a', incident_number: 'INC-A', status: 'En Route' as const }];
  assert.equal(pickActivity(working, () => false, waiting).kind, 'en_route');
  assert.equal(pickActivity([], () => false, []).kind, 'idle');
});

test('my own SOS: no Responding, just the reassurance', () => {
  const sos: FieldCall = { ...sent, source: 'Responder-Panic', created_by: 'me' };
  const v = callView(sos, me);
  assert.equal(v.ownSos, true);
  assert.equal(v.action, null);
  assert.ok(v.note?.includes('your SOS'));
  // Anyone else it was sent to can respond as usual.
  assert.equal(callView({ ...sos, created_by: 'someone-else' }, me).action?.kind, 'respond');
});

/* ── Fire (0059): closed by the fire report; Fire does not transport ──── */

import { reportPathFor, secondaryStep } from './response.ts';

test('a firefighter accepts, arrives, and closes with the fire report; no Transporting', () => {
  const fire = { silo: 'MetroFire' };
  assert.deepEqual(nextStep(fire, 'Dispatched', 'MetroFire'), { kind: 'status', status: 'En Route', label: 'Accept · Mark En Route' });
  assert.deepEqual(nextStep(fire, 'En Route', 'MetroFire'), { kind: 'arriving', status: 'On Scene', label: 'On scene is marked when you arrive' });
  assert.deepEqual(nextStep(fire, 'On Scene', 'MetroFire'), { kind: 'report', label: 'File fire report' });
  assert.deepEqual(nextStep(fire, 'Transporting', 'MetroFire'), { kind: 'report', label: 'File fire report' });
  // Fire & Rescue does not transport; an older call already marked Transporting can still be filed.
  assert.equal(secondaryStep(fire, 'On Scene', 'MetroFire'), null);
  assert.equal(nextStep({ ...fire, report_filed_at: '2026-10-07T10:00:00Z' }, 'On Scene', 'MetroFire'), null);
  assert.equal(nextStep(fire, 'Resolved', 'MetroFire'), null);
  for (const s of ['Dispatched', 'En Route', 'On Scene', 'Transporting'] as const) {
    const step = nextStep(fire, s, 'MetroFire');
    assert.ok(!(step?.kind === 'status' && step.status === 'Resolved'), `no bare Resolved from ${s}`);
  }
});

test('the police ladder has no Transporting step and is unchanged for police', () => {
  assert.equal(secondaryStep({ silo: 'MetroPolice' }, 'On Scene', 'MetroPolice'), null);
  assert.equal(nextStep({ silo: 'MetroPolice' }, 'On Scene', 'MetroPolice')?.label, 'File incident report');
});

test('the lead files the report for their own department', () => {
  assert.equal(reportPathFor('i1', 'MetroFire'), '/fire-report/i1');
  assert.equal(reportPathFor('i1', 'MetroPolice'), '/report/i1');
  // A firefighter leading a call routed to both departments files the fire report.
  const both = { id: 'i1', silo: 'Ethekwini', dispatched_silos: ['MetroPolice', 'MetroFire'], status: 'On Scene' as const, accepted_by: 'f1' };
  const view = callView(both, { userId: 'f1', silo: 'MetroFire', onDuty: true });
  assert.equal(view.action?.label, 'File fire report');
  assert.equal(view.secondary, null, 'fire does not transport');
});

/* ── EMS (0063): closed by the patient care report ───────────────────── */

test('a paramedic accepts, arrives, may mark Transporting, and closes with the patient report', () => {
  const ems = { silo: 'Medical' };
  assert.deepEqual(nextStep(ems, 'Dispatched', 'Medical'), { kind: 'status', status: 'En Route', label: 'Accept · Mark En Route' });
  assert.deepEqual(nextStep(ems, 'En Route', 'Medical'), { kind: 'arriving', status: 'On Scene', label: 'On scene is marked when you arrive' });
  assert.deepEqual(nextStep(ems, 'On Scene', 'Medical'), { kind: 'report', label: 'File patient report' });
  assert.deepEqual(nextStep(ems, 'Transporting', 'Medical'), { kind: 'report', label: 'File patient report' });
  assert.deepEqual(secondaryStep(ems, 'On Scene', 'Medical'), { kind: 'status', status: 'Transporting', label: 'Mark Transporting' });
  assert.equal(nextStep({ ...ems, report_filed_at: '2026-10-09T10:00:00Z' }, 'On Scene', 'Medical'), null);
  for (const s of ['Dispatched', 'En Route', 'On Scene', 'Transporting'] as const) {
    const step = nextStep(ems, s, 'Medical');
    assert.ok(!(step?.kind === 'status' && step.status === 'Resolved'), `no bare Resolved from ${s}`);
  }
  assert.equal(reportPathFor('i1', 'Medical'), '/pcr/i1');
});

test('a paramedic leading a call shared with Police files the patient report, not the police one', () => {
  const both = { id: 'i1', silo: 'Ethekwini', dispatched_silos: ['MetroPolice', 'Medical'], status: 'On Scene' as const, accepted_by: 'm1' };
  const view = callView(both, { userId: 'm1', silo: 'Medical', onDuty: true });
  assert.equal(view.action?.label, 'File patient report');
  assert.equal(view.secondary?.label, 'Mark Transporting');
});

/* ── Disaster (0065): closed by the post-mortem ──────────────────────── */

test('a Disaster officer accepts, arrives and closes with the post-mortem; no Transporting', () => {
  const dm = { silo: 'EthekwiniDisaster' };
  assert.deepEqual(nextStep(dm, 'Dispatched', 'EthekwiniDisaster'), { kind: 'status', status: 'En Route', label: 'Accept · Mark En Route' });
  assert.deepEqual(nextStep(dm, 'En Route', 'EthekwiniDisaster'), { kind: 'arriving', status: 'On Scene', label: 'On scene is marked when you arrive' });
  assert.deepEqual(nextStep(dm, 'On Scene', 'EthekwiniDisaster'), { kind: 'report', label: 'File post-mortem' });
  assert.equal(secondaryStep(dm, 'On Scene', 'EthekwiniDisaster'), null);
  assert.equal(reportPathFor('i1', 'EthekwiniDisaster'), '/post-mortem/i1');
  for (const s of ['Dispatched', 'En Route', 'On Scene'] as const) {
    const step = nextStep(dm, s, 'EthekwiniDisaster');
    assert.ok(!(step?.kind === 'status' && step.status === 'Resolved'), `no bare Resolved from ${s}`);
  }
});

/* ── The report waits for a proven arrival (0102) ────────────────────── */

test('a lead marked on scene away from it is told why the report waits, for police, fire and EMS', () => {
  const unproven = (silo: string, verified: boolean | null) => callView(
    { id: 'i1', silo, status: 'On Scene', accepted_by: 'u1',
      responders: [{ user_id: 'u1', name: 'Lead', role: 'lead', status: 'On Scene', arrived_verified: verified }] },
    { userId: 'u1', silo, onDuty: true },
  );
  for (const silo of ['MetroPolice', 'MetroFire', 'Medical']) {
    const view = unproven(silo, false);
    assert.equal(view.action?.kind, 'report', silo);
    assert.match(view.blocked ?? '', /arrival is not confirmed/, silo);
    assert.equal(unproven(silo, true).blocked, null, `${silo}: confirmed, the report goes`);
    assert.equal(unproven(silo, null).blocked, null, `${silo}: by the desk or from before 0099, the report goes`);
  }
  // Moving a patient never waits for the arrival.
  assert.equal(unproven('Medical', false).secondary?.label, 'Mark Transporting');
  // The post-mortem is not held by the arrival.
  assert.equal(unproven('EthekwiniDisaster', false).blocked, null);
});

/* ── Disaster Management: called out from standby, assess on site (0107) ── */

test('a Disaster officer accepts a call-out, assesses on site, and the post-mortem sits beside it', () => {
  const call = { id: 'i1', silo: 'MetroFire', dispatched_silos: ['MetroFire', 'EthekwiniDisaster'], status: 'Dispatched' as const };
  const me = { userId: 'd1', silo: 'EthekwiniDisaster', onDuty: true };
  const offered = callView(call, me);
  assert.equal(offered.action?.kind, 'respond');
  assert.equal(offered.action?.label, 'Accept call-out');
  assert.equal(callView(call, { ...me, onDuty: false }).blocked, 'Start standby to accept call-outs.');

  const onSite = callView(
    { ...call, status: 'On Scene', accepted_by: 'd1', responders: [{ user_id: 'd1', name: 'Thandi', role: 'lead', status: 'On Scene', arrived_verified: false }] },
    me,
  );
  assert.deepEqual(onSite.action, { kind: 'assessment', label: 'Assessment' });
  assert.deepEqual(onSite.secondary, { kind: 'report', label: 'File post-mortem' });
  assert.equal(onSite.blocked, null, 'the post-mortem is not held by the arrival check');

  // A second officer splits off to assess another street.
  const backup = callView(
    { ...call, status: 'On Scene', accepted_by: 'd1', responders: [
      { user_id: 'd1', name: 'Thandi', role: 'lead', status: 'On Scene' },
      { user_id: 'd2', name: 'Sipho', role: 'backup', status: 'On Scene' },
    ] },
    { ...me, userId: 'd2' },
  );
  assert.deepEqual(backup.action, { kind: 'assessment', label: 'Assessment' });
  assert.equal(backup.secondary, null);
});

test('the other services still say Accept and go on duty', () => {
  const call = { id: 'i1', silo: 'MetroPolice', status: 'Dispatched' as const, dispatched_silos: ['MetroPolice'] };
  assert.equal(callView(call, { userId: 'p1', silo: 'MetroPolice', onDuty: true }).action?.label, 'Accept');
  assert.equal(callView(call, { userId: 'p1', silo: 'MetroPolice', onDuty: false }).blocked, 'Go on duty to respond to incidents.');
});
