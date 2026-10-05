'use server';

import { endMapZone, saveMapZone } from '@criticom/api';
import { canDrawMapZones, type MapZoneKind, type MapZoneShape, type MapZoneVisibility, type Silo } from '@criticom/db';
import { getSession } from '@/lib/session';
import {
  SHARE_SILOS, VISIBILITY, ZONE_KINDS, dedupePoints, toGeometry, zoneProblem, type LatLng, type ZoneDraft,
} from '@/lib/ops-map/zones';

/**
 * Setting, changing and standing down perimeters on the live map (0053).
 * The form checks first; save_map_zone() / end_map_zone() have the final
 * word — role, geometry, who may change what — and keep the history and audit.
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

function failed(e: unknown, fallback: string): { ok: false; error: string } {
  const err = e as { code?: string; message?: string } | null;
  const message = err?.message ?? '';
  if (err?.code === 'PGRST202' || err?.code === 'PGRST205' || err?.code === '42P01'
      || /map_zone/.test(message) && /does not exist|schema cache|could not find/i.test(message)) {
    return { ok: false, error: 'Perimeters are not set up in this database yet: run migration 0053_map_zones.sql in Supabase, then try again.' };
  }
  if (err?.code === '23514') return { ok: false, error: 'The database refused that zone as it stands. Check the type, shape and sharing, then try again.' };
  return { ok: false, error: message || fallback };
}

const SHAPES: readonly MapZoneShape[] = ['polygon', 'circle', 'line', 'point'];
const KINDS = ZONE_KINDS.map((k) => k.key);
const VISIBILITIES = VISIBILITY.map((v) => v.key);

/** The form's data as sent from the browser, rebuilt from known values only. */
function cleanDraft(raw: unknown): ZoneDraft | null {
  const d = (raw ?? {}) as Record<string, unknown>;
  const shape = d.shape as MapZoneShape;
  const kind = d.kind as MapZoneKind;
  const visibility = d.visibility as MapZoneVisibility;
  if (!SHAPES.includes(shape) || !KINDS.includes(kind) || !VISIBILITIES.includes(visibility)) return null;
  const points: LatLng[] = (Array.isArray(d.points) ? d.points : []).slice(0, 501).map((p) => {
    const q = (p ?? {}) as Record<string, unknown>;
    return { lat: Number(q.lat), lng: Number(q.lng) };
  });
  const radius = d.radiusM == null ? null : Number(d.radiusM);
  const sharedSilos = (Array.isArray(d.sharedSilos) ? d.sharedSilos : [])
    .filter((s): s is Silo => SHARE_SILOS.includes(s as Silo));
  return {
    shape,
    kind,
    visibility,
    points: shape === 'polygon' || shape === 'line' ? dedupePoints(points) : points,
    radiusM: shape === 'circle' ? radius : null,
    name: String(d.name ?? '').trim().slice(0, 200),
    reason: String(d.reason ?? '').trim().slice(0, 2000),
    incidentId: typeof d.incidentId === 'string' && d.incidentId ? d.incidentId : null,
    sharedSilos,
    activeUntil: typeof d.activeUntil === 'string' && d.activeUntil ? d.activeUntil : null,
  };
}

export async function saveZoneAction(id: string | null, raw: ZoneDraft): Promise<Result<{ id: string }>> {
  const { supabase, role } = await getSession();
  if (!canDrawMapZones(role)) return { ok: false, error: 'Your role can see perimeters but not set them.' };
  const d = cleanDraft(raw);
  if (!d) return { ok: false, error: 'Choose the zone’s type, shape and who sees it.' };
  const problem = zoneProblem(d);
  if (problem) return { ok: false, error: problem };
  try {
    const zone = await saveMapZone(supabase, {
      id: typeof id === 'string' && id ? id : null,
      kind: d.kind,
      shape: d.shape,
      geometry: toGeometry(d),
      radiusM: d.radiusM,
      name: d.name,
      reason: d.reason || null,
      incidentId: d.incidentId,
      visibility: d.visibility,
      sharedSilos: d.sharedSilos,
      activeUntil: d.activeUntil,
    });
    return { ok: true, id: zone.id };
  } catch (e) {
    return failed(e, 'The zone could not be saved.');
  }
}

export async function endZoneAction(id: string, reason: string): Promise<Result> {
  const { supabase } = await getSession();
  if (typeof id !== 'string' || !id) return { ok: false, error: 'That zone was not found.' };
  try {
    await endMapZone(supabase, id, String(reason ?? '').trim().slice(0, 1000) || null);
    return { ok: true };
  } catch (e) {
    return failed(e, 'The zone could not be stood down.');
  }
}
