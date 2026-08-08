import { NextResponse } from 'next/server';
import { requireFeatureApi } from '@/lib/features';
import { listCameras } from '@criticom/api';
import { canAccess } from '@criticom/db/roles';
import type { Silo, UserRole } from '@criticom/db/types';
import { hikConfig, hikCredentials, hikListCameras } from '@/lib/hikvision';
import { getServerSupabase } from '@/lib/supabase';

/**
 * Unified camera inventory for the surveillance screens.
 *
 * While the room is on the SANRAL matrix, this serves the imported i-traffic
 * registry. The moment the Hikvision integration is enabled AND its
 * credentials are present, the same endpoint serves the live HikCentral
 * resource list instead — the UI doesn't change, only the `source` field. That
 * is the whole cut-over.
 */
export const dynamic = 'force-dynamic';

export type CctvCamera = {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  source: 'hikvision' | 'sanral';
  /** Hikvision cameras stream via /api/cctv/preview; SANRAL rows may carry a page URL. */
  streamable: boolean;
  url: string | null;
  detail: string | null;
};

export async function GET() {
  const off = await requireFeatureApi('web.cameras');
  if (off) return off;

  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = (user.app_metadata?.role ?? 'Viewer') as UserRole;
  const silo = (user.app_metadata?.silo ?? 'Ethekwini') as Silo;
  if (!canAccess('/cameras', role, silo)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const cfg = await hikConfig(supabase);

  if (cfg.enabled && hikCredentials() && cfg.baseUrl) {
    try {
      // Page through HikCentral, hard-capped so a 10 000-camera estate cannot
      // stall a dispatcher's screen.
      const cameras: CctvCamera[] = [];
      let pageNo = 1;
      let total = Number.POSITIVE_INFINITY;
      while (cameras.length < Math.min(total, 1000) && pageNo <= 10) {
        const page = await hikListCameras(cfg, pageNo);
        total = page.total;
        cameras.push(...page.cameras.map<CctvCamera>((c) => ({
          id: c.indexCode,
          name: c.name,
          latitude: c.latitude,
          longitude: c.longitude,
          source: 'hikvision',
          streamable: true,
          url: null,
          detail: c.regionIndexCode ? `Region ${c.regionIndexCode}` : null,
        })));
        if (page.cameras.length < cfg.pageSize) break;
        pageNo += 1;
      }
      return NextResponse.json({ source: 'hikvision', total, cameras });
    } catch (e) {
      // A HikCentral outage must not blind the room — fall through to the
      // registry and say so.
      const registry = await sanralRegistry(supabase);
      return NextResponse.json({
        ...registry,
        warning: `Hikvision unreachable (${(e as Error).message}) — showing the SANRAL registry.`,
      });
    }
  }

  return NextResponse.json(await sanralRegistry(supabase));
}

async function sanralRegistry(supabase: Awaited<ReturnType<typeof getServerSupabase>>) {
  const rows = await listCameras(supabase).catch(() => []);
  const cameras = rows.map<CctvCamera>((c) => ({
    id: String(c.id),
    name: c.name ?? `Camera ${c.id}`,
    latitude: c.latitude ?? null,
    longitude: c.longitude ?? null,
    source: 'sanral',
    streamable: false,
    url: c.blocked ? null : (c.url ?? null),
    detail: [c.roadway_name, c.direction_of_travel].filter(Boolean).join(' · ') || null,
  }));
  return { source: 'sanral' as const, total: cameras.length, cameras };
}
