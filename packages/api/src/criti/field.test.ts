import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldContextForModel, fieldSuggestions, fieldSystemPrompt, readFieldAnswer, screenName, type FieldCall, type FieldContext } from './field.ts';

const NOW = new Date('2026-10-23T08:00:00Z');
const call = (over: Partial<FieldCall> = {}): FieldCall => ({
  id: 'c1', number: 'ETK-MP-20261023-0930-0001', type: 'Assault', severity: 'High', address: '10 Village Road', status: 'On Scene',
  role: 'lead', myStatus: 'On Scene', arrivedAt: '2026-10-23T07:50:00Z', arrivalUnconfirmed: false, reportFiled: false, dispatchedAt: '2026-10-23T07:30:00Z', ...over,
});
const ctx = (over: Partial<FieldContext> = {}): FieldContext => ({
  name: 'Sipho Khumalo', role: 'Police', silo: 'MetroPolice', rank: 'Const.', badge: 'MP123', onDuty: true, dutySince: '2026-10-23T06:00:00Z',
  startOfShiftDone: true, today: { leave: null, shift: { date: '2026-10-23', start: '2026-10-23T06:00:00Z', end: '2026-10-23T18:00:00Z', post: 'Beachfront', station: 'Central', team: 'A', vehicle: 'MP-12', callSign: 'Alpha 3', notes: null } },
  upcoming: [], leaveBalances: [{ type: 'Annual', remaining: 12, taken: 3, pending: 0 }], calls: [call()], recentCalls: [], kit: ['Radio RD-0014'],
  messages: [], certificates: [], screen: { name: 'Home' }, ...over,
});

test('the model is told the person, their shift, their calls and the screen, in plain lines', () => {
  const text = fieldContextForModel(ctx(), NOW);
  assert.match(text, /PERSON: Const\. Sipho Khumalo \(badge MP123\), Police Officer, Metro Police/);
  assert.match(text, /TODAY'S SHIFT: .*post Beachfront, at Central, team A, vehicle MP-12, call sign Alpha 3/);
  assert.match(text, /ETK-MP-20261023-0930-0001 \| Assault \| High \| 10 Village Road \| they lead it .*report still to file/);
  assert.match(text, /LEAVE LEFT THIS YEAR: Annual 12 days left/);
  assert.match(text, /KIT BOOKED TO THEM: Radio RD-0014/);
  assert.match(text, /SCREEN THEY ASKED FROM: Home/);
});

test('Criti answers in their language and never does the work for them', () => {
  const prompt = fieldSystemPrompt({ role: 'Police', silo: 'MetroPolice' }, 'zu');
  assert.match(prompt, /Answer in isiZulu/);
  assert.match(prompt, /cannot respond to a call, mark on scene, file or change a report/);
});

test('only screens that exist and calls that are theirs become buttons', () => {
  const c = ctx();
  const a = readFieldAnswer({ reply: 'Go to your shift.', open: ['schedule', 'call:etk-mp-20261023-0930-0001', 'deleteEverything', 'call:ETK-OTHER'] }, '', c);
  assert.equal(a.reply, 'Go to your shift.');
  assert.deepEqual(a.open, [{ label: 'My schedule', href: '/(tabs)/schedule' }, { label: 'ETK-MP-20261023-0930-0001', href: '/incident/c1' }]);
  assert.deepEqual(readFieldAnswer(null, 'plain text answer', c), { reply: 'plain text answer', open: [] });
});

test('the first questions fit the person: their call, their shift, an arrival to confirm', () => {
  const s = fieldSuggestions(ctx({ calls: [call({ arrivalUnconfirmed: true })] }));
  assert.equal(s[0], 'Why can I not file the report for ETK-MP-20261023-0930-0001?');
  assert.ok(s.includes('Explain my shift in easy words'));
  assert.ok(s.length <= 5);
  assert.equal(screenName('/(tabs)/schedule'), 'My schedule');
  assert.equal(screenName('/incident/abc'), 'An incident');
  assert.equal(screenName('/report/abc'), 'Writing a report');
});
