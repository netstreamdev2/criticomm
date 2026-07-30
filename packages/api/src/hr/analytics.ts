import type { CriticomClient, Database, Silo } from '@criticom/db';
import { listActiveConfig } from '../config/index';

type LeaveEntry = Database['public']['Tables']['leave_entries']['Row'];

/**
 * HR analytics — leave balances, the leave calendar, coverage impact, and the
 * three-axis performance reports (member / department / incident type).
 *
 * Everything here is read-only aggregation over tables that already exist;
 * the queries select only the columns they aggregate, and each public
 * function is a bounded number of round trips regardless of data size.
 */

/* ── Date helpers (calendar days, inclusive — how leave is granted) ── */

const DAY = 86_400_000;

export function inclusiveDays(fromIso: string, toIso: string): number {
  const from = new Date(fromIso.slice(0, 10)).getTime();
  const to = new Date(toIso.slice(0, 10)).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return 0;
  return Math.round((to - from) / DAY) + 1;
}

/** Days of [aFrom,aTo] that fall inside [bFrom,bTo], inclusive. */
function overlapDays(aFrom: string, aTo: string, bFrom: string, bTo: string): number {
  const from = Math.max(new Date(aFrom.slice(0, 10)).getTime(), new Date(bFrom.slice(0, 10)).getTime());
  const to = Math.min(new Date(aTo.slice(0, 10)).getTime(), new Date(bTo.slice(0, 10)).getTime());
  return to < from ? 0 : Math.round((to - from) / DAY) + 1;
}

/* ── Leave balances ─────────────────────────────────────────────────── */

export type LeaveBalance = {
  type: string;
  /** Annual entitlement days from the LeaveType config row (detail3). */
  entitlement: number;
  taken: number;
  pending: number;
  remaining: number;
};

/**
 * Entitlement vs usage per leave type for one member, over a calendar year.
 * Entitlements live on LeaveType config rows so HR tunes them from Admin →
 * Configuration; a type with no entitlement (Unpaid) reports remaining 0.
 */
export async function getLeaveBalances(
  client: CriticomClient,
  args: { userId: string; year?: number },
): Promise<LeaveBalance[]> {
  const year = args.year ?? new Date().getFullYear();
  const yearFrom = `${year}-01-01`;
  const yearTo = `${year}-12-31`;

  const [types, { data: entries }] = await Promise.all([
    listActiveConfig(client, 'LeaveType').catch(() => []),
    client
      .from('leave_entries')
      .select('absence, status, eff_from, eff_to')
      .eq('user_id', args.userId)
      .lte('eff_from', yearTo)
      .gte('eff_to', yearFrom),
  ]);

  const usage = new Map<string, { taken: number; pending: number }>();
  for (const e of entries ?? []) {
    const key = e.absence ?? 'Annual';
    const days = overlapDays(e.eff_from, e.eff_to, yearFrom, yearTo);
    const u = usage.get(key) ?? { taken: 0, pending: 0 };
    if (e.status === 'Approved') u.taken += days;
    else if (e.status === 'Pending') u.pending += days;
    usage.set(key, u);
  }

  return types.map((t) => {
    const name = t.name ?? '';
    const entitlement = Number(t.detail3) || 0;
    const u = usage.get(name) ?? { taken: 0, pending: 0 };
    return {
      type: name,
      entitlement,
      taken: u.taken,
      pending: u.pending,
      remaining: Math.max(0, entitlement - u.taken - u.pending),
    };
  });
}

/* ── Leave calendar ─────────────────────────────────────────────────── */

export type LeaveCalendarEntry = Pick<
  LeaveEntry, 'id' | 'silo' | 'user_id' | 'absence' | 'status' | 'eff_from' | 'eff_to'
> & { name: string };

/** Everyone off (or asking to be off) during a month, for the calendar grid. */
export async function getLeaveMonth(
  client: CriticomClient,
  args: { monthFirstDayIso: string; silo?: Silo },
): Promise<LeaveCalendarEntry[]> {
  const first = new Date(args.monthFirstDayIso.slice(0, 10));
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const lastIso = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;

  let q = client
    .from('leave_entries')
    .select('id, silo, user_id, absence, status, eff_from, eff_to, service_no')
    .neq('status', 'Rejected')
    .lte('eff_from', lastIso)
    .gte('eff_to', args.monthFirstDayIso.slice(0, 10));
  if (args.silo) q = q.eq('silo', args.silo);
  const { data, error } = await q;
  if (error) throw error;

  const rows = data ?? [];

  // Resolve display names in one shot from profiles.
  const userIds = [...new Set(rows.map((r) => r.user_id).filter((v): v is string => Boolean(v)))];
  const names = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles } = await client.from('profiles').select('id, full_name').in('id', userIds);
    for (const p of profiles ?? []) names.set(p.id, p.full_name ?? '');
  }

  return rows.map((r) => ({
    id: r.id,
    silo: r.silo,
    user_id: r.user_id,
    absence: r.absence,
    status: r.status,
    eff_from: r.eff_from,
    eff_to: r.eff_to,
    name: (r.user_id && names.get(r.user_id)) || r.service_no || 'Member',
  }));
}

