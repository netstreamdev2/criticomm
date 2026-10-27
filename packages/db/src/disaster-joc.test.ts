import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  JOC_ACTIVATION, JOC_AUTHORISERS, JOC_DUTIES, LEVEL_TRIGGERS, NEXT_STATUS, RECOVERY_TASKS, REVIEW_SIGNOFFS, SILVER_CHECKS,
  openRecoveryTasks,
} from './disaster-joc.ts';

/**
 * The reasons a level is raised, who may activate the JOC, the checklists
 * and the recovery tasks: the desk offers exactly what the database (0117)
 * accepts, and the status moves are the process's.
 */

const sql = readFileSync(new URL('../../../supabase/migrations/0117_disaster_joc_activation.sql', import.meta.url), 'utf8');
const fn = (name: string) => {
  const start = sql.indexOf(`function public.${name}(`);
  assert.ok(start >= 0, `0117 defines ${name}`);
  return sql.slice(start, sql.indexOf('$$;', start));
};
const quoted = (text: string) => [...text.matchAll(/'([^']+)'/g)].map((m) => m[1]!);

test('each level\'s triggers, keys and words, are the database\'s', () => {
  const keys = quoted(fn('disaster_level_triggers')).filter((k) => !['Bronze', 'Silver', 'Gold'].includes(k));
  assert.deepEqual(keys, Object.values(LEVEL_TRIGGERS).flat().map((t) => t.key));
  const names = fn('disaster_trigger_name');
  for (const t of Object.values(LEVEL_TRIGGERS).flat()) assert.ok(names.includes(`then '${t.label.replace(/'/g, "''")}'`), `the database names ${t.key}`);
  assert.equal(LEVEL_TRIGGERS.Gold.length, 8);
  assert.equal(LEVEL_TRIGGERS.Silver.length, 4);
});

test('only the listed roles may authorise the JOC', () => {
  assert.deepEqual(quoted(fn('joc_authoriser_roles')), [...JOC_AUTHORISERS]);
});

test('the checklists and recovery tasks are the database\'s', () => {
  assert.deepEqual(quoted(fn('disaster_incident_checks')), [...SILVER_CHECKS, ...JOC_ACTIVATION, ...JOC_DUTIES].map((c) => c.key));
  assert.deepEqual(quoted(fn('disaster_recovery_tasks')), RECOVERY_TASKS.map((t) => t.key));
  assert.deepEqual(quoted(fn('disaster_review_signoffs')), REVIEW_SIGNOFFS.map((s) => s.key));
});

test('the status moves are the process\'s, and match the database', () => {
  assert.deepEqual(NEXT_STATUS.Active, ['Stood down', 'Closed']);
  assert.deepEqual(NEXT_STATUS.Closed, ['Active']);
  const body = fn('set_dm_status');
  assert.ok(body.includes("(v_was = 'Active' and p_status in ('Stood down', 'Closed'))"));
  assert.ok(body.includes("(v_was = 'Stood down' and p_status in ('In recovery', 'Closed', 'Active'))"));
  assert.ok(body.includes("(v_was = 'In recovery' and p_status in ('Closed', 'Active'))"));
  assert.ok(body.includes("(v_was = 'Closed' and p_status = 'Active')"));
});

test('a task is open until it is done or handed over', () => {
  assert.equal(openRecoveryTasks({}), 8);
  assert.equal(openRecoveryTasks({ debris: { state: 'Done' }, funding: { state: 'Handed over' }, services: { state: 'In progress' } }), 6);
});
