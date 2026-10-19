import { POLICE_REPORT_FORMS, getReportType } from './report-types.ts';

/**
 * Police reports as the reporting pages read them (V4's Reports →
 * Management, on real records): each report with its forms, its call and
 * where its case stands, and the counts the dashboard draws. No dependencies
 * beyond the report rules, so it can be tested.
 *
 * Where a report stands:
 *   Reviewed         its call was closed after the case manager read it;
 *   Awaiting review  filed on a call that is not closed yet;
 *   Console report   filed from the console, not on a dispatched call
 *                    (no review step).
 */

export type ReportStanding = 'Reviewed' | 'Awaiting review' | 'Console report';
export const REPORT_STANDINGS: readonly ReportStanding[] = ['Reviewed', 'Awaiting review', 'Console report'];
export const STANDING_TONE: Record<ReportStanding, string> = {
  Reviewed: '#22c55e',
  'Awaiting review': '#f59e0b',
  'Console report': '#38bdf8',
};

/** The case report on its own: the forms' companion, in the case report's colour. */
export const CASE_ONLY = { id: 'case', code: 'CASE', label: 'Case report only', tone: '#3b82f6' } as const;

/** The columns the reporting pages read, with the call they were filed on. */
export const REPORT_RECORD_COLUMNS = [
  'id', 'case_number', 'report_type', 'incident_category', 'officer_name', 'badge_number', 'station', 'location',
  'date_of_offense', 'time_of_offense', 'arrest_made', 'filed_at', 'created_at', 'incident_id',
  'incident:incidents(incident_number, incident_type, incident_severity, status, close_kind, dispatched_by)',
].join(', ');

export type PoliceReportRow = {
  id: string;
  case_number: string | null;
  report_type: string | null;
  incident_category: string | null;
  officer_name: string | null;
  badge_number: string | null;
  station: string | null;
  location: string | null;
  date_of_offense: string;
  time_of_offense: string | null;
  arrest_made: string | null;
  filed_at: string | null;
  created_at: string;
  incident_id: string | null;
  incident: {
    incident_number: string | null;
    incident_type: string | null;
    incident_severity: string | null;
    status: string | null;
    close_kind: string | null;
    dispatched_by: string | null;
  } | null;
};

export type ReportRecord = {
  id: string;
  caseNumber: string;
  /** The DMPS forms filed with it, by id; none for a case report on its own. */
  forms: string[];
  officer: string | null;
  badge: string | null;
  station: string | null;
  location: string | null;
  dispatcher: string | null;
  incidentId: string | null;
  incidentNumber: string | null;
  incidentType: string | null;
  severity: string | null;
  arrest: boolean;
  standing: ReportStanding;
  /** When it was filed (or made, for an older one). */
  at: string;
};

/** Where a report stands, from its call. A call the reader may not open reads as awaiting review. */
export function reportStanding(row: Pick<PoliceReportRow, 'incident_id' | 'incident'>): ReportStanding {
  if (!row.incident_id) return 'Console report';
  return row.incident?.status === 'Closed' && row.incident.close_kind !== 'Cancelled' ? 'Reviewed' : 'Awaiting review';
}

export function toReportRecord(row: PoliceReportRow): ReportRecord {
  const forms = (getReportType(row.report_type).forms ?? []).map((f) => f.id);
  return {
    id: row.id,
    caseNumber: row.case_number ?? row.incident?.incident_number ?? row.id.slice(0, 8),
    forms,
    officer: row.officer_name,
    badge: row.badge_number,
    station: row.station,
    location: row.location,
    dispatcher: row.incident?.dispatched_by ?? null,
    incidentId: row.incident_id,
    incidentNumber: row.incident?.incident_number ?? null,
    incidentType: row.incident?.incident_type ?? row.incident_category,
    severity: row.incident?.incident_severity ?? null,
    arrest: row.arrest_made === 'Yes',
    standing: reportStanding(row),
    at: row.filed_at ?? row.created_at,
  };
}

/** The forms a report is counted under: each DMPS form it carries, or the case report on its own. */
export const formsOf = (r: Pick<ReportRecord, 'forms'>): string[] => (r.forms.length ? r.forms : [CASE_ONLY.id]);

/** Every kind a report can be counted under, in the order the pages show them. */
export const REPORT_KINDS: ReadonlyArray<{ id: string; code: string; label: string; tone: string; summary?: string }> = [
  ...POLICE_REPORT_FORMS.map((f) => ({ id: f.id, code: f.code, label: f.label, tone: f.tone, summary: f.summary })),
  { ...CASE_ONLY, summary: 'A case report filed without a DMPS form.' },
];
export const reportKind = (id: string) => REPORT_KINDS.find((k) => k.id === id);

const SA_OFFSET_MS = 2 * 3_600_000;
/** The South African calendar day of an instant: "2026-10-16". */
const saDay = (at: string | number | Date) => new Date(new Date(at).getTime() + SA_OFFSET_MS).toISOString().slice(0, 10);

export type ReportFilters = {
  q?: string | null;
  form?: string | null;
  forms?: readonly string[] | null;
  standing?: ReportStanding | null;
  /** Days back from now: 1 today, 7 this week, 30 this month. */
  period?: 'today' | 'week' | 'month' | null;
  /** South African days, inclusive. */
  from?: string | null;
  to?: string | null;
  station?: string | null;
  officer?: string | null;
  arrest?: 'Yes' | 'No' | null;
};

