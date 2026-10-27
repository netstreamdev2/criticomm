import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RELIEF_STEPS, RELIEF_STOCK_ITEMS, financialYear, wardCountsProblem } from './disaster-relief.ts';

/** Relief is counted the way the database (0118) keeps it, in the IDP's year. */

const sql = readFileSync(new URL('../../../supabase/migrations/0118_disaster_relief.sql', import.meta.url), 'utf8');
const fn = (name: string) => {
  const start = sql.indexOf(`function public.${name}(`);
  assert.ok(start >= 0, `0118 defines ${name}`);
  return sql.slice(start, sql.indexOf('$$;', start));
};
const quoted = (text: string) => [...text.matchAll(/'([^']+)'/g)].map((m) => m[1]!);

test('the relief checklist and the stock items are the database\'s', () => {
  const checks = quoted(fn('disaster_incident_checks'));
  assert.deepEqual(checks.filter((k) => k.startsWith('relief_')), RELIEF_STEPS.map((s) => s.key));
  const names = fn('disaster_check_name');
  for (const s of RELIEF_STEPS) assert.ok(names.includes(`then '${s.label}'`), `the database names ${s.key}`);
  assert.deepEqual(quoted(fn('relief_stock_items')), RELIEF_STOCK_ITEMS.map((i) => i.key));
});

test('the vulnerable groups are never more than the people helped', () => {
  assert.equal(wardCountsProblem({ people: 160, households: 40, disabled: 3, older: 12, under_five: 25 }), null);
  assert.match(wardCountsProblem({ people: 10, disabled: 12 }) ?? '', /cannot be more/);
  assert.match(wardCountsProblem({ older: 2 }) ?? '', /people helped too/);
  assert.match(wardCountsProblem({ people: 3, households: 5 }) ?? '', /Households/);
  assert.equal(wardCountsProblem({}), null);
});

test('the financial year runs July to June, in South African time', () => {
  assert.equal(financialYear(new Date('2026-10-27T10:00:00+02:00')).label, '2026/27');
  assert.equal(financialYear(new Date('2027-06-30T23:30:00+02:00')).label, '2026/27');
  assert.equal(financialYear(new Date('2027-06-30T22:30:00Z')).label, '2027/28', '00:30 on 1 July in Durban');
  assert.equal(financialYear(new Date('2026-03-01T00:00:00+02:00')).label, '2025/26');
  assert.equal(financialYear(new Date('2026-10-27T10:00:00+02:00')).start.toISOString(), '2026-06-30T22:00:00.000Z');
});
