import { TALK_DEPARTMENT_LABELS, TALK_TONES } from '../radio/talk.ts';

/**
 * The Active Responders terminal (V4's ResponderController.Monitor): every
 * call with crews still out, across the departments the reader may see,
 * with who is responding, where each department's part stands and how long
 * they have been on scene. Pure, so it can be tested; the rows come from the
 * reader's own session, so the database decides which calls are in it.
 *
 * V4 dropped a unit once it arrived; here the board keeps it, as "On scene",
 * with V4's time-on-scene clock, until the call is resolved or closed.
 */

/** The statuses of a call with crews out. */
export const BOARD_STATUSES = ['Dispatched', 'En Route', 'Arrived', 'On Scene', 'Transporting', 'Active'] as const;

export type BoardPhase = 'responding' | 'on_scene' | 'transporting';

export const PHASE_LABEL: Record<BoardPhase, string> = {
  responding: 'Responding',
  on_scene: 'On scene',
  transporting: 'Transporting',
};
export const PHASE_TONE: Record<BoardPhase, string> = {
  responding: '#f59e0b',
  on_scene: '#22c55e',
  transporting: '#a855f7',
};
export const SEVERITY_TONE: Record<string, string> = { Low: '#22c55e', Medium: '#f59e0b', High: '#f97316', Critical: '#ef4444' };

export function phaseOf(status: string | null | undefined): BoardPhase {
  if (status === 'Arrived' || status === 'On Scene') return 'on_scene';
  if (status === 'Transporting') return 'transporting';
  return 'responding';
}

export type BoardRow = {
  id: string;
  incident_number: string;
  incident_type: string | null;
  incident_category?: string | null;
  incident_code?: string | null;
  incident_severity: string | null;
  status: string;
  silo: string;
  dispatched_silos?: string[] | null;
  caller_name?: string | null;
  location_address?: string | null;
  call_description?: string | null;
  dispatch_time?: string | null;
  arrived_timestamp?: string | null;
  responding_officer?: string | null;
  incident_created_at?: string | null;
  responders?: Array<{ user_id: string; name: string | null; silo: string; role: string; status: string; joined_at: string }> | null;
  departments?: Array<{
    silo: string; status: string; dispatched_at: string | null; arrived_at: string | null;
    lead_name: string | null; assigned_to_name: string | null;
  }> | null;
};

export type BoardDepartment = { silo: string; label: string; tone: string; status: string | null; lead: string | null };
export type BoardCrew = { userId: string; name: string; role: 'lead' | 'backup'; status: string; silo: string };

export type BoardEntry = {
  id: string;
  number: string;
  type: string;
  classification: string | null;
  code: string | null;
  severity: string;
  status: string;
  phase: BoardPhase;
  departments: BoardDepartment[];
  crew: BoardCrew[];
  /** Who leads: the crew's lead, else the call's responding officer. */
  lead: string | null;
  callerName: string | null;
  location: string | null;
  narrative: string | null;
  dispatchedAt: string | null;
  arrivedAt: string | null;
  /** Seconds since dispatch, and since arrival (null until on scene). */
  sinceDispatchS: number | null;
  onSceneS: number | null;
};

const CLOSED_PARTS = new Set(['Resolved', 'Not needed', 'Cancelled']);
const earliest = (values: Array<string | null | undefined>): string | null =>
  values.filter((v): v is string => Boolean(v)).sort()[0] ?? null;
const secondsSince = (at: string | null, now: number): number | null => {
  if (!at) return null;
  const t = Date.parse(at);
  return Number.isNaN(t) ? null : Math.max(0, Math.round((now - t) / 1000));
};
const dept = (silo: string, status: string | null, lead: string | null): BoardDepartment => ({
  silo, label: TALK_DEPARTMENT_LABELS[silo] ?? silo, tone: TALK_TONES[silo] ?? '#64748b', status, lead,
});

export function toBoardEntry(row: BoardRow, now = Date.now()): BoardEntry {
  const parts = (row.departments ?? []).filter((p) => !CLOSED_PARTS.has(p.status));
  const departments = parts.length
    ? parts.map((p) => dept(p.silo, p.status, p.lead_name ?? p.assigned_to_name))
    : [...new Set([row.silo, ...(row.dispatched_silos ?? [])])].filter((s) => s !== 'Ethekwini').map((s) => dept(s, null, null));
  const crew: BoardCrew[] = (row.responders ?? [])
    .map((r) => ({ userId: r.user_id, name: r.name ?? 'An officer', role: (r.role === 'lead' ? 'lead' : 'backup') as 'lead' | 'backup', status: r.status, silo: r.silo }))
    .sort((a, b) => Number(b.role === 'lead') - Number(a.role === 'lead') || a.name.localeCompare(b.name));
  const dispatchedAt = row.dispatch_time ?? earliest(parts.map((p) => p.dispatched_at)) ?? row.incident_created_at ?? null;
  const arrivedAt = row.arrived_timestamp ?? earliest(parts.map((p) => p.arrived_at));
  const phase = phaseOf(row.status);
  return {
    id: row.id,
    number: row.incident_number,
    type: row.incident_type ?? 'General',
    classification: row.incident_category ?? null,
    code: row.incident_code ?? null,
    severity: row.incident_severity ?? 'Low',
    status: row.status,
    phase,
    departments,
    crew,
    lead: crew.find((c) => c.role === 'lead')?.name ?? row.responding_officer ?? null,
    callerName: row.caller_name ?? null,
    location: row.location_address ?? null,
    narrative: row.call_description ?? null,
    dispatchedAt,
    arrivedAt,
    sinceDispatchS: secondsSince(dispatchedAt, now),
    onSceneS: phase === 'responding' ? null : secondsSince(arrivedAt, now),
  };
}

export type BoardFilters = { q?: string | null; department?: string | null; severity?: string | null; phase?: BoardPhase | null };

/** The entries that match, the most urgent first: severity, then the longest out. */
export function filterBoard(entries: readonly BoardEntry[], f: BoardFilters): BoardEntry[] {
  const q = f.q?.trim().toLowerCase();
  const rank: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  return entries.filter((e) => {
    if (f.department && !e.departments.some((d) => d.silo === f.department)) return false;
    if (f.severity && e.severity !== f.severity) return false;
    if (f.phase && e.phase !== f.phase) return false;
    if (q && ![e.number, e.type, e.classification, e.code, e.callerName, e.location, e.lead, ...e.crew.map((c) => c.name)]
      .some((v) => v?.toLowerCase().includes(q))) return false;
    return true;
  }).sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) || (b.sinceDispatchS ?? 0) - (a.sinceDispatchS ?? 0));
}

export function boardCounts(entries: readonly BoardEntry[]) {
  return {
    total: entries.length,
    responding: entries.filter((e) => e.phase === 'responding').length,
    onScene: entries.filter((e) => e.phase === 'on_scene').length,
    transporting: entries.filter((e) => e.phase === 'transporting').length,
    critical: entries.filter((e) => e.severity === 'Critical').length,
    officers: new Set(entries.flatMap((e) => e.crew.map((c) => c.userId))).size,
    longestOnSceneS: entries.reduce<number | null>((m, e) => (e.onSceneS !== null && (m === null || e.onSceneS > m) ? e.onSceneS : m), null),
  };
}

/** 45s · 12m 05s · 1h 05m, as V4's time-on-scene clock read. */
export function formatBoardDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(r).padStart(2, '0')}s`;
  return `${r}s`;
}
