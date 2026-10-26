import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/external';
import { MUNICIPALITIES } from '@criticom/db/disaster-plan';
import { areaAt, reverseLookup, searchPlaces } from '@/lib/geocode';

/**
 * Address ⇄ coordinate lookup for the dispatch console, proxied server-side
 * (lib/geocode: Photon first, Nominatim as the fallback, biased to Durban).
 *
 *   GET /api/geocode?q=7+Chris+Hani+Rd        → forward lookup
 *   GET /api/geocode?lat=-29.79&lng=31.03     → reverse lookup
 *   GET /api/geocode?lat=…&lng=…&area=1       → the ward and municipality the point is in
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request) {
  // This route needs no API key, which is why it was left open — but an
  // unauthenticated proxy in front of Photon and Nominatim is still an open
  // relay, and OpenStreetMap's usage policy is enforced by banning the source
  // IP. That would take address lookup off the call-taking screen, mid-shift,
  // with no warning. Session-gated and rate-limited for that reason alone.
  const { deny } = await requireAuth('geocode');
  if (deny) return deny;

  const url = new URL(req.url);
  const q = url.searchParams.get('q');
  const lat = url.searchParams.get('lat');
  const lng = url.searchParams.get('lng');

  try {
    if (lat && lng && url.searchParams.get('area')) return NextResponse.json({ area: await areaAt(Number(lat), Number(lng), MUNICIPALITIES) });
    if (lat && lng) return NextResponse.json({ results: await reverseLookup(lat, lng) });
    if (q && q.trim().length >= 3) return NextResponse.json({ results: await searchPlaces(q) });
    return NextResponse.json({ results: [] });
  } catch (e) {
    // A geocoder outage must never block logging a call — the operator can
    // still type coordinates by hand.
    return NextResponse.json({ results: [], error: (e as Error).message }, { status: 200 });
  }
}
