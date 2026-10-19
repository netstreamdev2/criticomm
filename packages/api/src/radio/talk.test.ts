import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  channelTone, mayKeyUp, readTalkMetadata, sortTalkPeople, talkChannelsToOffer, whoHasTheChannel, type TalkPerson,
} from './talk.ts';

const p = (name: string, extra: Partial<TalkPerson> = {}): TalkPerson => ({
  identity: name, name, role: null, silo: null, me: false, talking: false, ...extra,
});

test('the talk groups offered: my department, All call, then the others for the desk', () => {
  assert.deepEqual(talkChannelsToOffer({ silo: 'MetroFire', seesAll: false }), ['dept:MetroFire', 'all']);
  const desk = talkChannelsToOffer({ silo: 'MetroPolice', seesAll: true });
  assert.equal(desk[0], 'dept:MetroPolice');
  assert.equal(desk[1], 'all');
  assert.equal(desk.length, 6, 'own, All call and the four others');
  assert.equal(new Set(desk).size, desk.length);
});

test('who has the channel, and whether I may key up', () => {
  const quiet = [p('Me', { me: true }), p('Khumalo')];
  assert.equal(whoHasTheChannel(quiet), null);
  assert.equal(mayKeyUp(quiet, false), 'clear');
  const busy = [p('Me', { me: true }), p('Khumalo', { talking: true })];
  assert.equal(whoHasTheChannel(busy)?.name, 'Khumalo');
  assert.equal(mayKeyUp(busy, false), 'busy', 'a radio waits for a clear channel');
  assert.equal(mayKeyUp(busy, true), 'override', 'the desk may talk over');
  const both = [p('Me', { me: true, talking: true }), p('Khumalo', { talking: true })];
  assert.equal(whoHasTheChannel(both)?.name, 'Khumalo', 'the other person shows first');
  assert.equal(mayKeyUp([p('Me', { me: true, talking: true })], false), 'clear', 'only me: still clear');
});

test('people in order: talking, me, then by name', () => {
  const sorted = sortTalkPeople([p('Zulu'), p('Me', { me: true }), p('Adams'), p('Khumalo', { talking: true })]);
  assert.deepEqual(sorted.map((x) => x.name), ['Khumalo', 'Me', 'Adams', 'Zulu']);
});

test('metadata and colours', () => {
  assert.deepEqual(readTalkMetadata('{"role":"Police","silo":"MetroPolice"}'), { role: 'Police', silo: 'MetroPolice' });
  assert.deepEqual(readTalkMetadata('not json'), { role: null, silo: null });
  assert.deepEqual(readTalkMetadata(null), { role: null, silo: null });
  assert.equal(channelTone('all'), '#f97316');
  assert.equal(channelTone('dept:MetroFire'), '#ef4444');
  assert.equal(channelTone('incident:abc'), '#06b6d4');
});
