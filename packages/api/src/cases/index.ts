import type { CriticomClient, Database } from '@criticom/db';
import { saDayStart } from '../admin/assets';
import {
  CASE_DEPARTMENTS, cleanSearch, saDateBounds, summariseCases,
  type CaseSummary, type OpenCaseRow, type RecentCaseRow,
} from './stage';

export * from './stage';

/**
 * Case management (migration 0061): the review queue, the case registers and
 * the dashboard figures. Every query runs through the caller's own row
 * security: a control-room case manager sees the whole tenant, a department
 * case manager or commander their department, and nobody another tenant.
 */

type Incident = Database['public']['Tables']['incidents']['Row'];

export type CaseView = 'review' | 'live' | 'closed' | 'all';

export type CaseFilters = {
  view: CaseView;
  /** A department: cases it owns or was sent to. */
  department?: string | null;
  q?: string | null;
  severity?: string | null;
  /** SA calendar days, YYYY-MM-DD, on when the call came in. */
  from?: string | null;
  to?: string | null;
  limit?: number;
};

/** The report that resolved a case, if one was filed. */
export type CaseReportRef = {
  kind: 'police' | 'fire';
  /** Police report type id (e.g. "arrest"), or the fire report number. */
  label: string | null;
  officer: string | null;
  filedAt: string | null;
};

export type CaseRow = Incident & { report: CaseReportRef | null };

const LIVE_EXCLUDED = '("Resolved","Closed")';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The department filter as a PostgREST expression: owned by it, or sent to it. */
function departmentExpr(department: string) {
  return `silo.eq.${department},dispatched_silos.cs.{${department}}`;
}

function searchExpr(q: string) {
  const like = `%${q}%`;
  return [
    `incident_number.ilike.${like}`,
    `caller_name.ilike.${like}`,
    `location_address.ilike.${like}`,
    `incident_type.ilike.${like}`,
    `responding_officer.ilike.${like}`,
  ].join(',');
}

const isDepartment = (d: string | null | undefined): d is string =>
  Boolean(d) && ([...CASE_DEPARTMENTS, 'Ethekwini'] as string[]).includes(d as string);

/**
 * One register of cases, newest on top: review by newest report filed, live
 * by newest call, closed by most recently closed.
 */
export async function listCases(
  client: CriticomClient,
  filters: CaseFilters,
): Promise<{ rows: CaseRow[]; truncated: boolean }> {
  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 500);
  let query = client.from('incidents').select('*');

  if (filters.view === 'review') {
    query = query.eq('status', 'Resolved')
      .order('report_filed_at', { ascending: false, nullsFirst: false })
      .order('resolved_at', { ascending: false, nullsFirst: false });
  } else if (filters.view === 'live') {
    query = query.not('status', 'in', LIVE_EXCLUDED).order('call_timestamp', { ascending: false });
  } else if (filters.view === 'closed') {
    query = query.eq('status', 'Closed').order('closed_at', { ascending: false, nullsFirst: false });
  } else {
    query = query.order('call_timestamp', { ascending: false });
  }

  const q = cleanSearch(filters.q);
  const department = isDepartment(filters.department) ? filters.department : null;
  // Two OR groups must both hold. One `or` filter carrying an `and` of both
  // keeps that explicit in the filter language rather than relying on how
  // repeated parameters combine.
  if (department && q) {
    query = query.or(`and(or(${departmentExpr(department)}),or(${searchExpr(q)}))`);
  } else if (department) {
    query = query.or(departmentExpr(department));
  } else if (q) {
    query = query.or(searchExpr(q));
  }

  if (filters.severity && ['Critical', 'High', 'Medium', 'Low'].includes(filters.severity)) {
    query = query.eq('incident_severity', filters.severity as Incident['incident_severity']);
  }
  const bounds = saDateBounds(filters.from, filters.to);
  if (bounds.from) query = query.gte('call_timestamp', bounds.from);
  if (bounds.to) query = query.lte('call_timestamp', bounds.to);

  const { data, error } = await query.limit(limit + 1);
  if (error) throw error;
  // An SOS dismissed as a mistake (0093) is not a case to review.
  const incidents = ((data ?? []) as Array<Incident & { sos_dismissed_at?: string | null }>)
    .filter((i) => filters.view !== 'review' || !i.sos_dismissed_at) as Incident[];
  const truncated = incidents.length > limit;
  const page = incidents.slice(0, limit);

  const reports = await listCaseReports(client, page.map((i) => i.id));
  return { rows: page.map((i) => ({ ...i, report: reports.get(i.id) ?? null })), truncated };
}

