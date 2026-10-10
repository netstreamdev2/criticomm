/**
 * Case management (migration 0061): the pure decisions behind the case
 * manager's dashboard and registers, kept free of the Supabase client so they
 * can be tested. The queries live in ./index.ts.
 *
 * A case moves through three stages, read straight from the incident status:
 *
 *   live    the call is being worked (pending, dispatched, en route, on scene…)
 *   review  the call is Resolved: its report is filed, waiting to be read
 *   closed  a case manager, command or the desk closed it
 */

/** Departments a case can belong to, in the order the console lists them. */
export const CASE_DEPARTMENTS = ['MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster'] as const;
export type CaseDepartment = (typeof CASE_DEPARTMENTS)[number];

export const DEPARTMENT_LABELS: Record<string, string> = {
  MetroPolice: 'Metro Police',
  MetroFire: 'Fire & Rescue',
  Medical: 'EMS',
  EthekwiniDisaster: 'Disaster Management',
  Ethekwini: 'Control room',
};

export const CASE_SEVERITIES = ['Critical', 'High', 'Medium', 'Low'] as const;

type DeptRow = { silo: string; dispatched_silos?: readonly string[] | null };

/**
 * The departments a case belongs to. A call the control room logged (silo
 * Ethekwini) belongs to the departments it was sent to; until it is sent, it
 * belongs to the control room.
 */
export function departmentsOf(row: DeptRow): string[] {
  const set = new Set<string>();
  if (row.silo !== 'Ethekwini') set.add(row.silo);
  for (const s of row.dispatched_silos ?? []) if (s !== 'Ethekwini') set.add(s);
  return set.size > 0 ? [...set] : ['Ethekwini'];
}

/* ── South African time ─────────────────────────────────────────────────── */

const SA_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
});

/** The SA calendar date (YYYY-MM-DD) of an instant. */
export function saDate(at: Date | string = new Date()): string {
  return SA_DATE.format(typeof at === 'string' ? new Date(at) : at);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A from/to date filter (YYYY-MM-DD, as SA calendar days) as instants:
 * from the start of the first day to the end of the last. Anything that is
 * not a real date is ignored rather than passed to the database.
 */
export function saDateBounds(from?: string | null, to?: string | null): { from?: string; to?: string } {
  const out: { from?: string; to?: string } = {};
  // 2026-02-30 parses, as 2 March: a real date reads back as itself.
  const real = (d: string) => {
    if (!ISO_DATE.test(d)) return false;
    const at = new Date(`${d}T00:00:00+02:00`);
    return !Number.isNaN(at.getTime()) && saDate(at) === d;
  };
  if (from && real(from)) out.from = new Date(`${from}T00:00:00+02:00`).toISOString();
  if (to && real(to)) out.to = new Date(`${to}T23:59:59.999+02:00`).toISOString();
  return out;
}

/* ── Search ─────────────────────────────────────────────────────────────── */

/**
 * Free text for an incident search, safe to embed in a PostgREST filter.
 * Commas, brackets, dots-with-operators and wildcards are how the filter
 * language is written, so a caller's name like "Dlamini, S." would otherwise
 * break the query or change its meaning.
 */
export function cleanSearch(q: string | null | undefined): string {
  return (q ?? '').replace(/[,()*%\\:"'{}]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

/* ── Time ───────────────────────────────────────────────────────────────── */

/** Whole minutes from `a` to `b`, or null when either is missing or b is before a. */
export function minutesBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.round(ms / 60000);
}

/**
 * "45 min", "2 h 5 min", "3 d 4 h": how long a case took or has waited. The
 * other duration formats stop at hours; a case can wait days for review.
 */
export function formatElapsed(mins: number | null | undefined): string {
  if (mins === null || mins === undefined || !Number.isFinite(mins) || mins < 0) return '—';
  const m = Math.round(mins);
  if (m < 60) return `${m} min`;
  if (m < 60 * 24) {
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h} h ${r} min` : `${h} h`;
  }
  const d = Math.floor(m / (60 * 24));
  const h = Math.floor((m % (60 * 24)) / 60);
  return h ? `${d} d ${h} h` : `${d} d`;
}

function average(values: Array<number | null>): number | null {
  const real = values.filter((v): v is number => v !== null);
  if (real.length === 0) return null;
  return Math.round(real.reduce((a, b) => a + b, 0) / real.length);
}

/* ── The dashboard figures ──────────────────────────────────────────────── */

export type OpenCaseRow = DeptRow & {
  status: string;
  resolved_at: string | null;
  report_filed_at: string | null;
  updated_at: string;
};

export type RecentCaseRow = {
  status: string;
  call_timestamp: string;
  resolved_at: string | null;
  report_filed_at: string | null;
  closed_at: string | null;
};

export type CaseSummary = {
  /** Resolved, waiting for a case manager. */
  awaitingReview: number;
  /** Still being worked. */
  live: number;
  /** When the case that has waited longest for review was resolved. */
  oldestReviewSince: string | null;
  /** Call received → resolved, over the window, in minutes. */
  avgResolveMins: number | null;
  /** Resolved → closed after review, over the window, in minutes. */
  avgReviewMins: number | null;
  /** Cases resolved / closed over the window (the sample behind the averages). */
  resolvedInWindow: number;
  closedInWindow: number;
  byDepartment: Array<{ department: string; label: string; review: number; live: number }>;
};

/** When a case finished being worked: its report, else its resolution. */
export function resolvedAtOf(row: { report_filed_at: string | null; resolved_at: string | null }): string | null {
  return row.report_filed_at ?? row.resolved_at;
}

export function summariseCases(open: OpenCaseRow[], recent: RecentCaseRow[]): CaseSummary {
  const review = open.filter((r) => r.status === 'Resolved');
  const live = open.filter((r) => r.status !== 'Resolved' && r.status !== 'Closed');

  const since = review
    .map((r) => resolvedAtOf(r) ?? r.updated_at)
    .sort()[0] ?? null;

  const resolved = recent.filter((r) => resolvedAtOf(r));
  const reviewed = recent.filter((r) => r.status === 'Closed' && r.closed_at && resolvedAtOf(r));

  const departments = [...CASE_DEPARTMENTS, 'Ethekwini'];
  const byDepartment = departments
    .map((department) => ({
      department,
      label: DEPARTMENT_LABELS[department] ?? department,
      review: review.filter((r) => departmentsOf(r).includes(department)).length,
      live: live.filter((r) => departmentsOf(r).includes(department)).length,
    }))
    // The control room only appears while it holds calls nobody was sent to.
    .filter((d) => d.department !== 'Ethekwini' || d.review + d.live > 0);

  return {
    awaitingReview: review.length,
    live: live.length,
    oldestReviewSince: since,
    avgResolveMins: average(resolved.map((r) => minutesBetween(r.call_timestamp, resolvedAtOf(r)))),
    avgReviewMins: average(reviewed.map((r) => minutesBetween(resolvedAtOf(r), r.closed_at))),
    resolvedInWindow: resolved.length,
    closedInWindow: recent.filter((r) => r.status === 'Closed').length,
    byDepartment,
  };
}
