import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  abilitiesFor, broadcastTargets, canPropose, deskSiloOf, parseDepartment, parseDesks,
} from './abilities.ts';
import { computeInsights, freeCrewsFor, tagsOf, teamOf } from './insights.ts';
import { emptyCallDraft, missingCallFields, proposalSchema, viewProposal } from './proposals.ts';
import { draftFromModel, findByNumber, matchCode, resolveProposals, type CodeGroup } from './resolve.ts';
import { DEFAULT_THRESHOLDS, type CritiCrew, type CritiIncident, type CritiMe, type Insight } from './types.ts';

const NOW = new Date('2026-10-11T10:00:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
// Durban CBD, and a point about 2 km away.
const SCENE = { location_lat: -29.8587, location_lng: 31.0218 };
const NEAR = { lat: -29.8587, lng: 31.0425 };
const FAR = { lat: -29.7270, lng: 31.0830 };

let seq = 0;
function call(over: Partial<CritiIncident> = {}): CritiIncident {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    incident_number: `INC-${String(seq).padStart(4, '0')}`,
    silo: 'Ethekwini', tagged_silos: ['MetroFire'], dispatched_silos: [],
    incident_type: 'Structure Fire', incident_category: 'Fire', incident_severity: 'Medium',
    status: 'Pending Dispatch', source: 'Master', location_address: '7 Chris Hani Rd, Durban',
    ...SCENE, caller_name: 'Thandi Mkhize', caller_number: `+2782123${String(1000 + seq)}`,
    call_timestamp: ago(2), incident_created_at: ago(2), dispatch_time: null, assigned_to: null,
    assigned_to_name: null, assigned_at: null, accepted_by: null, accepted_at: null, arrived_timestamp: null,
    responding_officer: null, number_of_victims: 0, medical_type: 'EMS Not Required', created_by: null,
    updated_at: ago(2), last_note_at: null, ...over,
  };
}
function crew(over: Partial<CritiCrew> = {}): CritiCrew {
  seq += 1;
  return {
    userId: `10000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    name: `Firefighter ${seq}`, badge: `FF${seq}`, silo: 'MetroFire', station: null, unitNumber: null,
    ...NEAR, seenAt: ago(1), onDutySince: ago(60), busyWith: null, activeCalls: 0, ...over,
  };
}
const me = (role: CritiMe['role'], silo: CritiMe['silo'], userId = 'u-me'): CritiMe => ({ userId, name: 'Me', role, silo });
const kinds = (xs: Insight[]) => xs.map((x) => x.kind);
const insights = (who: CritiMe, incidents: CritiIncident[], crews: CritiCrew[] = []) =>
  computeInsights({ me: who, incidents, crews, thresholds: DEFAULT_THRESHOLDS }, NOW);

/* ── Who may do what ── */

test('Criti offers each role only what its database function accepts', () => {
  assert.equal(canPropose('Dispatcher', 'assign_officer'), true);
  assert.equal(canPropose('Dispatcher', 'log_call'), false, 'call takers log calls');
  assert.equal(canPropose('IncidentLogger', 'log_call'), true);
  assert.equal(canPropose('IncidentLogger', 'send_to_desk'), true);
  assert.equal(canPropose('IncidentLogger', 'assign_officer'), false, 'the dispatch desk dispatches');
  assert.equal(canPropose('IncidentLogger', 'cancel_call'), false);
  assert.equal(canPropose('SystemController', 'assign_officer'), false, 'assign_incident() refuses it');
  assert.equal(canPropose('CaseManager', 'cancel_call'), false, 'case managers review, they do not cancel');
  assert.deepEqual(abilitiesFor('Viewer'), []);
  assert.deepEqual(abilitiesFor('Police'), ['add_note']);
  assert.deepEqual(abilitiesFor('Staff'), []);
});

test('broadcasts stay inside the department, except for the control room and the platform tier', () => {
  assert.deepEqual(broadcastTargets('Supervisor', 'MetroFire'), ['MetroFire']);
  assert.deepEqual(broadcastTargets('Captain', 'MetroPolice'), ['MetroPolice']);
  assert.deepEqual(broadcastTargets('Dispatcher', 'Medical'), ['Medical']);
  assert.equal(broadcastTargets('Dispatcher', 'Ethekwini').length, 5);
  assert.equal(broadcastTargets('SystemAdmin', 'MetroPolice').length, 5);
  assert.deepEqual(broadcastTargets('Police', 'MetroPolice'), [], 'officers do not broadcast');
});

test('a department desk is its own team; the control room dispatches everyone', () => {
  assert.equal(deskSiloOf('Dispatcher', 'MetroFire'), 'MetroFire');
  assert.equal(deskSiloOf('Dispatcher', 'Ethekwini'), null);
  assert.equal(deskSiloOf('Supervisor', 'MetroFire'), null);
  assert.deepEqual(teamOf({ role: 'Dispatcher', silo: 'MetroFire' }), ['MetroFire']);
  assert.equal(teamOf({ role: 'Dispatcher', silo: 'Ethekwini' }), 'all');
  assert.deepEqual(teamOf({ role: 'Supervisor', silo: 'MetroPolice' }), ['MetroPolice']);
  assert.equal(teamOf({ role: 'SystemAdmin', silo: 'MetroPolice' }), 'all');
});

test('departments are read the way people say them', () => {
  assert.equal(parseDepartment('fire'), 'MetroFire');
  assert.equal(parseDepartment('EMS desk'), 'Medical');
  assert.equal(parseDepartment('Metro Police'), 'MetroPolice');
  assert.equal(parseDepartment('Disaster Management'), 'EthekwiniDisaster');
  assert.equal(parseDepartment('Control Room'), 'Ethekwini');
  assert.equal(parseDepartment('the zoo'), null);
  assert.deepEqual(parseDesks(['EMS', 'fire', 'Fire & Rescue', 'police']), ['MetroPolice', 'MetroFire', 'Medical']);
  assert.deepEqual(parseDesks('fire and ems'), ['MetroFire', 'Medical']);
});

test("a call's desks: its tags and crews, or its own department before tagging", () => {
  assert.deepEqual(tagsOf({ silo: 'Ethekwini', tagged_silos: ['Medical'], dispatched_silos: ['MetroFire'] }), ['MetroFire', 'Medical']);
  assert.deepEqual(tagsOf({ silo: 'MetroPolice', tagged_silos: [], dispatched_silos: [] }), ['MetroPolice']);
  assert.deepEqual(tagsOf({ silo: 'Ethekwini', tagged_silos: [], dispatched_silos: [] }), []);
});

/* ── The tiles ── */

test('a new critical call: nearest free crew first, with a road estimate', () => {
  const c = call({ incident_severity: 'Critical', call_timestamp: ago(3), incident_created_at: ago(3) });
  const near = crew({ name: 'Firefighter Near' });
  const far = crew({ name: 'Firefighter Far', ...FAR });
  const busy = crew({ name: 'Firefighter Busy', activeCalls: 1 });
  const police = crew({ name: 'Officer Elsewhere', silo: 'MetroPolice' });
  const options = freeCrewsFor(c, [far, busy, police, near], ['MetroFire'], DEFAULT_THRESHOLDS);
  assert.deepEqual(options.map((o) => o.crew.name), ['Firefighter Near', 'Firefighter Far']);
  assert.ok(options[0]!.minutes! >= 2 && options[0]!.minutes! <= 6, `about 2 km by road: ${options[0]!.minutes} min`);

  const [tile] = insights(me('Dispatcher', 'MetroFire'), [c], [far, busy, near]);
  assert.equal(tile!.kind, 'incoming_critical');
  assert.equal(tile!.tone, 'critical');
  assert.equal(tile!.title, 'Critical call waiting for dispatch');
  assert.match(tile!.body, /Firefighter Near is free, about \d+ min away/);
  const assign = tile!.actions.find((a) => a.type === 'propose' && a.view.proposal.kind === 'assign_officer');
  assert.ok(assign && assign.type === 'propose');
  assert.equal(assign.view.proposal.kind === 'assign_officer' && assign.view.proposal.user_id, near.userId);
  const all = tile!.actions.find((a) => a.type === 'propose' && a.view.proposal.kind === 'dispatch_all');
  assert.ok(all && all.type === 'propose' && all.view.proposal.kind === 'dispatch_all');
  assert.deepEqual(all.view.proposal.silos, ['MetroFire']);
});

test('late dispatch follows the escalation minutes', () => {
  const warn = call({ call_timestamp: ago(12), incident_created_at: ago(12) });
  const bad = call({ call_timestamp: ago(25), incident_created_at: ago(25) });
  const fresh = call({ call_timestamp: ago(4), incident_created_at: ago(4) });
  const tiles = insights(me('Dispatcher', 'Ethekwini'), [warn, bad, fresh], [crew()]);
  const late = tiles.filter((t) => t.kind === 'late_dispatch');
  assert.equal(late.length, 2, 'a Medium call four minutes old is not late');
  const byId = new Map(late.map((t) => [t.incident!.id, t]));
  assert.equal(byId.get(bad.id)!.tone, 'critical');
  assert.equal(byId.get(bad.id)!.title, 'Late dispatch: over 20 min');
  assert.equal(byId.get(warn.id)!.tone, 'warning');
  assert.equal(byId.get(warn.id)!.title, 'Late dispatch: over 10 min');
});

test('a call taker sees late calls but is not offered dispatching', () => {
  const late = call({ call_timestamp: ago(30), incident_created_at: ago(30) });
  const tiles = insights(me('IncidentLogger', 'Ethekwini'), [late], [crew()]);
  const tile = tiles.find((t) => t.kind === 'late_dispatch')!;
  assert.ok(tile.actions.every((a) => a.type === 'link'));
  assert.doesNotMatch(tile.body, /is free/);
  // Following a call once it is out is the dispatch desk's work, not intake's.
  const fresh = call({ incident_severity: 'Critical', call_timestamp: ago(2), incident_created_at: ago(2) });
  const unanswered = call({
    status: 'Dispatched', dispatched_silos: ['MetroFire'], dispatch_time: ago(9), assigned_at: ago(9),
    assigned_to: 'u-x', assigned_to_name: 'Firefighter X', location_address: '40 Florida Rd, Morningside',
  });
  assert.deepEqual(kinds(insights(me('IncidentLogger', 'Ethekwini'), [fresh, unanswered], [crew()])), []);
});

test('people hurt and EMS not sent: offer the EMS desk', () => {
  const c = call({ number_of_victims: 2, medical_type: 'P2 - ORANGE: Urgent / Serious', incident_created_at: ago(1), call_timestamp: ago(1) });
  const tile = insights(me('IncidentLogger', 'Ethekwini'), [c]).find((t) => t.kind === 'missing_desk')!;
  assert.equal(tile.title, 'People hurt, EMS not sent');
  assert.equal(tile.tone, 'high');
  const send = tile.actions[0]!;
  assert.ok(send.type === 'propose' && send.view.proposal.kind === 'send_to_desk');
  assert.deepEqual(send.view.proposal.silos, ['Medical']);
  assert.equal(insights(me('IncidentLogger', 'Ethekwini'), [call({ tagged_silos: ['MetroFire', 'Medical'], number_of_victims: 2, medical_type: null })])
    .some((t) => t.kind === 'missing_desk'), false, 'nothing missing, no tile');
});

test('assigned and not answered: offer someone else, or everyone', () => {
  const holder = crew({ name: 'Firefighter Holder' });
  const other = crew({ name: 'Firefighter Other' });
  const c = call({
    status: 'Dispatched', dispatched_silos: ['MetroFire'], dispatch_time: ago(8), assigned_at: ago(8),
    assigned_to: holder.userId, assigned_to_name: 'Firefighter Holder',
  });
  const tile = insights(me('Dispatcher', 'MetroFire'), [c], [holder, other]).find((t) => t.kind === 'not_accepted')!;
  assert.match(tile.body, /Firefighter Holder has not pressed Responding/);
  const assign = tile.actions.find((a) => a.type === 'propose' && a.view.proposal.kind === 'assign_officer');
  assert.ok(assign && assign.type === 'propose' && assign.view.proposal.kind === 'assign_officer');
  assert.equal(assign.view.proposal.user_id, other.userId, 'never the person already holding it');
  assert.ok(tile.actions.some((a) => a.type === 'propose' && a.view.proposal.kind === 'dispatch_all'));
  assert.equal(insights(me('Dispatcher', 'MetroFire'), [{ ...c, assigned_at: ago(2), dispatch_time: ago(2) }], [holder])
    .some((t) => t.kind === 'not_accepted'), false, 'two minutes is not yet late');
});

test('accepted and not on scene after the target: the desk may record it for them', () => {
  const c = call({
    status: 'En Route', dispatched_silos: ['MetroFire'], dispatch_time: ago(45), accepted_by: 'u-crew',
    accepted_at: ago(40), responding_officer: 'Firefighter Dube',
  });
  const tile = insights(me('Dispatcher', 'MetroFire'), [c]).find((t) => t.kind === 'no_arrival')!;
  assert.match(tile.body, /Firefighter Dube took/);
  const mark = tile.actions[0]!;
  assert.ok(mark.type === 'propose' && mark.view.proposal.kind === 'set_status');
  assert.equal(mark.view.proposal.status, 'On Scene');
  const supervisorView = insights(me('CaseManager', 'Ethekwini'), [c]);
  assert.deepEqual(supervisorView, [], 'a case manager is not shown live dispatch tiles');
});

test('the same caller twice: possible duplicate, closable while still waiting', () => {
  const first = call({ caller_number: '+27821234567', incident_created_at: ago(50), call_timestamp: ago(50), status: 'Dispatched', dispatched_silos: ['MetroFire'], dispatch_time: ago(48), assigned_at: ago(1) });
  const second = call({ caller_number: '082 123 4567', incident_created_at: ago(3), call_timestamp: ago(3) });
  const tile = insights(me('Dispatcher', 'Ethekwini'), [second, first]).find((t) => t.kind === 'possible_duplicate')!;
  assert.equal(tile.incident!.id, second.id);
  assert.match(tile.body, new RegExp(`same caller number as ${first.incident_number}`));
  const close = tile.actions[0]!;
  assert.ok(close.type === 'propose' && close.view.proposal.kind === 'cancel_call');
  assert.equal(close.view.proposal.reason, `Duplicate of ${first.incident_number}`);
  const logger = insights(me('IncidentLogger', 'Ethekwini'), [second, first]).find((t) => t.kind === 'possible_duplicate')!;
  assert.ok(logger.actions.every((a) => a.type === 'link'), 'a call taker cannot close calls');
});

test('an SOS comes first and carries no other tile', () => {
  const sos = call({ source: 'Responder-Panic', incident_severity: 'Critical', caller_name: 'Const. Zulu', call_timestamp: ago(30), incident_created_at: ago(30) });
  const other = call({ incident_severity: 'Critical', call_timestamp: ago(1), incident_created_at: ago(1) });
  const tiles = insights(me('Dispatcher', 'Ethekwini'), [other, sos], [crew()]);
  assert.equal(tiles[0]!.kind, 'sos');
  assert.equal(tiles[0]!.title, 'SOS from Const. Zulu');
  assert.equal(tiles.filter((t) => t.incident?.id === sos.id).length, 1);
});

test('calls waiting and nobody on duty in that department', () => {
  const c = call({ tagged_silos: ['EthekwiniDisaster'], incident_category: 'Disaster', incident_type: 'Flooding', status: 'Pending Analysis' });
  const tiles = insights(me('Dispatcher', 'Ethekwini'), [c], [crew()]);
  const tile = tiles.find((t) => t.kind === 'no_crews')!;
  assert.equal(tile.title, 'Nobody on duty in Disaster Management');
  assert.match(tile.body, /1 call is waiting/);
  assert.equal(insights(me('Dispatcher', 'MetroFire'), [c], [crew()]).some((t) => t.kind === 'no_crews'), false,
    'a fire desk is not told about another department');
});

test('command sees long shifts; field crews see only their own calls', () => {
  const tired = crew({ name: 'Firefighter Tired', onDutySince: ago(15 * 60) });
  assert.equal(insights(me('Supervisor', 'MetroFire'), [], [tired, crew()])[0]!.title, 'Firefighter Tired is past 14 hours on duty');
  assert.equal(insights(me('Dispatcher', 'MetroFire'), [], [tired]).some((t) => t.kind === 'long_shift'), false);

  const mine = call({ status: 'Dispatched', dispatched_silos: ['Medical'], assigned_to: 'u-medic', assigned_at: ago(1), dispatch_time: ago(1), tagged_silos: ['Medical'] });
  const theirs = call({ call_timestamp: ago(30), incident_created_at: ago(30), tagged_silos: ['Medical'] });
  const tiles = insights(me('Paramedic', 'Medical', 'u-medic'), [mine, theirs]);
  assert.deepEqual(kinds(tiles), ['my_call']);
  assert.equal(tiles[0]!.title, 'A call is waiting for you');
  assert.deepEqual(insights(me('Viewer', 'Ethekwini'), [mine, theirs]), []);
});

/* ── From the model's words to a proposal ── */

const CODES: CodeGroup[] = [
  { category: 'Fire', codes: ['Structure Fire', 'Vehicle Fire', 'Veld Fire'] },
  { category: 'Medical', codes: ['Cardiac Arrest', 'Motor Vehicle Accident'] },
  { category: 'Crime', codes: ['Burglary', 'Armed Robbery'] },
];

test('codes match exactly, or by a single close match', () => {
  assert.deepEqual(matchCode(CODES, 'burglary'), { incident_type: 'Burglary', incident_category: 'Crime' });
  assert.deepEqual(matchCode(CODES, 'cardiac'), { incident_type: 'Cardiac Arrest', incident_category: 'Medical' });
  assert.equal(matchCode(CODES, 'fire'), null, 'three fire codes: not a single match');
  assert.equal(matchCode(CODES, ''), null);
});

test('a call from the conversation becomes the intake form, with the desks suggested', () => {
  const d = draftFromModel({
    caller_name: 'Sipho', caller_number: '082 555 1234', is_caller_patient: false, patient_names: 'his mother',
    description: 'Mother collapsed, not breathing', incident_code: 'Cardiac Arrest', severity: 'critical',
    address: '12 Smith St, Umbilo', victims: 9, medical_priority: 'P1', departments: [],
  }, { me: me('IncidentLogger', 'Ethekwini'), codes: CODES });
  assert.equal(d.incident_type, 'Cardiac Arrest');
  assert.equal(d.incident_category, 'Medical');
  assert.equal(d.incident_severity, 'Critical');
  assert.equal(d.number_of_victims, 5, 'the form counts to 5 (Multiple)');
  assert.equal(d.medical_priority, 'P1 - RED: Critical / Life Threatening');
  assert.deepEqual(d.tagged_silos, ['Medical']);
  assert.equal(d.patient_names, 'his mother');
  const own = draftFromModel({ incident_code: 'Burglary', ems_not_required: true }, { me: me('IncidentLogger', 'MetroFire'), codes: CODES });
  assert.deepEqual(own.tagged_silos, ['MetroPolice', 'MetroFire'], "a department's call taker keeps their own desk, as the form does");
  assert.equal(own.number_of_victims, 0);
});

test('what a call still needs, in the words of the form', () => {
  assert.equal(missingCallFields(emptyCallDraft()).length, 12);
  const full = {
    ...emptyCallDraft(), caller_name: 'Sipho', caller_number: '+27825551234', is_caller_patient: true,
    incident_type: 'Burglary', incident_category: 'Crime', call_description: 'Break-in', location_address: '1 Main Rd',
    location_lat: -29.85, location_lng: 31.02, region: 'Central' as const, incident_severity: 'High' as const,
    ems_not_required: true, number_of_victims: 0, tagged_silos: ['MetroPolice' as const],
  };
  assert.deepEqual(missingCallFields(full), []);
  const view = viewProposal({ kind: 'log_call', call: { ...full, location_lat: null } });
  assert.deepEqual(view.missing, ['the place on the map']);
  assert.equal(view.confirmLabel, 'Log the call');
});

test('suggestions are matched to the board, the role and the team', () => {
  const near = crew({ name: 'Firefighter Thabo Dlamini', badge: 'FF900' });
  const medic = crew({ name: 'Paramedic Lee', silo: 'Medical' });
  const c = call({ incident_number: 'INC-0900' });
  const ctx = {
    me: me('Dispatcher', 'MetroFire'), incidents: [c], crews: [near, medic], thresholds: DEFAULT_THRESHOLDS, codes: CODES,
  };
  const ok = resolveProposals([{ kind: 'assign_officer', incident: 'inc-0900', officer: 'thabo dlamini' }], ctx);
  assert.equal(ok.problems.length, 0, ok.problems.join(' '));
  assert.equal(ok.views[0]!.title, 'Assign Firefighter Thabo Dlamini to INC-0900');
  assert.ok(ok.views[0]!.lines.some((l) => /min away by road/.test(l)));

  const byBadge = resolveProposals([{ kind: 'assign_officer', incident: 'INC-0900', officer: 'FF900' }], ctx);
  assert.equal(byBadge.views.length, 1);

  const outside = resolveProposals([{ kind: 'assign_officer', incident: 'INC-0900', officer: 'Paramedic Lee' }], ctx);
  assert.match(outside.problems[0]!, /not on duty in Fire & Rescue/);

  const unknown = resolveProposals([{ kind: 'add_note', incident: 'INC-4040', text: 'Hello there' }], ctx);
  assert.match(unknown.problems[0]!, /INC-4040 is not on your board/);

  const wrongDesk = resolveProposals([{ kind: 'dispatch_all', incident: 'INC-0900', departments: ['Police'] }], ctx);
  assert.match(wrongDesk.problems[0]!, /You dispatch Fire & Rescue only/);

  const logging = resolveProposals([{ kind: 'log_call', call: { caller_name: 'X' } }], ctx);
  assert.match(logging.problems[0]!, /Your role does not log calls\. Call takers/);

  const broadcast = resolveProposals([{ kind: 'broadcast', departments: ['Police'], message: 'Road closed' }], {
    ...ctx, me: me('Supervisor', 'MetroFire'),
  });
  assert.match(broadcast.problems[0]!, /You can broadcast to Fire & Rescue only, not Metro Police/);

  const status = resolveProposals([{ kind: 'set_status', incident: 'INC-0900', status: 'on scene' }], ctx);
  assert.match(status.problems[0]!, /has not been sent to a crew yet/);

  const closed = resolveProposals([{ kind: 'cancel_call', incident: 'INC-0900', reason: 'hoax' }], ctx);
  assert.match(closed.problems[0]!, /at least 10 characters/);
});

test('one number in two departments is never guessed; a short number is found when unique', () => {
  const police = call({ incident_number: 'INC-20261011-0007', silo: 'MetroPolice', tagged_silos: ['MetroPolice'] });
  const fire = call({ incident_number: 'INC-20261011-0007', silo: 'MetroFire' });
  const other = call({ incident_number: 'INC-20261011-0012' });
  assert.ok(Array.isArray(findByNumber([police, fire, other], 'INC-20261011-0007')));
  assert.equal(findByNumber([police, fire, other], '12'), other);
  assert.equal(findByNumber([police, fire, other], 'INC-0012'), other);
  assert.equal(findByNumber([police, fire, other], 'INC-0099'), null);
  const r = resolveProposals([{ kind: 'add_note', incident: 'INC-20261011-0007', text: 'Caller rang back' }], {
    me: me('Dispatcher', 'Ethekwini'), incidents: [police, fire], crews: [], thresholds: DEFAULT_THRESHOLDS, codes: CODES,
  });
  assert.match(r.problems[0]!, /2 calls on your board have the number INC-20261011-0007 \(Metro Police and Fire & Rescue\)/);
  assert.equal(r.views.length, 0);
});

test('a confirmation is checked again before it runs', () => {
  const okAssign = {
    kind: 'assign_officer', incident_id: '00000000-0000-4000-8000-000000000001', incident_number: 'INC-1',
    user_id: '10000000-0000-4000-8000-000000000001', officer: 'Firefighter One', note: null,
  };
  assert.equal(proposalSchema.safeParse(okAssign).success, true);
  assert.equal(proposalSchema.safeParse({ ...okAssign, user_id: 'not-an-id' }).success, false);
  assert.equal(proposalSchema.safeParse({ kind: 'cancel_call', incident_id: okAssign.incident_id, incident_number: 'INC-1', reason: 'hoax' }).success, false);
  assert.equal(proposalSchema.safeParse({ kind: 'set_status', incident_id: okAssign.incident_id, incident_number: 'INC-1', status: 'Resolved' }).success, false,
    'never Resolved or Closed');
  assert.equal(proposalSchema.safeParse({ kind: 'delete_everything' }).success, false);
});

test('the new numbers are found whole, or by their number of the day', () => {
  const a = call({ incident_number: 'MPFD-MD-20261010-1115-0034' });
  const b = call({ incident_number: 'MP-20261010-1116-0035' });
  assert.equal(findByNumber([a, b], 'mpfd-md-20261010-1115-0034'), a);
  assert.equal(findByNumber([a, b], '34'), a);
  assert.equal(findByNumber([a, b], 'call 35'), b);
  assert.equal(findByNumber([a, b], '36'), null);
});
