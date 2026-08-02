import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPERATORS_BY_TYPE, sanitizeFilters, type ReportFilter } from './query.ts';
import { DATASETS, canQueryDataset, datasetsForRole, getDataset, getField } from './registry.ts';
import type { UserRole } from '@criticom/db';

/**
 * The report builder exists to let people compose queries, which is exactly
 * the shape of an injection surface. Its safety rests on one claim: the
 * registry is a whitelist, and anything not in it is dropped rather than
 * passed through. These tests pin that claim.
 */

const incidents = getDataset('incidents')!;

/* ── The whitelist actually filters ────────────────────────────────── */

test('a filter naming a column that is not in the registry is dropped', () => {
  const out = sanitizeFilters(incidents, [
    { field: 'caller_number', op: 'contains', value: '082' },
    // Real columns on the table, deliberately not exposed as report fields.
    { field: 'created_by', op: 'eq', value: 'x' },
    { field: 'location_point', op: 'eq', value: 'x' },
    // Not a column at all.
    { field: 'password', op: 'eq', value: 'x' },
    { field: 'id); drop table incidents;--', op: 'eq', value: 'x' },
  ] as ReportFilter[]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.field, 'caller_number');
});

test('an operator the field type does not support is dropped', () => {
  // status is an enum: `contains` and `gt` are not offered for enums.
  const out = sanitizeFilters(incidents, [
    { field: 'status', op: 'contains', value: 'Clo' },
    { field: 'status', op: 'gt', value: 'Closed' },
    { field: 'status', op: 'eq', value: 'Closed' },
  ] as ReportFilter[]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.op, 'eq');
});

test('an enum filter may only use values the enum actually has', () => {
  const ok = sanitizeFilters(incidents, [{ field: 'incident_severity', op: 'eq', value: 'Critical' }]);
  assert.equal(ok.length, 1);

  const bogus = sanitizeFilters(incidents, [{ field: 'incident_severity', op: 'eq', value: 'Catastrophic' }]);
  assert.equal(bogus.length, 0, 'a value outside the enum must not reach the query');

  const mixed = sanitizeFilters(incidents, [
    { field: 'status', op: 'in', values: ['Closed', 'NotAStatus', 'Active'] },
  ]);
  assert.deepEqual(mixed[0]!.values, ['Closed', 'Active'], 'unknown members are stripped, not the whole filter');
});

test('filters missing the operands their operator needs are dropped', () => {
  const out = sanitizeFilters(incidents, [
    { field: 'incident_created_at', op: 'between', value: '2026-01-01' }, // no upper bound
    { field: 'incident_type', op: 'contains', value: '' },
    { field: 'status', op: 'in', values: [] },
    { field: 'incident_type', op: 'contains', value: 'Fire' },
  ] as ReportFilter[]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.value, 'Fire');
});

test('operators needing no operand survive without one', () => {
  const out = sanitizeFilters(incidents, [
    { field: 'closed_at', op: 'isEmpty' },
    { field: 'acceptance', op: 'isTrue' },
  ] as ReportFilter[]);
  assert.equal(out.length, 2, 'isEmpty/isTrue are complete on their own');
});

test('lastDays rejects nonsense and out-of-range windows', () => {
  const good = sanitizeFilters(incidents, [{ field: 'incident_created_at', op: 'lastDays', value: 30 }]);
  assert.equal(good.length, 1);
  for (const bad of [0, -5, 99999, Number.NaN, 'abc' as unknown as number]) {
    const out = sanitizeFilters(incidents, [{ field: 'incident_created_at', op: 'lastDays', value: bad }]);
    assert.equal(out.length, 0, `lastDays should reject ${String(bad)}`);
  }
});

/* ── Dataset-level access ──────────────────────────────────────────── */

test('sensitive datasets are closed to ordinary roles', () => {
  const audit = getDataset('audit_logs')!;
  const leave = getDataset('leave_entries')!;
  for (const role of ['Firefighter', 'Dispatcher', 'Viewer', 'IncidentLogger'] as UserRole[]) {
    assert.equal(canQueryDataset(audit, role), false, `${role} must not report on the audit trail`);
  }
  assert.equal(canQueryDataset(audit, 'SystemAdmin'), true);
  assert.equal(canQueryDataset(leave, 'Supervisor'), true, 'supervisors run leave reports');
  assert.equal(canQueryDataset(leave, 'Firefighter'), false, 'a member may not report on everyone else’s leave');
});

test('datasetsForRole never offers a dataset the role cannot query', () => {
  for (const role of ['Viewer', 'Firefighter', 'Dispatcher', 'Supervisor', 'SystemAdmin'] as UserRole[]) {
    for (const d of datasetsForRole(role)) {
      assert.equal(canQueryDataset(d, role), true, `${role} was offered ${d.key} but cannot query it`);
    }
  }
});

/* ── Registry hygiene ──────────────────────────────────────────────── */

test('every dataset is internally consistent', () => {
  for (const d of DATASETS) {
    assert.ok(d.fields.length > 0, `${d.key} has no fields`);
    for (const c of d.defaultColumns) {
      assert.ok(getField(d, c), `${d.key}: default column "${c}" is not a declared field`);
    }
    assert.ok(getField(d, d.defaultSort.field), `${d.key}: default sort field is not declared`);
    if (d.dateColumn) assert.ok(getField(d, d.dateColumn), `${d.key}: dateColumn is not declared`);
    if (d.siloColumn) assert.ok(getField(d, d.siloColumn), `${d.key}: siloColumn is not declared`);

    const keys = d.fields.map((f) => f.key);
    assert.equal(new Set(keys).size, keys.length, `${d.key} has duplicate field keys`);

    for (const f of d.fields) {
      assert.ok(OPERATORS_BY_TYPE[f.type]?.length, `${d.key}.${f.key}: type "${f.type}" has no operators`);
      if (f.options) assert.ok(f.options.length > 0, `${d.key}.${f.key}: empty enum options`);
    }
  }
});

test('dataset keys are unique', () => {
  const keys = DATASETS.map((d) => d.key);
  assert.equal(new Set(keys).size, keys.length);
});
