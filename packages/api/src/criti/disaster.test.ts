import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  deskChecks, disasterUserPrompt, lastHeard, readDisasterBrief, readMarker, readPostMortemDraft,
  type DeskCallout, type DeskContext,
} from './disaster.ts';

const NOW = new Date('2026-10-26T08:00:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const ESKOM = { id: 'p-eskom', name: 'Eskom KZN Control Center', type: 'Utilities' };
const TOTI = { id: 'p-toti', name: 'Amanzimtoti Fire Station', type: 'Fire Stations' };
const SASSA = { id: 'p-sassa', name: 'SASSA (Relief Funds/Grants)', type: 'Government' };
const callout = (over: Partial<DeskCallout>): DeskCallout => ({
  id: 'c1', partnerId: ESKOM.id, name: ESKOM.name, type: ESKOM.type, how: 'Call', status: 'Called', etaMinutes: null,
  calledAt: ago(10), onWayAt: null, onSceneAt: null, leftAt: null, ...over,
});
const ctx = (over: Partial<DeskContext> = {}): DeskContext => ({
  number: 'ETK-ED-1', type: 'Electrical fire', disasterType: null, severity: 'High', address: '12 Kingsway', suburb: 'Amanzimtoti',
  description: 'Big bang, transformer exploded, 30 homes affected, some on fire', injuries: [], victims: null, details: {},
  calledInAt: ago(40), notes: [], callouts: [], updates: [], partners: [ESKOM, TOTI, SASSA], ...over,
});

test('nobody called out: urgent after five minutes, a nudge before', () => {
  assert.equal(deskChecks(ctx(), NOW)[0]!.level, 'urgent');
  assert.match(deskChecks(ctx(), NOW)[0]!.text, /Nobody called out yet\. The call came in 40 min ago/);
  assert.equal(deskChecks(ctx({ calledInAt: ago(2) }), NOW)[0]!.level, 'info');
});

test('a partner not on the way after 20 minutes is chased; late against their own time is flagged', () => {
  const checks = deskChecks(ctx({ callouts: [
    callout({ calledAt: ago(25) }),
    callout({ id: 'c2', partnerId: TOTI.id, name: TOTI.name, status: 'On the way', onWayAt: ago(30), etaMinutes: 12, calledAt: ago(32) }),
  ], updates: [{ at: ago(5), source: 'Radio', from: null, text: 'x' }] }), NOW);
  assert.deepEqual(checks.map((c) => c.calloutId), ['c1', 'c2']);
  assert.match(checks[0]!.text, /called 25 min ago and is not on the way yet/);
  assert.match(checks[1]!.text, /18 min later than they said/);
});

test("V4's heartbeat: no update for 30 minutes while partners work the call", () => {
  const quiet = deskChecks(ctx({ callouts: [callout({ status: 'On scene', calledAt: ago(60), onSceneAt: ago(45) })] }), NOW);
  assert.match(quiet[0]!.text, /No update for 40 min/);
  const fresh = deskChecks(ctx({ callouts: [callout({ status: 'On scene', calledAt: ago(60), onSceneAt: ago(45) })],
    updates: [{ at: ago(3), source: 'WhatsApp', from: 'Ward councillor', text: 'Hall open' }] }), NOW);
  assert.equal(fresh.length, 0);
  assert.equal(lastHeard(ctx({ updates: [{ at: ago(3), source: 'Call', from: null, text: 'x' }] })), ago(3));
});

test('every partner gone: file the post-mortem', () => {
  const done = deskChecks(ctx({ callouts: [callout({ status: 'Left scene', onSceneAt: ago(30), leftAt: ago(2) })] }), NOW);
  assert.deepEqual(done.map((c) => c.level), ['info']);
  assert.match(done[0]!.text, /File the post-mortem/);
});

test("Criti's call-outs: only real partners, none already working, once each, at most five", () => {
  const brief = readDisasterBrief({
    summary: 'Transformer fire, 30 homes.', severity: 'Critical',
    callouts: [
      { partner_id: 'p-eskom', why: 'Already called', urgency: 'now' },
      { partner_id: 'p-made-up', why: 'Invented', urgency: 'now' },
      { partner_id: 'p-toti', why: 'Homes on fire', urgency: 'now' },
      { partner_id: 'p-toti', why: 'Twice', urgency: 'now' },
      { partner_id: 'p-sassa', why: 'Blankets for displaced families', urgency: 'later' },
      'not an object',
    ],
    watch: ['No EMS called with possible burns', 42, ''], ask: ['How many people are hurt?'],
    figures: { homes_affected: 30, people_displaced: '96', injured: -1, deaths: 'two' },
  }, { partners: [ESKOM, TOTI, SASSA], callouts: [callout({})] });
  assert.deepEqual(brief.callouts.map((c) => [c.partnerId, c.urgency]), [['p-toti', 'now'], ['p-sassa', 'soon']]);
  assert.equal(brief.callouts[0]!.name, 'Amanzimtoti Fire Station');
  assert.equal(brief.severity, 'Critical');
  assert.deepEqual(brief.watch, ['No EMS called with possible burns']);
  assert.deepEqual(brief.figures, { homesAffected: 30, peopleDisplaced: 96, injured: null, deaths: null });
  // A partner who has left may be suggested again.
  const again = readDisasterBrief({ callouts: [{ partner_id: 'p-eskom', why: 'Flare-up' }] },
    { partners: [ESKOM], callouts: [callout({ status: 'Left scene' })] });
  assert.equal(again.callouts.length, 1);
  assert.equal(readDisasterBrief(null, { partners: [], callouts: [] }).summary, '');
});

test('the prompt carries the call, the call-outs, the updates and the list, never the caller', () => {
  const p = disasterUserPrompt(ctx({
    callouts: [callout({ status: 'On the way', onWayAt: ago(4), etaMinutes: 20 })],
    updates: [{ at: ago(3), source: 'Radio', from: 'Amanzimtoti Fire Station', text: 'Six homes burning' }],
  }), NOW);
  assert.match(p, /Call ETK-ED-1, called in .* \(40 min ago\)/);
  assert.match(p, /Eskom KZN Control Center \(Utilities\): On the way, on the way 4 min, said 20 min/);
  assert.match(p, /by Radio from Amanzimtoti Fire Station: Six homes burning/);
  assert.match(p, /p-sassa \| SASSA \(Relief Funds\/Grants\) \| Government/);
  assert.doesNotMatch(p, /caller_name|caller_number/);
});

test('the reading changes when something new is logged or a partner moves', () => {
  const a = readMarker(ctx({ callouts: [callout({})] }));
  const b = readMarker(ctx({ callouts: [callout({ status: 'On the way', onWayAt: ago(1) })] }));
  const c = readMarker(ctx({ callouts: [callout({})], updates: [{ at: ago(1), source: 'Call', from: null, text: 'x' }] }));
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  assert.equal(a, readMarker(ctx({ callouts: [callout({})] })));
});

test('the post-mortem draft keeps stated numbers and needs a cause or lessons', () => {
  assert.equal(readPostMortemDraft({ root_cause: '', lessons_learned: '' }), null);
  const d = readPostMortemDraft({ injuries: 2, fatalities: 'none', displaced_people: 96, root_cause: 'Transformer overload.', lessons_learned: '- Call Eskom first' });
  assert.deepEqual(d, { injuries: 2, fatalities: null, displacedPeople: 96, rootCause: 'Transformer overload.', lessonsLearned: '- Call Eskom first' });
});

test('the Plan on the prompt: title, hazard, level, municipalities, reception centres, who is on duty', () => {
  const p = disasterUserPrompt(ctx({
    shortTitle: 'Isipingo transformer fire', hazard: 'Structure or informal settlement fire', level: 'Silver',
    municipalities: ['eThekwini Metro', 'Ugu'], shelters: [{ name: 'Isipingo Community Hall', peopleNow: 96, capacity: 150 }],
    onDuty: [{ name: 'Senior DMO Sipho Zulu', duty: 'Principal Disaster Management Stand-by Officer', status: 'On standby' }],
  }), NOW);
  assert.match(p, /Title: Isipingo transformer fire\./);
  assert.match(p, /Level of co-ordination now: Silver\./);
  assert.match(p, /Municipalities affected: eThekwini Metro, Ugu\./);
  assert.match(p, /Reception centres open: Isipingo Community Hall \(96 people, 54 places free\)\./);
  assert.match(p, /Senior DMO Sipho Zulu \(Principal Disaster Management Stand-by Officer, on standby\)/);
  assert.match(disasterUserPrompt(ctx({ shelters: [] }), NOW), /Reception centres open: none\./);
});

test('level advice only when it changes the level', () => {
  const up = readDisasterBrief({ summary: 'x', level_advice: { level: 'Gold', why: 'Two wards, City resources needed' } }, { partners: [], callouts: [], level: 'Bronze' });
  assert.deepEqual(up.levelAdvice, { level: 'Gold', why: 'Two wards, City resources needed' });
  assert.equal(readDisasterBrief({ summary: 'x', level_advice: { level: 'Gold', why: 'y' } }, { partners: [], callouts: [], level: 'Gold' }).levelAdvice, null);
  assert.equal(readDisasterBrief({ summary: 'x', level_advice: { level: 'Platinum' } }, { partners: [], callouts: [], level: 'Bronze' }).levelAdvice, null);
});
