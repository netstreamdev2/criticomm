import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TASK_TEAMS, idpFigures, readinessMeasures, readinessScore, type ReadinessInput } from './disaster-readiness.ts';
import { LINE_FUNCTIONS } from './disaster-departments.ts';

/** Readiness and the IDP figures count what the process says they count. */

const sql = readFileSync(new URL('../../../supabase/migrations/0120_disaster_readiness.sql', import.meta.url), 'utf8');

test('the five task teams are the database\'s', () => {
  const start = sql.indexOf('function public.disaster_task_team_keys(');
  const keys = [...sql.slice(start, sql.indexOf('$$;', start)).matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(keys, TASK_TEAMS.map((t) => t.key));
});

const base: ReadinessInput = {
  now: new Date('2026-10-27T10:00:00+02:00'), chairThisMonth: false, dutiesNow: [], departments: LINE_FUNCTIONS.map((d) => d.key),
  withRepresentative: [], planReviewed: {}, halls: [], stock: [], lastForum: null, teamsWithChair: [],
};

test('nothing in place scores nought, everything in place scores a hundred', () => {
  assert.equal(readinessScore(readinessMeasures(base)), 0);
  const all = readinessMeasures({
    ...base, chairThisMonth: true, dutiesNow: ['Principal Disaster Management Stand-by Officer', 'MDMC Duty Officer'],
    withRepresentative: base.departments, planReviewed: Object.fromEntries(base.departments.map((d) => [d, '2026-06-01'])),
    halls: [{ capacity: 300, keyHolderPhone: '082 123 4567', active: true }],
    stock: ['blankets', 'mattresses', 'food_hampers', 'start_house_kits'].map((key) => ({ key, quantity: 100, minimum: 50 })),
    lastForum: '2026-09-15', teamsWithChair: TASK_TEAMS.map((t) => t.key),
  });
  assert.equal(readinessScore(all), 100);
});

test('each measure counts as the plan reads it', () => {
  const m = Object.fromEntries(readinessMeasures({
    ...base, dutiesNow: ['Principal Disaster Management Stand-by Officer'],
    withRepresentative: ['water', 'disaster'], planReviewed: { water: '2025-10-01', fire: '2026-01-10' },
    halls: [{ capacity: 300, keyHolderPhone: '082 123 4567', active: true }, { capacity: 0, keyHolderPhone: '082', active: true },
      { capacity: 200, keyHolderPhone: null, active: true }, { capacity: 500, keyHolderPhone: '083', active: false }],
    stock: [{ key: 'blankets', quantity: 40, minimum: 50 }, { key: 'mattresses', quantity: 10, minimum: 0 }, { key: 'food_hampers', quantity: 90, minimum: 80 }],
    lastForum: '2026-07-01', teamsWithChair: ['social_relief', 'mhi'],
  }).map((x) => [x.key, x]));
  assert.equal(m.standby!.pct, 50);
  assert.equal(m.reps!.pct, Math.round(100 / 18), 'Disaster Management is not its own representative');
  assert.equal(m.plans!.pct, Math.round(100 / 19), 'a review over a year old does not count');
  assert.equal(m.halls!.pct, 33, 'room and a key holder to phone; inactive halls left out');
  assert.equal(m.stock!.pct, 25, 'below minimum, or no minimum set, does not count');
  assert.equal(m.forum!.pct, 0, 'the last meeting was over a quarter ago');
  assert.equal(m.teams!.pct, 40);
});

test('the IDP figures for a year', () => {
  const f = idpFigures({
    incidents: [
      { hazard: 'Fires in formal and informal settlements', informalSettlement: true, figures: { homes_destroyed: 30, homes_damaged: 12, dead: 1 }, deceased: 2, victims: 120 },
      { hazard: 'Structure or informal settlement fire', informalSettlement: false, figures: { households_affected: 5 }, deceased: 0, victims: 20 },
      { hazard: 'Flood', informalSettlement: false, figures: { people_affected: 900, dead: 3 }, deceased: 1, victims: 50 },
    ],
    wardPeople: 1300, population: 4_300_000, warningsL4: 6, readinessSessions: 4, reviewsSignedOff: 1,
  });
  assert.equal(f.c69, 1300);
  assert.equal(f.deaths, 5, 'the larger of the sitrep and the register, per incident');
  assert.equal(f.fd12, 0.12);
  assert.equal(f.c73, 1, 'only fires marked as in an informal settlement');
  assert.equal(f.c74, 42);
  const floods = f.byRisk.find((r) => r.risk === 'Floods')!;
  assert.deepEqual([floods.incidents, floods.affected, floods.deaths], [1, 900, 3], 'the 2012 name counts towards its risk');
  assert.equal(idpFigures({ incidents: [], wardPeople: 0, population: null, warningsL4: 0, readinessSessions: 0, reviewsSignedOff: 0 }).fd12, null);
});
