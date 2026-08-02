import type { CriticomClient, Silo } from '@criticom/db';

/**
 * Operational KPIs at every level of the organisation.
 *
 * One computation, four scopes — organisation, department, unit/station and
 * individual — so a chief, a station commander and a member all read the same
 * numbers rather than three dashboards that disagree. Drilling down never
 * changes the definition of a metric, only the set of incidents it is computed
 * over.
 *
 * Everything is derived from incident timestamps that the system already
 * records as a side effect of working a call. Nothing here asks anyone to
 * enter a number, because a KPI that depends on self-reporting measures
 * diligence at data entry, not response.
 */

export type KpiLevel = 'organisation' | 'department' | 'unit' | 'individual';

export type Kpis = {
  /** Calls logged in the window. */
  volume: number;
  /** Reached a responder — dispatch_time set. */
  dispatched: number;
  /** Crew on scene — arrived_timestamp set. */
  arrived: number;
  closed: number;
  /** Still open at the end of the window. */
  open: number;

  /** Seconds from call logged → dispatched. The desk's number. */
  timeToDispatchP50: number | null;
  timeToDispatchP90: number | null;
  /** Seconds from dispatch → on scene. The crew's number. */
  travelP50: number | null;
  travelP90: number | null;
  /** Seconds from logged → on scene. What the caller experiences. */
  totalResponseP50: number | null;
  totalResponseP90: number | null;
  /** Seconds from logged → closed. */
  resolutionP50: number | null;

  /** Share of calls that reached a crew at all, 0–1. */
  dispatchRate: number;
  arrivalRate: number;
  closureRate: number;

  bySeverity: Record<string, number>;
  /** Critical/High calls only — the ones a target is actually written against. */
  criticalTotalResponseP90: number | null;
};

export type RollupNode = {
  level: KpiLevel;
  key: string;
  label: string;
  kpis: Kpis;
  /** Present for organisation/department/unit; the next level down. */
  children?: RollupNode[];
};

type IncidentRow = {
  id: string;
  silo: Silo;
  status: string;
  incident_severity: string | null;
  incident_created_at: string | null;
  dispatch_time: string | null;
  arrived_timestamp: string | null;
  closed_at: string | null;
  responding_officer: string | null;
  dispatched_by: string | null;
  call_taken_by: string | null;
  region: string | null;
  suburb: string | null;
};

const CLOSED = new Set(['Closed', 'Resolved']);

const secs = (from: string | null, to: string | null): number | null => {
  if (!from || !to) return null;
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / 1000);
};

/**
 * Nearest-rank percentile over the values that exist.
 *
 * Deliberately ignores nulls rather than treating them as zero: a call that
 * was never dispatched has no dispatch time, and counting it as instant would
 * flatter exactly the failure the metric is meant to expose. The volume and
 * rate fields are what reveal those gaps.
 */
function percentile(values: number[], p: number): number | null {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const rank = Math.ceil((p / 100) * v.length);
  return v[Math.min(Math.max(rank, 1), v.length) - 1] ?? null;
}

function computeKpis(rows: IncidentRow[]): Kpis {
  const toDispatch: number[] = [];
  const travel: number[] = [];
  const total: number[] = [];
  const resolution: number[] = [];
  const criticalTotal: number[] = [];
  const bySeverity: Record<string, number> = {};

  let dispatched = 0;
  let arrived = 0;
  let closed = 0;

  for (const r of rows) {
    const sev = r.incident_severity ?? 'Unspecified';
    bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;

    if (r.dispatch_time) dispatched++;
    if (r.arrived_timestamp) arrived++;
    if (CLOSED.has(r.status)) closed++;

    const d = secs(r.incident_created_at, r.dispatch_time);
    if (d !== null) toDispatch.push(d);

    const t = secs(r.dispatch_time, r.arrived_timestamp);
    if (t !== null) travel.push(t);

    const all = secs(r.incident_created_at, r.arrived_timestamp);
    if (all !== null) {
      total.push(all);
      if (sev === 'Critical' || sev === 'High') criticalTotal.push(all);
    }

    const res = secs(r.incident_created_at, r.closed_at);
    if (res !== null) resolution.push(res);
  }

  const n = rows.length;
  return {
    volume: n,
    dispatched,
    arrived,
    closed,
    open: n - closed,
    timeToDispatchP50: percentile(toDispatch, 50),
    timeToDispatchP90: percentile(toDispatch, 90),
    travelP50: percentile(travel, 50),
    travelP90: percentile(travel, 90),
    totalResponseP50: percentile(total, 50),
    totalResponseP90: percentile(total, 90),
    resolutionP50: percentile(resolution, 50),
    dispatchRate: n ? dispatched / n : 0,
    arrivalRate: n ? arrived / n : 0,
    closureRate: n ? closed / n : 0,
    bySeverity,
    criticalTotalResponseP90: percentile(criticalTotal, 90),
  };
}

