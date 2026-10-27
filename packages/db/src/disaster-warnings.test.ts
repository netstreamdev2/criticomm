import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  READINESS_OUTCOMES, SMS_MAX_CHARS, WARNING_HAZARDS, WARNING_STEPS, colourFor, incidentHazardFor, warningHazard, warningSms, warningState,
} from './disaster-warnings.ts';
import { HAZARDS } from './disaster-plan.ts';

/**
 * A warning is passed on as SAWS issued it, in the colour that goes with its
 * level, and the desk's lists match what the database (0116) accepts.
 */

const sql = readFileSync(new URL('../../../supabase/migrations/0116_disaster_warnings.sql', import.meta.url), 'utf8');
const fn = (name: string) => {
  const start = sql.indexOf(`function public.${name}(`);
  assert.ok(start >= 0, `0116 defines ${name}`);
  return sql.slice(start, sql.indexOf('$$;', start));
};
const quoted = (text: string) => [...text.matchAll(/'([^']+)'/g)].map((m) => m[1]!);

test('the desk\'s lists are the database\'s lists', () => {
  assert.deepEqual(quoted(fn('warning_hazards')), [...WARNING_HAZARDS]);
  assert.deepEqual(quoted(fn('warning_steps')), WARNING_STEPS.map((s) => s.key));
  for (const o of READINESS_OUTCOMES) assert.ok(sql.includes(`'${o}'`), `the database knows ${o}`);
});

test('the colour follows the level: Yellow 1–4, Orange 5–8, Red 9–10', () => {
  assert.deepEqual([1, 4, 5, 8, 9, 10].map(colourFor), ['Yellow', 'Yellow', 'Orange', 'Orange', 'Red', 'Red']);
});

test('SAWS\'s spelling becomes the desk\'s', () => {
  assert.equal(warningHazard('Severe Thunderstorms'), 'Severe thunderstorms');
  assert.equal(warningHazard('Storm surges'), 'Storm surge');
  assert.equal(warningHazard('Disruptive Rain'), 'Disruptive rain');
  assert.equal(warningHazard(''), 'Other');
});

test('an incident from a warning starts with a hazard the desk can save', () => {
  for (const h of WARNING_HAZARDS) {
    const to = incidentHazardFor(h);
    assert.ok(to === '' || HAZARDS.includes(to), `${h} → ${to}`);
  }
  assert.equal(incidentHazardFor('Disruptive rain'), 'Floods');
});

test('a warning is in force between its times, unless ended or cancelled', () => {
  const w = { status: 'Active', valid_from: '2026-10-27T10:00:00Z', valid_until: '2026-10-27T21:00:00Z' };
  assert.equal(warningState(w, new Date('2026-10-27T09:00:00Z')), 'Upcoming');
  assert.equal(warningState(w, new Date('2026-10-27T12:00:00Z')), 'In force');
  assert.equal(warningState(w, new Date('2026-10-27T21:00:00Z')), 'Expired');
  assert.equal(warningState({ ...w, status: 'Cancelled' }, new Date('2026-10-27T12:00:00Z')), 'Cancelled');
});

test('the SMS is SAWS\'s words in plain letters, within six parts', () => {
  const w = {
    colour: 'Yellow', level: 4, hazard: 'Severe thunderstorms', valid_from: '2026-10-27T10:00:00Z', valid_until: '2026-10-27T20:59:59Z',
    areas: 'Ethekwini / King Shaka Airport', impacts: '- Flooding of settlements, roads and bridges.\n- Danger to life (fast flowing streams).',
    instructions: 'Stay indoors – don’t cross rivers.',
  };
  const sms = warningSms(w, '031 361 0000');
  assert.match(sms, /^SA Weather Service: Yellow Level 4 warning for Severe thunderstorms\./);
  assert.match(sms, /Flooding of settlements, roads and bridges/);
  assert.match(sms, /Stay indoors - don't cross rivers\./, 'curly quotes and long dashes become plain');
  assert.match(sms, /Emergency: 031 361 0000/);
  assert.ok(/^[\n\x20-\x7E]*$/.test(sms), 'plain letters only');
  const long = warningSms({ ...w, impacts: 'x'.repeat(800), instructions: 'y'.repeat(800) }, '031 361 0000');
  assert.ok(long.length <= SMS_MAX_CHARS);
  assert.ok(!long.includes('yyyy'), 'what to do goes first when it is too long');
});
