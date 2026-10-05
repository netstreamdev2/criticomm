import { NextResponse } from 'next/server';
import { requireAuth, unconfigured } from '@/lib/external';

/**
 * CamerasController.GetEmergencyPOIs — TomTom search for V4's category set:
 * 7321 hospitals, 7322 police stations, 7392 fire stations.
 *
 * One request per category. Asked together, the hundreds of GP rooms TomTom
 * files under "hospital/polyclinic" in Durban fill the 100-result page and
 * crowd out every police and fire station. For the same reason hospitals are
 * a text search for "hospital" inside 7321 (35 real hospitals across the
 * metro, against 8 among the first 100 of a plain nearby search — and that
 * search cannot page). The live map then keeps the entries whose names read
 * as real facilities (parseFacilities).
 */
export const dynamic = 'force-dynamic';

const SEARCHES = [
  { path: 'poiSearch/hospital.json', category: '7321' },
  { path: 'nearbySearch/.json', category: '7322' },
  { path: 'nearbySearch/.json', category: '7392' },
] as const;

export async function GET(req: Request) {
  const { deny } = await requireAuth('external');
  if (deny) return deny;

  const key = process.env.TOMTOM_API_KEY;
  if (!key) return unconfigured('TomTom POI', 'TOMTOM_API_KEY');

  const sp = new URL(req.url).searchParams;
  const lat = sp.get('lat') ?? '-29.8587';
  const lon = sp.get('lon') ?? '31.0218';
  // The metro reaches ~30 km from the CBD (Umhlanga to Amanzimtoti, out to Hammarsdale).
  const radius = sp.get('radius') ?? '30000';

  try {
    const pages = await Promise.all(SEARCHES.map(async ({ path, category }) => {
      const res = await fetch(
        `https://api.tomtom.com/search/2/${path}?key=${key}`
          + `&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&radius=${encodeURIComponent(radius)}`
          + `&categorySet=${category}&limit=100`,
        { cache: 'no-store' },
      );
      if (!res.ok) throw new Error(`Upstream ${res.status} ${res.statusText}`);
      return (await res.json()) as { results?: unknown[] };
    }));
    return NextResponse.json({ results: pages.flatMap((p) => p.results ?? []) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