/* ── Coverage impact ────────────────────────────────────────────────── */

export type CoverageImpact = {
  headcount: number;
  onLeave: number;
  /** Percent of the department away if this window is granted. */
  pct: number;
};

/**
 * How thin does the department run if leave over [from,to] is granted?
 * Counts distinct members with approved or pending leave overlapping the
 * window against the silo's active headcount — the number an approver needs
 * in front of them before clicking Approve.
 */
export async function getCoverageImpact(
  client: CriticomClient,
  args: { silo: Silo; from: string; to: string },
): Promise<CoverageImpact> {
  const [{ count: headcount }, { data: overlapping }] = await Promise.all([
    client.from('personnel').select('id', { count: 'exact', head: true }).eq('silo', args.silo),
    client
      .from('leave_entries')
      .select('user_id, service_no, status')
      .eq('silo', args.silo)
      .neq('status', 'Rejected')
      .lte('eff_from', args.to.slice(0, 10))
      .gte('eff_to', args.from.slice(0, 10)),
  ]);

  const distinct = new Set((overlapping ?? []).map((r) => r.user_id ?? `svc:${r.service_no}`));
  const total = headcount ?? 0;
  return {
    headcount: total,
    onLeave: distinct.size,
    pct: total > 0 ? Math.round((distinct.size / total) * 100) : 0,
  };
}

