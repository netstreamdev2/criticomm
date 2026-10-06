import { NextResponse } from 'next/server';
import { requireFeatureApi } from '@/lib/features';
import { listCameras } from '@criticom/api';
import { canAccess } from '@criticom/db/roles';
import type { Silo, UserRole } from '@criticom/db/types';
import { getServerSupabase } from '@/lib/supabase';

/**
 * The SANRAL freeway camera registry for the SANRAL Cameras wall (imported
 * from i-traffic). The Hikvision platform serves the bodycams, through
 * /api/bodycams/view, not this wall.
 */
export const dynamic = 'force-dynamic';

export type CctvCamera = {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  /** The camera's feed page, when it has one and is not blocked. */
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
  if (!canAccess('/sanral', role, silo)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const rows = await listCameras(supabase).catch(() => []);
  const cameras = rows.map<CctvCamera>((c) => ({
    id: String(c.id),
    name: c.name ?? `Camera ${c.id}`,
    latitude: c.latitude ?? null,
    longitude: c.longitude ?? null,
    url: c.blocked ? null : (c.url ?? null),
    detail: [c.roadway_name, c.direction_of_travel].filter(Boolean).join(' · ') || null,
  }));
  return NextResponse.json({ source: 'sanral' as const, total: cameras.length, cameras });
}