/**
 * The filed police and fire reports for a set of cases. A report the caller
 * may not read (row security) is simply absent; a missing table (a migration
 * not yet run) reads as no reports rather than failing the register.
 */
export async function listCaseReports(
  client: CriticomClient,
  incidentIds: string[],
): Promise<Map<string, CaseReportRef>> {
  const out = new Map<string, CaseReportRef>();
  if (incidentIds.length === 0) return out;
  const [police, fire] = await Promise.all([
    client.from('metro_reports')
      .select('incident_id, report_type, officer_name, filed_at, created_at')
      .in('incident_id', incidentIds),
    client.from('firefighter_reports')
      .select('incident_id, report_number, reporting_officer_name, report_submission_date')
      .in('incident_id', incidentIds),
  ]);
  for (const r of (police.data ?? []) as Array<{ incident_id: string | null; report_type: string | null; officer_name: string | null; filed_at: string | null; created_at: string }>) {
    if (!r.incident_id || out.has(r.incident_id)) continue;
    out.set(r.incident_id, { kind: 'police', label: r.report_type, officer: r.officer_name, filedAt: r.filed_at ?? r.created_at });
  }
  for (const r of (fire.data ?? []) as Array<{ incident_id: string | null; report_number: string | null; reporting_officer_name: string | null; report_submission_date: string | null }>) {
    if (!r.incident_id || out.has(r.incident_id)) continue;
    out.set(r.incident_id, { kind: 'fire', label: r.report_number, officer: r.reporting_officer_name, filedAt: r.report_submission_date });
  }
  return out;
}

export type CaseDashboard = CaseSummary & {
  closedToday: number;
  reportsToday: number;
  /** The window behind the averages, in days. */
  windowDays: number;
};

/** Every figure on the case dashboard, in four reads. */
export async function getCaseDashboard(client: CriticomClient, windowDays = 30): Promise<CaseDashboard> {
  const today = saDayStart().toISOString();
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  const [open, recent, closedToday, reportsToday, dismissed] = await Promise.all([
    client.from('incidents')
      .select('id, silo, dispatched_silos, status, resolved_at, report_filed_at, updated_at')
      .neq('status', 'Closed')
      .limit(5000),
    client.from('incidents')
      .select('id, status, call_timestamp, resolved_at, report_filed_at, closed_at')
      .or(`resolved_at.gte."${since}",report_filed_at.gte."${since}",closed_at.gte."${since}"`)
      .limit(5000),
    client.from('incidents').select('id', { count: 'exact', head: true }).gte('closed_at', today),
    client.from('incidents').select('id', { count: 'exact', head: true }).gte('report_filed_at', today),
    // SOS calls dismissed as a mistake (0093) are not cases; before 0093 there are none.
    client.from('incidents').select('id').not('sos_dismissed_at', 'is', null).limit(5000)
      .then((r) => new Set(((r.data ?? []) as Array<{ id: string }>).map((x) => x.id)), () => new Set<string>()),
  ]);
  for (const res of [open, recent, closedToday, reportsToday]) {
    if (res.error) throw res.error;
  }

  return {
    ...summariseCases(
      ((open.data ?? []) as Array<OpenCaseRow & { id: string }>).filter((r) => !dismissed.has(r.id)),
      ((recent.data ?? []) as Array<RecentCaseRow & { id: string }>).filter((r) => !dismissed.has(r.id)),
    ),
    closedToday: closedToday.count ?? 0,
    reportsToday: reportsToday.count ?? 0,
    windowDays,
  };
}

/** Incident numbers for audit rows, keyed by incident id. */
export async function incidentNumbersFor(client: CriticomClient, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const real = [...new Set(ids)].filter((id) => UUID.test(id));
  if (real.length === 0) return out;
  const { data, error } = await client.from('incidents').select('id, incident_number').in('id', real);
  if (error) throw error;
  for (const r of data ?? []) out.set(r.id, r.incident_number);
  return out;
}

/**
 * The cases a reference names: an incident id, or an incident number. A
 * number is unique per department per day, not per tenant, so a number can
 * name a control-room call and a department's call at once; both are returned.
 */
export async function findCases(client: CriticomClient, ref: string): Promise<Array<{ id: string; incident_number: string; silo: string }>> {
  const raw = ref.trim();
  if (UUID.test(raw)) {
    const { data, error } = await client.from('incidents').select('id, incident_number, silo').eq('id', raw);
    if (error) throw error;
    return data ?? [];
  }
  const n = cleanSearch(raw).toUpperCase();
  if (!n) return [];
  const { data, error } = await client.from('incidents').select('id, incident_number, silo').eq('incident_number', n).limit(10);
  if (error) throw error;
  return data ?? [];
}
