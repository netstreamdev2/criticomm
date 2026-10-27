import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DUTIES, EARLIER_HAZARD, HAZARDS, HAZARD_GROUPS, PRIORITY_RISKS, hazardGroup, priorityRisk } from './disaster-plan.ts';
import { departmentsFor } from './disaster-departments.ts';

/**
 * The desk's lists and the database's (0115) must say the same: a hazard the
 * form offers but the database refuses would stop the desk adding an
 * incident in the middle of an emergency.
 */

const sql = readFileSync(new URL('../../../supabase/migrations/0115_disaster_joc.sql', import.meta.url), 'utf8');
const fn = (name: string) => {
  const start = sql.indexOf(`function public.${name}(`);
  assert.ok(start >= 0, `0115 defines ${name}`);
  return sql.slice(start, sql.indexOf('$$;', start));
};
const quoted = (text: string) => [...text.matchAll(/'([^']+)'/g)].map((m) => m[1]!);

test('every hazard the desk offers is one the database accepts', () => {
  const accepted = new Set(quoted(fn('disaster_hazard_group')));
  for (const h of HAZARDS) assert.ok(accepted.has(h), `${h} is accepted`);
  for (const h of Object.keys(EARLIER_HAZARD)) assert.ok(accepted.has(h), `the earlier name ${h} is still accepted`);
});

test('the top ten risks lead the list, in the IDP order', () => {
  assert.equal(HAZARD_GROUPS[0]!.group, 'Top ten priority risks');
  assert.deepEqual(HAZARD_GROUPS[0]!.hazards, [...PRIORITY_RISKS]);
  assert.equal(PRIORITY_RISKS.length, 10);
  assert.equal(new Set(HAZARDS).size, HAZARDS.length, 'no hazard twice');
});

test('older records count towards their risk, the same way in the database', () => {
  const risk = fn('disaster_priority_risk');
  for (const [earlier, now] of Object.entries(EARLIER_HAZARD)) {
    assert.equal(priorityRisk(earlier), now);
    assert.ok(risk.includes(`when p = '${earlier}' then '${now}'`), `the database maps ${earlier}`);
    assert.equal(hazardGroup(earlier), 'Earlier names (2012 plan)');
  }
  assert.equal(priorityRisk('Floods'), 'Floods');
  assert.equal(priorityRisk('Hazardous materials accident'), null);
  assert.equal(priorityRisk('Drought'), null);
});

test('the duty roster lists the same duties as the database', () => {
  assert.deepEqual(quoted(fn('disaster_duties')), [...DUTIES]);
  assert.ok(DUTIES.includes('JOC Commander'));
});

test('every top ten risk suggests the departments that do the work', () => {
  for (const r of PRIORITY_RISKS) assert.ok(departmentsFor(r).length > 2, `${r} suggests departments`);
  assert.ok(departmentsFor('Floods').includes('water'));
  assert.ok(departmentsFor('Storm surge').includes('engineering'));
  assert.ok(departmentsFor('Fires in formal and informal settlements').includes('fire'));
  assert.ok(departmentsFor('Landslides').includes('engineering'));
  assert.ok(departmentsFor('Civil unrest and crime').includes('security'));
});