const SILO_LABELS: Record<string, string> = {
  Ethekwini: 'eThekwini (all)',
  MetroPolice: 'Metro Police',
  MetroFire: 'Fire & Rescue',
  Medical: 'EMS',
  EthekwiniDisaster: 'Disaster Management',
};

export type RollupOptions = {
  /** ISO date (inclusive). Defaults to 30 days ago. */
  from?: string;
  /** ISO date (inclusive). Defaults to now. */
  to?: string;
  /** Restrict to one department; omit for the whole organisation. */
  silo?: Silo | null;
  /** Cap on incidents pulled. Percentiles over a truncated set are flagged. */
  limit?: number;
};

export type Rollup = {
  from: string;
  to: string;
  /** Organisation (or the single department when scoped), with children. */
  root: RollupNode;
  /** True when the row cap was hit — the numbers cover only part of the window. */
  truncated: boolean;
};

/**
 * Build the whole tree in one query.
 *
 * Organisation → department → station/region → member. The member level uses
 * `responding_officer`, which is the crew actually credited with the call; a
 * member with no attributed incidents simply does not appear rather than
 * showing as a row of zeroes that reads like poor performance.
 */
export async function getKpiRollup(
  client: CriticomClient,
  opts: RollupOptions = {},
): Promise<Rollup> {
  const to = opts.to ?? new Date().toISOString();
  const from = opts.from ?? new Date(Date.now() - 30 * 86_400_000).toISOString();
  const limit = Math.min(Math.max(opts.limit ?? 5000, 1), 20000);

  let q = client
    .from('incidents')
    .select(
      'id, silo, status, incident_severity, incident_created_at, dispatch_time, arrived_timestamp, closed_at, responding_officer, dispatched_by, call_taken_by, region, suburb',
    )
    .gte('incident_created_at', from)
    .lte('incident_created_at', to)
    .order('incident_created_at', { ascending: false })
    .limit(limit + 1);

  if (opts.silo) q = q.eq('silo', opts.silo);

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const all = (data ?? []) as IncidentRow[];
  const truncated = all.length > limit;
  const rows = truncated ? all.slice(0, limit) : all;

  const group = <T>(items: T[], key: (t: T) => string | null) => {
    const m = new Map<string, T[]>();
    for (const it of items) {
      const k = key(it);
      if (!k) continue;
      const list = m.get(k) ?? [];
      list.push(it);
      m.set(k, list);
    }
    return m;
  };

  const memberNodes = (items: IncidentRow[]): RollupNode[] =>
    [...group(items, (r) => r.responding_officer).entries()]
      .map(([name, list]) => ({
        level: 'individual' as const,
        key: name,
        label: name,
        kpis: computeKpis(list),
      }))
      .sort((a, b) => b.kpis.volume - a.kpis.volume);

  const unitNodes = (items: IncidentRow[]): RollupNode[] =>
    [...group(items, (r) => r.region ?? r.suburb).entries()]
      .map(([name, list]) => ({
        level: 'unit' as const,
        key: name,
        label: name,
        kpis: computeKpis(list),
        children: memberNodes(list),
      }))
      .sort((a, b) => b.kpis.volume - a.kpis.volume);

  const deptNodes = (items: IncidentRow[]): RollupNode[] =>
    [...group(items, (r) => r.silo).entries()]
      .map(([silo, list]) => ({
        level: 'department' as const,
        key: silo,
        label: SILO_LABELS[silo] ?? silo,
        kpis: computeKpis(list),
        children: unitNodes(list),
      }))
      .sort((a, b) => b.kpis.volume - a.kpis.volume);

  const root: RollupNode = opts.silo
    ? {
        level: 'department',
        key: opts.silo,
        label: SILO_LABELS[opts.silo] ?? opts.silo,
        kpis: computeKpis(rows),
        children: unitNodes(rows),
      }
    : {
        level: 'organisation',
        key: 'org',
        label: 'eThekwini Emergency Services',
        kpis: computeKpis(rows),
        children: deptNodes(rows),
      };

  return { from, to, root, truncated };
}

/** One member's own numbers, for the self-service view. */
export async function getMemberKpis(
  client: CriticomClient,
  args: { officerName: string; from?: string; to?: string; silo?: Silo | null },
): Promise<Kpis> {
  const to = args.to ?? new Date().toISOString();
  const from = args.from ?? new Date(Date.now() - 30 * 86_400_000).toISOString();

  let q = client
    .from('incidents')
    .select(
      'id, silo, status, incident_severity, incident_created_at, dispatch_time, arrived_timestamp, closed_at, responding_officer, dispatched_by, call_taken_by, region, suburb',
    )
    .eq('responding_officer', args.officerName)
    .gte('incident_created_at', from)
    .lte('incident_created_at', to)
    .limit(5000);
  if (args.silo) q = q.eq('silo', args.silo);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return computeKpis((data ?? []) as IncidentRow[]);
}

/** mm:ss / h:mm for a duration in seconds. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}