/** Approve/reject with the trail 0014 added. */
export async function setLeaveStatusWithTrail(
  client: CriticomClient,
  args: { id: string; status: 'Approved' | 'Rejected'; byName: string },
) {
  const { data, error } = await client
    .from('leave_entries')
    .update({
      status: args.status,
      approved_by: args.byName,
      approved_at: new Date().toISOString(),
    })
    .eq('id', args.id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/* ── Three-axis performance reports ─────────────────────────────────── */

export type MemberReportRow = {
  name: string;
  callsTaken: number;
  dispatches: number;
  responded: number;
  closed: number;
  avgCloseMins: number | null;
  leaveDays: number;
};

export type DepartmentReportRow = {
  silo: Silo;
  total: number;
  closed: number;
  closureRate: number;
  critical: number;
  avgCloseMins: number | null;
  headcount: number;
  onDutyNow: number;
  leaveDaysApproved: number;
};

export type IncidentTypeReportRow = {
  type: string;
  total: number;
  low: number; medium: number; high: number; critical: number;
  closed: number;
  avgCloseMins: number | null;
};

export type HrAnalytics = {
  from: string;
  to: string;
  members: MemberReportRow[];
  departments: DepartmentReportRow[];
  incidentTypes: IncidentTypeReportRow[];
};

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);

/**
 * One pass over the incident log, aggregated three ways. `silo` narrows every
 * axis; global staff omit it for the whole city. Capped at 5 000 incidents per
 * window — beyond that, narrow the range.
 */
export async function getHrAnalytics(
  client: CriticomClient,
  args: { from: string; to: string; silo?: Silo },
): Promise<HrAnalytics> {
  let incQ = client
    .from('incidents')
    .select('silo, incident_type, incident_severity, status, call_timestamp, closed_at, call_taken_by, dispatched_by, responding_officer')
    .gte('call_timestamp', args.from)
    .lte('call_timestamp', `${args.to.slice(0, 10)}T23:59:59.999Z`)
    .limit(5000);
  if (args.silo) incQ = incQ.eq('silo', args.silo);

  let leaveQ = client
    .from('leave_entries')
    .select('silo, user_id, service_no, status, eff_from, eff_to')
    .eq('status', 'Approved')
    .lte('eff_from', args.to.slice(0, 10))
    .gte('eff_to', args.from.slice(0, 10));
  if (args.silo) leaveQ = leaveQ.eq('silo', args.silo);

  let persQ = client.from('personnel').select('silo, user_id, first_name, last_name, is_on_duty');
  if (args.silo) persQ = persQ.eq('silo', args.silo);

  const [{ data: incidents, error: incErr }, { data: leave }, { data: personnel }] =
    await Promise.all([incQ, leaveQ, persQ]);
  if (incErr) throw incErr;

  const closedStatuses = new Set(['Resolved', 'Closed']);
  const closeMins = (i: { call_timestamp: string; closed_at: string | null }) =>
    i.closed_at ? Math.max(0, (new Date(i.closed_at).getTime() - new Date(i.call_timestamp).getTime()) / 60_000) : null;

  /* — by member — */
  type Acc = { callsTaken: number; dispatches: number; responded: number; closed: number; closeTimes: number[] };
  const members = new Map<string, Acc>();
  const acc = (name: string | null | undefined): Acc | null => {
    const key = name?.trim();
    if (!key) return null;
    let a = members.get(key);
    if (!a) { a = { callsTaken: 0, dispatches: 0, responded: 0, closed: 0, closeTimes: [] }; members.set(key, a); }
    return a;
  };
  for (const i of incidents ?? []) {
    const taker = acc(i.call_taken_by);
    if (taker) taker.callsTaken += 1;
    const dispatcher = acc(i.dispatched_by);
    if (dispatcher) dispatcher.dispatches += 1;
    const r = acc(i.responding_officer);
    if (r) {
      r.responded += 1;
      if (closedStatuses.has(i.status)) {
        r.closed += 1;
        const mins = closeMins(i);
        if (mins !== null) r.closeTimes.push(mins);
      }
    }
  }

  // Leave days per member name (resolve user_id → name via personnel).
  const nameByUser = new Map<string, string>();
  for (const p of personnel ?? []) {
    if (p.user_id) nameByUser.set(p.user_id, `${p.first_name} ${p.last_name}`.trim());
  }
  const leaveDaysByName = new Map<string, number>();
  for (const l of leave ?? []) {
    const name = (l.user_id && nameByUser.get(l.user_id)) || null;
    if (!name) continue;
    const days = overlapDays(l.eff_from, l.eff_to, args.from, args.to);
    leaveDaysByName.set(name, (leaveDaysByName.get(name) ?? 0) + days);
  }

  const memberRows: MemberReportRow[] = [...members.entries()]
    .map(([name, a]) => ({
      name,
      callsTaken: a.callsTaken,
      dispatches: a.dispatches,
      responded: a.responded,
      closed: a.closed,
      avgCloseMins: avg(a.closeTimes),
      leaveDays: leaveDaysByName.get(name) ?? 0,
    }))
    .sort((a, b) => (b.callsTaken + b.dispatches + b.responded) - (a.callsTaken + a.dispatches + a.responded));

  /* — by department — */
  type DeptAcc = { total: number; closed: number; critical: number; closeTimes: number[] };
  const depts = new Map<Silo, DeptAcc>();
  for (const i of incidents ?? []) {
    let d = depts.get(i.silo);
    if (!d) { d = { total: 0, closed: 0, critical: 0, closeTimes: [] }; depts.set(i.silo, d); }
    d.total += 1;
    if (i.incident_severity === 'Critical') d.critical += 1;
    if (closedStatuses.has(i.status)) {
      d.closed += 1;
      const mins = closeMins(i);
      if (mins !== null) d.closeTimes.push(mins);
    }
  }
  const headcountBySilo = new Map<Silo, { headcount: number; onDuty: number }>();
  for (const p of personnel ?? []) {
    const h = headcountBySilo.get(p.silo) ?? { headcount: 0, onDuty: 0 };
    h.headcount += 1;
    if (p.is_on_duty) h.onDuty += 1;
    headcountBySilo.set(p.silo, h);
  }
  const leaveDaysBySilo = new Map<Silo, number>();
  for (const l of leave ?? []) {
    const days = overlapDays(l.eff_from, l.eff_to, args.from, args.to);
    leaveDaysBySilo.set(l.silo, (leaveDaysBySilo.get(l.silo) ?? 0) + days);
  }

  const departmentRows: DepartmentReportRow[] = [...depts.entries()]
    .map(([silo, d]) => ({
      silo,
      total: d.total,
      closed: d.closed,
      closureRate: d.total > 0 ? Math.round((d.closed / d.total) * 100) : 0,
      critical: d.critical,
      avgCloseMins: avg(d.closeTimes),
      headcount: headcountBySilo.get(silo)?.headcount ?? 0,
      onDutyNow: headcountBySilo.get(silo)?.onDuty ?? 0,
      leaveDaysApproved: leaveDaysBySilo.get(silo) ?? 0,
    }))
    .sort((a, b) => b.total - a.total);

  /* — by incident type — */
  type TypeAcc = { total: number; low: number; medium: number; high: number; critical: number; closed: number; closeTimes: number[] };
  const types = new Map<string, TypeAcc>();
  for (const i of incidents ?? []) {
    let t = types.get(i.incident_type);
    if (!t) { t = { total: 0, low: 0, medium: 0, high: 0, critical: 0, closed: 0, closeTimes: [] }; types.set(i.incident_type, t); }
    t.total += 1;
    if (i.incident_severity === 'Low') t.low += 1;
    else if (i.incident_severity === 'Medium') t.medium += 1;
    else if (i.incident_severity === 'High') t.high += 1;
    else t.critical += 1;
    if (closedStatuses.has(i.status)) {
      t.closed += 1;
      const mins = closeMins(i);
      if (mins !== null) t.closeTimes.push(mins);
    }
  }
  const incidentTypeRows: IncidentTypeReportRow[] = [...types.entries()]
    .map(([type, t]) => ({
      type,
      total: t.total,
      low: t.low, medium: t.medium, high: t.high, critical: t.critical,
      closed: t.closed,
      avgCloseMins: avg(t.closeTimes),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 40);

  return { from: args.from, to: args.to, members: memberRows, departments: departmentRows, incidentTypes: incidentTypeRows };
}
