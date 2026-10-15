import { tx } from '@criticom/db/i18n';

/**
 * A field officer's performance, worked out on the phone from their own
 * response history (incident_responders, migration 0042). No dependencies, so
 * it can be tested.
 *
 * What counts for an officer in the field — not the control room's "calls
 * taken / dispatched", which are always zero for them:
 *   attended      incidents responded to (lead + backup)
 *   to scene      responding → arrived, on incidents they led
 *   reports filed incident reports filed as lead
 *   resolved      attended incidents now resolved or closed
 */

export type PerfPeriod = 'Today' | 'This month' | 'This cycle';
export const PERF_PERIODS: readonly PerfPeriod[] = [tx('Today'), tx('This month'), tx('This cycle')];

export type ResponseRow = {
  role: 'lead' | 'backup';
  joined_at: string;
  incident: {
    id: string;
    incident_type: string | null;
    status: string;
    accepted_at: string | null;
    arrived_timestamp: string | null;
    resolved_at: string | null;
    report_filed_at: string | null;
  };
};

/** Start of a period on the phone's clock. The cycle runs 1 July → 30 June. */
export function periodStart(period: PerfPeriod, now = new Date()): Date {
  if (period === 'Today') return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'This month') return new Date(now.getFullYear(), now.getMonth(), 1);
  const year = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return new Date(year, 6, 1);
}

const minutes = (to: string, from: string) => (new Date(to).getTime() - new Date(from).getTime()) / 60_000;
const average = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);

export type PerfSummary = {
  attended: number;
  led: number;
  backup: number;
  resolved: number;
  reportsFiled: number;
  /** Minutes, responding → arrived, as lead; null with nothing to measure. */
  avgToScene: number | null;
  /** Minutes, arrived → resolved, as lead. */
  avgOnScene: number | null;
  topTypes: Array<{ type: string; count: number }>;
};

export function summarise(rows: readonly ResponseRow[], since: Date): PerfSummary {
  const inRange = rows.filter((r) => new Date(r.joined_at) >= since);
  const led = inRange.filter((r) => r.role === 'lead');

  // Bad clocks (arrived before responding) are left out rather than averaged in.
  const toScene = led
    .filter((r) => r.incident.accepted_at && r.incident.arrived_timestamp)
    .map((r) => minutes(r.incident.arrived_timestamp!, r.incident.accepted_at!))
    .filter((m) => m >= 0);
  const onScene = led
    .filter((r) => r.incident.arrived_timestamp && r.incident.resolved_at)
    .map((r) => minutes(r.incident.resolved_at!, r.incident.arrived_timestamp!))
    .filter((m) => m >= 0);

  const types = new Map<string, number>();
  for (const r of inRange) {
    const type = r.incident.incident_type?.trim() || tx('Other');
    types.set(type, (types.get(type) ?? 0) + 1);
  }

  return {
    attended: inRange.length,
    led: led.length,
    backup: inRange.length - led.length,
    resolved: inRange.filter((r) => r.incident.status === 'Resolved' || r.incident.status === 'Closed').length,
    reportsFiled: led.filter((r) => r.incident.report_filed_at).length,
    avgToScene: average(toScene),
    avgOnScene: average(onScene),
    topTypes: [...types.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
      .slice(0, 5),
  };
}

const MONTHS = [tx('Jan'), tx('Feb'), tx('Mar'), tx('Apr'), tx('May'), tx('Jun'), tx('Jul'), tx('Aug'), tx('Sep'), tx('Oct'), tx('Nov'), tx('Dec')];

/** Incidents attended in each of the last `months` months, oldest first. */
export function monthlyAttended(rows: readonly ResponseRow[], months = 6, now = new Date()) {
  const out: Array<{ label: string; count: number }> = [];
  for (let i = months - 1; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    out.push({
      label: MONTHS[start.getMonth()] ?? '',
      count: rows.filter((r) => {
        const t = new Date(r.joined_at);
        return t >= start && t < end;
      }).length,
    });
  }
  return out;
}

/** "12m", "1h 05m", or a dash. */
export function formatMinutes(m: number | null): string {
  if (m === null) return '—';
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}
