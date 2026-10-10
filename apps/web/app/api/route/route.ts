import { NextResponse } from 'next/server';

/**
 * Road-routed travel time between two points, via the public OSRM server —
 * key-free, and proxied here so the browser never leaves the origin.
 *
 *   GET /api/route?fromLat=&fromLng=&toLat=&toLng=[&geometry=1]
 *   → { routed: true, minutes, km }         when OSRM answers
 *     (+ path: [[lat, lng], …], the road line, with geometry=1)
 *   → { routed: false }                      when it doesn't (caller falls
 *                                            back to the straight-line model)
 *
 * The intake console uses this for its per-department ETA; a routing outage
 * degrades to the tunable straight-line estimate, never to an error.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const nums = ['fromLat', 'fromLng', 'toLat', 'toLng'].map((k) => Number(url.searchParams.get(k)));
  if (nums.some((n) => !Number.isFinite(n))) {
    return NextResponse.json({ routed: false, error: 'fromLat, fromLng, toLat, toLng are required' });
  }
  const [fromLat, fromLng, toLat, toLng] = nums as [number, number, number, number];
  const withPath = url.searchParams.get('geometry') === '1';

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?${withPath ? 'overview=full&geometries=geojson' : 'overview=false'}`,
      { signal: ctrl.signal, cache: 'no-store' },
    );
    if (!res.ok) throw new Error(`OSRM ${res.status}`);
    const data = (await res.json()) as {
      code: string;
      routes?: Array<{ duration: number; distance: number; geometry?: { coordinates: Array<[number, number]> } }>;
    };
    const route = data.code === 'Ok' ? data.routes?.[0] : undefined;
    if (!route) throw new Error(data.code || 'no route');

    return NextResponse.json({
      routed: true,
      minutes: Math.max(1, Math.round(route.duration / 60)),
      km: Math.round(route.distance / 100) / 10,
      // GeoJSON is longitude-first; maps take latitude first.
      ...(withPath && route.geometry ? { path: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]) } : {}),
    });
  } catch {
    return NextResponse.json({ routed: false });
  } finally {
    clearTimeout(timer);
  }
}
