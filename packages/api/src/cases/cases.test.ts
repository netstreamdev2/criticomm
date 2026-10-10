import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanSearch, departmentsOf, formatElapsed, minutesBetween, saDateBounds, summariseCases,
  type OpenCaseRow, type RecentCaseRow,
} from './stage.ts';

/**
 * The case manager's figures (0061). A wrong "awaiting review" count means a
 * filed report nobody reads; a wrong "today" means a shift that thinks the
 * queue is clear at 01:00 because the server counted in UTC.
 */

test('a control-room call belongs to the departments it was sent to; unsent, to the control room', () => {
  assert.deepEqual(departmentsOf({ silo: 'Ethekwini', dispatched_silos: ['MetroPolice'] }), ['MetroPolice']);
  assert.deepEqual(departmentsOf({ silo: 'Ethekwini', dispatched_silos: [] }), ['Ethekwini']);
  assert.deepEqual(departmentsOf({ silo: 'MetroPolice', dispatched_silos: ['MetroPolice', 'Medical'] }).sort(), ['Medical', 'MetroPolice']);
  assert.deepEqual(departmentsOf({ silo: 'MetroFire', dispatched_silos: null }), ['MetroFire']);
});

test('a date filter covers whole SA days and ignores anything that is not a date', () => {
  assert.deepEqual(saDateBounds('2026-10-01', '2026-10-08'), {
    from: '2026-09-30T22:00:00.000Z',
    to: '2026-10-08T21:59:59.999Z',
  });
  assert.deepEqual(saDateBounds('yesterday', '2026-13-40'), {});
  assert.deepEqual(saDateBounds('2026-02-30', null), {});
  assert.deepEqual(saDateBounds(null, undefined), {});
});

test('search text cannot break or rewrite the filter', () => {
  assert.equal(cleanSearch('Dlamini, S.'), 'Dlamini S.');
  assert.equal(cleanSearch('x),status.eq.Closed,(y'), 'x status.eq.Closed y');
  assert.equal(cleanSearch('100%*'), '100');
  assert.equal(cleanSearch(null), '');
  assert.equal(cleanSearch('a'.repeat(200)).length, 80);
});

test('durations read the way a shift says them', () => {
  assert.equal(formatElapsed(0), '0 min');
  assert.equal(formatElapsed(45), '45 min');
  assert.equal(formatElapsed(60), '1 h');
  assert.equal(formatElapsed(125), '2 h 5 min');
  assert.equal(formatElapsed(60 * 24 * 3 + 60 * 4), '3 d 4 h');
  assert.equal(formatElapsed(null), '—');
  assert.equal(formatElapsed(-5), '—');
  assert.equal(minutesBetween('2026-10-08T10:00:00Z', '2026-10-08T10:45:00Z'), 45);
  assert.equal(minutesBetween('2026-10-08T10:45:00Z', '2026-10-08T10:00:00Z'), null, 'never negative');
  assert.equal(minutesBetween(null, '2026-10-08T10:00:00Z'), null);
});

test('the dashboard counts what waits for review, what is live, and how long each step takes', () => {
  const open: OpenCaseRow[] = [
    { silo: 'Ethekwini', dispatched_silos: ['MetroPolice'], status: 'Resolved', resolved_at: '2026-10-08T09:00:00Z', report_filed_at: '2026-10-08T09:00:00Z', updated_at: '2026-10-08T09:00:00Z' },
    { silo: 'MetroPolice', dispatched_silos: ['MetroPolice'], status: 'Resolved', resolved_at: null, report_filed_at: '2026-10-08T07:00:00Z', updated_at: '2026-10-08T07:00:00Z' },
    { silo: 'MetroPolice', dispatched_silos: ['MetroPolice'], status: 'On Scene', resolved_at: null, report_filed_at: null, updated_at: '2026-10-08T10:00:00Z' },
    { silo: 'Ethekwini', dispatched_silos: [], status: 'Pending Dispatch', resolved_at: null, report_filed_at: null, updated_at: '2026-10-08T10:00:00Z' },
  ];
  const recent: RecentCaseRow[] = [
    // Call at 08:00, report at 09:00 (60 min), closed at 09:30 (30 min review).
    { status: 'Closed', call_timestamp: '2026-10-08T08:00:00Z', resolved_at: '2026-10-08T09:00:00Z', report_filed_at: '2026-10-08T09:00:00Z', closed_at: '2026-10-08T09:30:00Z' },
    // Call at 06:00, report at 08:00 (120 min), still awaiting review.
    { status: 'Resolved', call_timestamp: '2026-10-08T06:00:00Z', resolved_at: null, report_filed_at: '2026-10-08T08:00:00Z', closed_at: null },
    // Cancelled live: no resolution, so it is in neither average.
    { status: 'Closed', call_timestamp: '2026-10-08T05:00:00Z', resolved_at: null, report_filed_at: null, closed_at: '2026-10-08T05:10:00Z' },
  ];
  const s = summariseCases(open, recent);
  assert.equal(s.awaitingReview, 2);
  assert.equal(s.live, 2);
  assert.equal(s.oldestReviewSince, '2026-10-08T07:00:00Z', 'the longest wait is the oldest report');
  assert.equal(s.avgResolveMins, 90);
  assert.equal(s.avgReviewMins, 30);
  assert.equal(s.resolvedInWindow, 2);
  assert.equal(s.closedInWindow, 2);
  const police = s.byDepartment.find((d) => d.department === 'MetroPolice');
  assert.deepEqual({ review: police?.review, live: police?.live }, { review: 2, live: 1 });
  const control = s.byDepartment.find((d) => d.department === 'Ethekwini');
  assert.deepEqual({ review: control?.review, live: control?.live }, { review: 0, live: 1 });
});

test('the control room drops off the breakdown once nothing waits there', () => {
  const s = summariseCases([], []);
  assert.equal(s.byDepartment.some((d) => d.department === 'Ethekwini'), false);
  assert.equal(s.byDepartment.length, 4);
  assert.equal(s.avgResolveMins, null);
  assert.equal(s.oldestReviewSince, null);
});
