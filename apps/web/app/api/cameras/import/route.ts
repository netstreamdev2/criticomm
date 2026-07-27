import { NextResponse } from 'next/server';
import { ADMIN_ROLES, DISPATCH_ROLES, type UserRole } from '@criticom/db';
import { requireAuth, unconfigured } from '@/lib/external';
import { getServiceSupabase } from '@/lib/supabase';

/**
 * CamerasController.FetchExternalCamerasAsync — import the i-traffic CCTV feed.
 * XML shape: <ArrayOfCamera><Camera><ID/><Latitude/><Longitude/><Name/>
 *   <DirectionOfTravel/><RoadwayName/><Url/><Disabled/><Blocked/></Camera>…
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1]!.trim() : null;
}

export async function POST() {
  const { user, deny } = await requireAuth();
  if (deny) return deny;
  const role = (user!.app_metadata?.role ?? 'Viewer') as UserRole;
  if (!ADMIN_ROLES.includes(role) && !DISPATCH_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const key = process.env.ITRAFFIC_API_KEY;
  if (!key) return unconfigured('i-traffic cameras', 'ITRAFFIC_API_KEY');

  const res = await fetch(`https://www.i-traffic.co.za/api/GetCameras?key=${key}&format=xml`, {
    cache: 'no-store',
  });
  if (!res.ok) {
    return NextResponse.json({ error: `i-traffic ${res.status} ${res.statusText}` }, { status: 502 });
  }
  const xml = await res.text();

  const cameras: Array<{
    id: string; latitude: number | null; longitude: number | null; name: string | null;
    direction_of_travel: string | null; roadway_name: string | null; url: string | null;
    disabled: boolean; blocked: boolean;
  }> = [];

  for (const m of xml.matchAll(/<Camera>([\s\S]*?)<\/Camera>/g)) {
    const c = m[1]!;
    const id = tag(c, 'ID');
    if (!id) continue;
    const lat = Number(tag(c, 'Latitude'));
    const lng = Number(tag(c, 'Longitude'));
    cameras.push({
      id,
      latitude: Number.isFinite(lat) ? lat : null,
      longitude: Number.isFinite(lng) ? lng : null,
      name: tag(c, 'Name'),
      direction_of_travel: tag(c, 'DirectionOfTravel'),
      roadway_name: tag(c, 'RoadwayName'),
      url: tag(c, 'Url'),
      disabled: tag(c, 'Disabled')?.toLowerCase() === 'true',
      blocked: tag(c, 'Blocked')?.toLowerCase() === 'true',
    });
  }

  if (cameras.length === 0) {
    return NextResponse.json({ imported: 0, message: 'Feed returned no cameras.' });
  }

  // Upsert via service role — camera imports are a system operation, not a user row.
  const service = getServiceSupabase();
  const { error } = await service
    .from('cameras')
    .upsert(cameras.map((c) => ({ ...c, imported_at: new Date().toISOString() })), { onConflict: 'id' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ imported: cameras.length });
}
