import type {
  CriticomClient, Database, MapZoneKind, MapZoneShape, MapZoneVisibility, Silo,
} from '@criticom/db';

/**
 * Perimeters and zones drawn on the live map (migration 0053). Reads go
 * through RLS — each person gets only the zones shared with them — and
 * writes only through save_map_zone() / end_map_zone().
 */

export type MapZone = Database['public']['Tables']['map_zones']['Row'];
export type MapZoneEvent = Database['public']['Tables']['map_zone_events']['Row'];
export type MapZoneIncident = { id: string; incident_number: string; incident_type: string; status: string };
export type LiveMapZone = MapZone & { incident: MapZoneIncident | null };

const ZONE_COLUMNS =
  'id, tenant_id, silo, kind, shape, geometry, radius_m, area_m2, length_m, name, reason, incident_id, '
  + 'visibility, shared_silos, active_until, status, created_by, created_by_name, created_by_role, created_at, '
  + 'updated_by, updated_by_name, updated_at, ended_by, ended_by_name, ended_at, end_reason';

/**
 * Zones in force right now: not stood down, not past their end time, and
 * not tied to a call that has since closed.
 */
export async function listLiveMapZones(client: CriticomClient): Promise<LiveMapZone[]> {
  const { data, error } = await client
    .from('map_zones')
    .select(`${ZONE_COLUMNS}, incident:incidents(id, incident_number, incident_type, status)`)
    .eq('status', 'active')
    .or(`active_until.is.null,active_until.gt.${new Date().toISOString()}`)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as LiveMapZone[])
    .filter((z) => !z.incident || !['Closed', 'Resolved'].includes(z.incident.status));
}

/** Zones set against one call, live or stood down — the incident page's record. */
export async function listIncidentMapZones(client: CriticomClient, incidentId: string): Promise<MapZone[]> {
  const { data, error } = await client
    .from('map_zones')
    .select(ZONE_COLUMNS)
    .eq('incident_id', incidentId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as MapZone[];
}

export async function listMapZoneEvents(client: CriticomClient, zoneId: string): Promise<MapZoneEvent[]> {
  const { data, error } = await client
    .from('map_zone_events')
    .select('*')
    .eq('zone_id', zoneId)
    .order('at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export type SaveMapZoneInput = {
  /** Omit to set a new zone. */
  id?: string | null;
  kind: MapZoneKind;
  shape: MapZoneShape;
  geometry: { type: 'Polygon' | 'LineString' | 'Point'; coordinates: unknown };
  radiusM?: number | null;
  name: string;
  reason?: string | null;
  incidentId?: string | null;
  visibility: MapZoneVisibility;
  sharedSilos?: Silo[];
  activeUntil?: string | null;
};

export async function saveMapZone(client: CriticomClient, input: SaveMapZoneInput): Promise<MapZone> {
  const { data, error } = await client.rpc('save_map_zone', {
    p_id: input.id ?? null,
    p_kind: input.kind,
    p_shape: input.shape,
    p_geometry: input.geometry,
    p_radius_m: input.shape === 'circle' ? (input.radiusM ?? null) : null,
    p_name: input.name,
    p_reason: input.reason ?? null,
    p_incident_id: input.incidentId ?? null,
    p_visibility: input.visibility,
    p_shared_silos: input.visibility === 'departments' ? (input.sharedSilos ?? []) : [],
    p_active_until: input.activeUntil ?? null,
  });
  if (error) throw error;
  return data as MapZone;
}

/** Stand a zone down. It stays on record, with its history. */
export async function endMapZone(client: CriticomClient, id: string, reason: string | null): Promise<MapZone> {
  const { data, error } = await client.rpc('end_map_zone', { p_id: id, p_reason: reason });
  if (error) throw error;
  return data as MapZone;
}

export type MapZoneChange = { event: 'INSERT' | 'UPDATE' | 'DELETE'; zone: MapZone | null };

let channelSeq = 0;

/**
 * Zones as they are set, changed and stood down. Realtime applies the same
 * RLS as a read, so each console hears only about zones it may see.
 */
export function subscribeMapZones(client: CriticomClient, onChange: (change: MapZoneChange) => void) {
  const channel = client
    .channel(`map-zones:${++channelSeq}:${Math.random().toString(36).slice(2, 8)}`)
    .on(
      'postgres_changes' as never,
      { event: '*', schema: 'public', table: 'map_zones' },
      (payload: { eventType: MapZoneChange['event']; new: MapZone | null }) =>
        onChange({ event: payload.eventType, zone: payload.new && 'id' in payload.new ? payload.new : null }),
    )
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}
