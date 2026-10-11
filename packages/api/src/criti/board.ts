import type { CriticomClient } from '@criticom/db';
import { listOnDutyOfficers } from '../incidents/index';
import { getOperationalSettings } from '../settings/index';
import { teamOf } from './insights.ts';
import { DEFAULT_THRESHOLDS, type CritiCrew, type CritiIncident, type CritiMe, type CritiThresholds } from './types.ts';

/**
 * The live board Criti reasons over, read with the person's own session.
 * Row-level security decides what is on it: a department desk sees the
 * calls sent to it, a department's staff their department, the control room
 * everything. Nothing here widens that.
 */

/** The columns of a call Criti reads. */
export const CRITI_INCIDENT_COLUMNS = [
  'id', 'incident_number', 'silo', 'tagged_silos', 'dispatched_silos', 'incident_type', 'incident_category',
  'incident_severity', 'status', 'source', 'location_address', 'location_lat', 'location_lng', 'caller_name',
  'caller_number', 'call_timestamp', 'incident_created_at', 'dispatch_time', 'assigned_to', 'assigned_to_name',
  'assigned_at', 'accepted_by', 'accepted_at', 'arrived_timestamp', 'responding_officer', 'number_of_victims',
  'medical_type', 'created_by', 'updated_at',
].join(', ');

const SENT_NOT_DONE = '("New","Pending","Pending Dispatch","Pending Analysis","Closed","Resolved")';

export type CritiBoard = {
  incidents: CritiIncident[];
  crews: CritiCrew[];
  thresholds: CritiThresholds;
};

/**
 * The thresholds in force: the automatic rules' own minutes where the
 * database shares them (criti_thresholds, 0070), Operations Settings for the
 * rest, the code defaults when neither is there.
 */
export async function loadThresholds(client: CriticomClient): Promise<CritiThresholds> {
  const settings = await getOperationalSettings(client);
  const t: CritiThresholds = {
    ...DEFAULT_THRESHOLDS,
    noArrivalMinutes: settings['sla.response_target_minutes'] ?? DEFAULT_THRESHOLDS.noArrivalMinutes,
    onSceneMinutes: settings['sla.call_duration_target_minutes'] ?? DEFAULT_THRESHOLDS.onSceneMinutes,
    maxShiftHours: settings['duty.max_shift_hours'] ?? DEFAULT_THRESHOLDS.maxShiftHours,
    etaSpeedKmh: settings['dispatch.eta_speed_kmh'] ?? DEFAULT_THRESHOLDS.etaSpeedKmh,
    etaRoadFactor: settings['dispatch.eta_road_factor'] ?? DEFAULT_THRESHOLDS.etaRoadFactor,
  };
  try {
    const { data, error } = await client.rpc('criti_thresholds');
    if (error) throw error;
    const rules = (data ?? {}) as Record<string, { enabled?: boolean; config?: Record<string, unknown> } | undefined>;
    const num = (v: unknown, lo: number, hi: number) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
    };
    const late = rules.sla_unassigned?.config ?? {};
    t.lateWarnMinutes = num(late.warn_minutes, 1, 1440) ?? t.lateWarnMinutes;
    t.lateCriticalMinutes = Math.max(t.lateWarnMinutes, num(late.critical_minutes, 1, 1440) ?? t.lateCriticalMinutes);
    t.noArrivalMinutes = num(rules.sla_no_arrival?.config?.minutes, 1, 1440) ?? t.noArrivalMinutes;
    t.quietHours = num(rules.stale_incidents?.config?.hours, 1, 168) ?? t.quietHours;
  } catch {
    // Before 0070: the settings and defaults above.
  }
  return t;
}

export async function loadCritiBoard(client: CriticomClient, me: Pick<CritiMe, 'role' | 'silo'>): Promise<CritiBoard> {
  const team = teamOf(me);
  const [incidentsRes, crews, thresholds] = await Promise.all([
    client
      .from('incidents')
      .select(CRITI_INCIDENT_COLUMNS)
      .not('status', 'in', '("Closed","Resolved")')
      .order('incident_created_at', { ascending: false })
      .limit(400),
    listOnDutyOfficers(client, team === 'all' ? undefined : team).catch(() => [] as CritiCrew[]),
    loadThresholds(client),
  ]);
  if (incidentsRes.error) throw incidentsRes.error;
  const incidents = (incidentsRes.data ?? []) as unknown as CritiIncident[];

  // When each call last had news on its timeline (calls already sent out).
  const sent = incidents
    .filter((i) => !SENT_NOT_DONE.includes(`"${i.status}"`))
    .slice(0, 150)
    .map((i) => i.id);
  if (sent.length) {
    const { data: notes } = await client
      .from('incident_updates')
      .select('incident_id, timestamp')
      .in('incident_id', sent)
      .gte('timestamp', new Date(Date.now() - 24 * 3_600_000).toISOString())
      .order('timestamp', { ascending: false })
      .limit(2000);
    const latest = new Map<string, string>();
    for (const n of (notes ?? []) as Array<{ incident_id: string; timestamp: string }>) {
      if (!latest.has(n.incident_id)) latest.set(n.incident_id, n.timestamp);
    }
    for (const i of incidents) i.last_note_at = latest.get(i.id) ?? null;
  }

  return { incidents, crews, thresholds };
}