/** The records that match, newest first. */
export function filterReports(records: readonly ReportRecord[], f: ReportFilters, now = new Date()): ReportRecord[] {
  const q = f.q?.trim().toLowerCase();
  const today = saDay(now);
  const since = f.period === 'today' ? today
    : f.period === 'week' ? saDay(now.getTime() - 6 * 86_400_000)
      : f.period === 'month' ? saDay(now.getTime() - 29 * 86_400_000) : null;
  const station = f.station?.trim().toLowerCase();
  const officer = f.officer?.trim().toLowerCase();
  const wanted = f.forms?.length ? new Set(f.forms) : f.form ? new Set([f.form]) : null;
  return records.filter((r) => {
    const day = saDay(r.at);
    if (q && ![r.caseNumber, r.officer, r.badge, r.station, r.location, r.dispatcher, r.incidentNumber, r.incidentType,
      ...r.forms.map((id) => reportKind(id)?.code), ...r.forms.map((id) => reportKind(id)?.label)]
      .some((v) => v?.toLowerCase().includes(q))) return false;
    if (wanted && !formsOf(r).some((id) => wanted.has(id))) return false;
    if (f.standing && r.standing !== f.standing) return false;
    if (since && day < since) return false;
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    if (station && !(r.station ?? '').toLowerCase().includes(station)) return false;
    if (officer && !(r.officer ?? '').toLowerCase().includes(officer)) return false;
    if (f.arrest === 'Yes' && !r.arrest) return false;
    if (f.arrest === 'No' && r.arrest) return false;
    return true;
  }).sort((a, b) => b.at.localeCompare(a.at));
}

export type ReportStats = {
  total: number;
  byStanding: Record<ReportStanding, number>;
  thisWeek: number;
  arrests: number;
  /** Reviewed of those that are reviewed, as a whole percentage; null with nothing to review. */
  reviewedPct: number | null;
  /** The last `days` South African days, oldest first, by standing. */
  byDay: Array<{ day: string; label: string } & Record<ReportStanding, number>>;
  /** Each kind: how many carry it and where they stand. A report with two forms counts under both. */
  byKind: Array<{ id: string; code: string; label: string; tone: string; count: number; reviewed: number; awaiting: number; pct: number }>;
  /** The busiest stations and officers. */
  byStation: Array<{ name: string; count: number }>;
  byOfficer: Array<{ name: string; count: number }>;
};

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function top(values: Array<string | null>, n = 8) {
  const counts = new Map<string, number>();
  for (const v of values) {
    const name = v?.trim();
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, n);
}

export function reportStats(records: readonly ReportRecord[], now = new Date(), days = 7): ReportStats {
  const byStanding = { Reviewed: 0, 'Awaiting review': 0, 'Console report': 0 } as Record<ReportStanding, number>;
  for (const r of records) byStanding[r.standing]++;
  const weekStart = saDay(now.getTime() - 6 * 86_400_000);
  const series = Array.from({ length: days }, (_, i) => {
    const t = now.getTime() - (days - 1 - i) * 86_400_000;
    const day = saDay(t);
    return { day, label: WEEKDAY[new Date(`${day}T12:00:00Z`).getUTCDay()]!, Reviewed: 0, 'Awaiting review': 0, 'Console report': 0 };
  });
  const index = new Map(series.map((d, i) => [d.day, i]));
  for (const r of records) {
    const i = index.get(saDay(r.at));
    if (i !== undefined) series[i]![r.standing]++;
  }
  const byKind = REPORT_KINDS.map((k) => {
    const mine = records.filter((r) => formsOf(r).includes(k.id));
    const reviewed = mine.filter((r) => r.standing === 'Reviewed').length;
    const awaiting = mine.filter((r) => r.standing === 'Awaiting review').length;
    const onCalls = reviewed + awaiting;
    return { id: k.id, code: k.code, label: k.label, tone: k.tone, count: mine.length, reviewed, awaiting, pct: onCalls ? Math.round((reviewed / onCalls) * 100) : 0 };
  });
  const onCalls = byStanding.Reviewed + byStanding['Awaiting review'];
  return {
    total: records.length,
    byStanding,
    thisWeek: records.filter((r) => saDay(r.at) >= weekStart).length,
    arrests: records.filter((r) => r.arrest).length,
    reviewedPct: onCalls ? Math.round((byStanding.Reviewed / onCalls) * 100) : null,
    byDay: series,
    byKind,
    byStation: top(records.map((r) => r.station)),
    byOfficer: top(records.map((r) => r.officer)),
  };
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  // A leading = + - @ is read as a formula by spreadsheets: kept as text.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** The records as CSV, for Excel. */
export function reportsCsv(records: readonly ReportRecord[]): string {
  const head = ['Case number', 'Forms', 'Standing', 'Filed', 'Officer', 'Badge', 'Station', 'Location', 'Dispatcher', 'Incident', 'Incident type', 'Arrest'];
  const lines = records.map((r) => [
    r.caseNumber, formsOf(r).map((id) => reportKind(id)?.code ?? id).join(' + '), r.standing, r.at, r.officer, r.badge,
    r.station, r.location, r.dispatcher, r.incidentNumber, r.incidentType, r.arrest ? 'Yes' : 'No',
  ].map(csvCell).join(','));
  return [head.join(','), ...lines].join('\r\n');
}

/**
 * The days a report's graph covers: from its From (or its period) to its To
 * (or today), at most 92; the last 30 days when nothing narrows it.
 */
export function reportWindow(f: Pick<ReportFilters, 'from' | 'to' | 'period'>, now = new Date()): { now: Date; days: number } {
  const end = f.to ? new Date(`${f.to}T12:00:00+02:00`) : now;
  const endDay = saDay(end);
  const fromDays = f.from ? Math.round((Date.parse(`${endDay}T12:00:00Z`) - Date.parse(`${f.from}T12:00:00Z`)) / 86_400_000) + 1 : null;
  const days = fromDays ?? (f.period === 'today' ? 1 : f.period === 'week' ? 7 : 30);
  return { now: end, days: Math.min(92, Math.max(1, days)) };
}
