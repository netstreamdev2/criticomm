import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMinutes, monthlyAttended, periodStart, summarise, type ResponseRow } from './performance.ts';

type RowOverrides = {
  role?: ResponseRow['role'];
  joined_at?: string;
  incident?: Partial<ResponseRow['incident']>;
};

const row = (over: RowOverrides = {}): ResponseRow => ({
  role: over.role ?? 'lead',
  joined_at: over.joined_at ?? '2026-10-02T08:00:00Z',
  incident: {
    id: 'i', incident_type: 'Assault', status: 'En Route',
    accepted_at: null, arrived_timestamp: null, resolved_at: null, report_filed_at: null,
    ...over.incident,
  },
});

test('the cycle starts on 1 July, the month on the 1st', () => {
  assert.equal(periodStart('This cycle', new Date(2026, 9, 2)).getMonth(), 6);
  assert.equal(periodStart('This cycle', new Date(2026, 9, 2)).getFullYear(), 2026);
  assert.equal(periodStart('This cycle', new Date(2027, 2, 2)).getFullYear(), 2026, 'March is still last July\'s cycle');
  assert.equal(periodStart('This month', new Date(2026, 9, 17)).getDate(), 1);
});

test('attended counts lead and backup; reports only count as lead', () => {
  const s = summarise([
    row({ role: 'lead', incident: { status: 'Resolved', report_filed_at: '2026-10-02T09:00:00Z' } }),
    row({ role: 'backup', incident: { status: 'Resolved', report_filed_at: '2026-10-02T09:00:00Z' } }),
    row({ role: 'lead' }),
  ], new Date('2026-10-01T00:00:00Z'));
  assert.equal(s.attended, 3);
  assert.equal(s.led, 2);
  assert.equal(s.backup, 1);
  assert.equal(s.reportsFiled, 1, "backup is not credited with the lead's report");
  assert.equal(s.resolved, 2);
});

test('time to scene averages the lead\'s responding → arrived, skipping bad clocks', () => {
  const s = summarise([
    row({ incident: { accepted_at: '2026-10-02T08:00:00Z', arrived_timestamp: '2026-10-02T08:10:00Z' } }),
    row({ incident: { accepted_at: '2026-10-02T08:00:00Z', arrived_timestamp: '2026-10-02T08:20:00Z' } }),
    row({ incident: { accepted_at: '2026-10-02T08:30:00Z', arrived_timestamp: '2026-10-02T08:00:00Z' } }),
    row({ role: 'backup', incident: { accepted_at: '2026-10-02T08:00:00Z', arrived_timestamp: '2026-10-02T09:00:00Z' } }),
  ], new Date('2026-10-01T00:00:00Z'));
  assert.equal(s.avgToScene, 15);
  assert.equal(summarise([], new Date()).avgToScene, null);
});

test('only rows inside the period count', () => {
  const s = summarise([row({ joined_at: '2026-09-30T10:00:00Z' }), row()], new Date('2026-10-01T00:00:00Z'));
  assert.equal(s.attended, 1);
});

test('monthly counts run oldest first and include empty months', () => {
  const m = monthlyAttended([row({ joined_at: new Date(2026, 9, 2).toISOString() })], 3, new Date(2026, 9, 15));
  assert.deepEqual(m.map((x) => x.label), ['Aug', 'Sep', 'Oct']);
  assert.deepEqual(m.map((x) => x.count), [0, 0, 1]);
});

test('minutes read as m or h mm', () => {
  assert.equal(formatMinutes(null), '—');
  assert.equal(formatMinutes(12), '12m');
  assert.equal(formatMinutes(65), '1h 05m');
});
