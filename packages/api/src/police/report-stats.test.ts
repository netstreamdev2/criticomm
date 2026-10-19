import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterReports, reportStanding, reportStats, reportWindow, reportsCsv, toReportRecord, type PoliceReportRow } from './report-stats.ts';

const row = (extra: Partial<PoliceReportRow> = {}): PoliceReportRow => ({
  id: '00000000-0000-4000-8000-000000000001', case_number: 'CAS-1', report_type: 'arrest+tow', incident_category: null,
  officer_name: 'Const. Khumalo', badge_number: 'MP-1042', station: 'Durban Central', location: '112 Florida Road',
  date_of_offense: '2026-10-15', time_of_offense: null, arrest_made: 'Yes', filed_at: '2026-10-15T08:00:00Z',
  created_at: '2026-10-15T07:00:00Z', incident_id: 'i1',
  incident: { incident_number: 'MP-20261015-0958-0004', incident_type: 'Burglary', incident_severity: 'High', status: 'Resolved', close_kind: null, dispatched_by: 'Disp. Nkosi' },
  ...extra,
});
const now = new Date('2026-10-16T10:00:00Z');

test('where a report stands, from its call', () => {
  assert.equal(reportStanding(row()), 'Awaiting review');
  assert.equal(reportStanding(row({ incident: { ...row().incident!, status: 'Closed', close_kind: 'Reviewed' } })), 'Reviewed');
  assert.equal(reportStanding(row({ incident: { ...row().incident!, status: 'Closed', close_kind: 'Cancelled' } })), 'Awaiting review');
  assert.equal(reportStanding(row({ incident_id: null, incident: null })), 'Console report');
  assert.equal(reportStanding(row({ incident: null })), 'Awaiting review', 'a call the reader may not open');
});

test('a record carries its forms, its call and its dispatcher', () => {
  const r = toReportRecord(row());
  assert.deepEqual(r.forms, ['arrest', 'tow']);
  assert.equal(r.dispatcher, 'Disp. Nkosi');
  assert.equal(r.incidentNumber, 'MP-20261015-0958-0004');
  assert.equal(r.at, '2026-10-15T08:00:00Z');
  assert.deepEqual(toReportRecord(row({ report_type: 'case' })).forms, []);
});

test('the counts the dashboard draws, by standing, day and form', () => {
  const records = [
    toReportRecord(row()),
    toReportRecord(row({ id: 'b', report_type: 'dog', incident: { ...row().incident!, status: 'Closed', close_kind: 'Reviewed' }, filed_at: '2026-10-16T06:00:00Z' })),
    toReportRecord(row({ id: 'c', report_type: 'case', incident_id: null, incident: null, arrest_made: 'No', filed_at: '2026-09-01T06:00:00Z' })),
  ];
  const s = reportStats(records, now);
  assert.equal(s.total, 3);
  assert.deepEqual(s.byStanding, { Reviewed: 1, 'Awaiting review': 1, 'Console report': 1 });
  assert.equal(s.thisWeek, 2);
  assert.equal(s.arrests, 2);
  assert.equal(s.reviewedPct, 50);
  assert.equal(s.byDay.length, 7);
  assert.equal(s.byDay.at(-1)!.day, '2026-10-16');
  assert.equal(s.byDay.at(-1)!.Reviewed, 1);
  assert.equal(s.byDay.at(-2)!['Awaiting review'], 1);
  const kind = (id: string) => s.byKind.find((k) => k.id === id)!;
  assert.equal(kind('arrest').count, 1);
  assert.equal(kind('tow').count, 1, 'a report with two forms counts under both');
  assert.equal(kind('dog').pct, 100);
  assert.equal(kind('case').count, 1);
  assert.equal(s.byKind.length, 8, 'the seven forms and the case report');
  assert.deepEqual(s.byStation, [{ name: 'Durban Central', count: 3 }]);
});

test('filters: words, form, standing, period, days, station, officer, arrest', () => {
  const records = [
    toReportRecord(row()),
    toReportRecord(row({ id: 'b', report_type: 'dog', station: 'Umhlanga', officer_name: 'Sgt. Naidoo', arrest_made: 'No', filed_at: '2026-10-01T06:00:00Z' })),
  ];
  assert.equal(filterReports(records, { q: '211a' }, now).length, 1, 'by a form’s code');
  assert.equal(filterReports(records, { q: 'nkosi' }, now).length, 2, 'by the dispatcher');
  assert.equal(filterReports(records, { form: 'dog' }, now)[0]!.id, 'b');
  assert.equal(filterReports(records, { forms: ['tow', 'dog'] }, now).length, 2);
  assert.equal(filterReports(records, { standing: 'Reviewed' }, now).length, 0);
  assert.equal(filterReports(records, { period: 'week' }, now).length, 1);
  assert.equal(filterReports(records, { from: '2026-10-02', to: '2026-10-15' }, now).length, 1);
  assert.equal(filterReports(records, { station: 'umhl' }, now).length, 1);
  assert.equal(filterReports(records, { officer: 'naidoo' }, now).length, 1);
  assert.equal(filterReports(records, { arrest: 'Yes' }, now).length, 1);
  assert.equal(filterReports(records, {}, now)[0]!.id, row().id, 'newest first');
});

test('CSV: one line per report, a formula kept as text', () => {
  const csv = reportsCsv([toReportRecord(row({ location: '=HYPERLINK("x")' }))]);
  const [head, line] = csv.split('\r\n');
  assert.match(head!, /^Case number,Forms,Standing/);
  assert.match(line!, /^CAS-1,12A \+ 211A,Awaiting review,/);
  assert.match(line!, /"'=HYPERLINK\(""x""\)"/);
});

test('the days a report’s graph covers', () => {
  assert.deepEqual(reportWindow({}, now).days, 30);
  assert.equal(reportWindow({ period: 'week' }, now).days, 7);
  const w = reportWindow({ from: '2026-10-01', to: '2026-10-10' }, now);
  assert.equal(w.days, 10);
  assert.equal(reportStats([], w.now, w.days).byDay.at(-1)!.day, '2026-10-10');
  assert.equal(reportStats([], w.now, w.days).byDay[0]!.day, '2026-10-01');
  assert.equal(reportWindow({ from: '2020-01-01' }, now).days, 92, 'at most 92');
  assert.equal(reportWindow({ from: '2026-10-20', to: '2026-10-10' }, now).days, 1, 'backwards: one day');
});
