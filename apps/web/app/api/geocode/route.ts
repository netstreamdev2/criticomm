import { NextResponse } from 'next/server';

/**
 * Address ⇄ coordinate lookup for the dispatch console, proxied server-side.
 *
 * Nominatim asks for an identifying User-Agent and rate-limits per client, both
 * of which are easier to honour from the server than from every operator's
 * browser. Results are biased to the eThekwini municipal area so a call-taker
 * typing "Chris Hani Rd" gets the Durban one.
 *
 *   GET /api/geocode?q=7+Chris+Hani+Rd        → forward lookup
 *   GET /api/geocode?lat=-29.79&lng=31.03     → reverse lookup
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Rough bounding box around the eThekwini metro (west, north, east, south).
const VIEWBOX = '30.60,-29.50,31.20,-30.20';
const UA = 'CriticomV5/1.0 (eThekwini Emergency Services dispatch console)';

type NominatimPlace = {
  lat: string;
  lon: string;
  display_name: string;
  address?: Record<string, string>;
};

function toResult(p: NominatimPlace) {
  const a = p.address ?? {};
  return {
    label: p.display_name,
    lat: Number(p.lat),
    lng: Number(p.lon),
    suburb: a.suburb ?? a.neighbourhood ?? a.city_district ?? a.village ?? null,
    city: a.city ?? a.town ?? a.municipality ?? 'Durban',
    postalCode: a.postcode ?? null,
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get('q');
  const lat = url.searchParams.get('lat');
  const lng = url.searchParams.get('lng');

  try {
    if (lat && lng) {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1` +
        `&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`,
        { headers: { 'User-Agent': UA, 'Accept-Language': 'en' }, cache: 'no-store' },
      );
      if (!res.ok) throw new Error(`Nominatim ${res.status}`);
      const place = (await res.json()) as NominatimPlace & { error?: string };
      if (place.error || !place.lat) return NextResponse.json({ results: [] });
      return NextResponse.json({ results: [toResult(place)] });
    }

    if (q && q.trim().length >= 3) {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6` +
        `&countrycodes=za&viewbox=${VIEWBOX}&bounded=0&q=${encodeURIComponent(q.trim())}`,
        { headers: { 'User-Agent': UA, 'Accept-Language': 'en' }, cache: 'no-store' },
      );
      if (!res.ok) throw new Error(`Nominatim ${res.status}`);
      const places = (await res.json()) as NominatimPlace[];
      return NextResponse.json({ results: places.map(toResult) });
    }

    return NextResponse.json({ results: [] });
  } catch (e) {
    // A geocoder outage must never block logging a call — the operator can
    // still type coordinates by hand.
    return NextResponse.json(
      { results: [], error: (e as Error).message },
      { status: 200 },
    );
  }
}
