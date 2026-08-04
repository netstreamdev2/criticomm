import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/external';

/**
 * Address ⇄ coordinate lookup for the dispatch console, proxied server-side.
 *
 * Photon (komoot) is the primary provider: key-free, fast, and — unlike
 * Nominatim, whose usage policy blocks many cloud egress ranges — reliable
 * from serverless hosts, which is why autocomplete died on the deployment.
 * Nominatim stays as the fallback. Results are biased to Durban.
 *
 *   GET /api/geocode?q=7+Chris+Hani+Rd        → forward lookup
 *   GET /api/geocode?lat=-29.79&lng=31.03     → reverse lookup
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const DURBAN = { lat: -29.8587, lng: 31.0218 };
const UA = 'CriticomV5/1.0 (eThekwini Emergency Services dispatch console)';

type GeoResult = {
  label: string;
  lat: number;
  lng: number;
  suburb: string | null;
  city: string;
  postalCode: string | null;
};

async function timed(url: string, ms = 6000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en' },
      cache: 'no-store',
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/* ── Photon (primary) ───────────────────────────────────────────────── */

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string; housenumber?: string; street?: string;
    district?: string; locality?: string; city?: string; town?: string;
    postcode?: string; countrycode?: string; state?: string;
  };
};

function fromPhoton(f: PhotonFeature): GeoResult {
  const p = f.properties;
  const line1 = p.housenumber && p.street
    ? `${p.housenumber} ${p.street}`
    : p.name ?? p.street ?? '';
  const suburb = p.district ?? p.locality ?? null;
  const city = p.city ?? p.town ?? 'Durban';
  const label = [line1, suburb, city].filter(Boolean).join(', ');
  return {
    label,
    lat: f.geometry.coordinates[1],
    lng: f.geometry.coordinates[0],
    suburb,
    city,
    postalCode: p.postcode ?? null,
  };
}

async function photonSearch(q: string): Promise<GeoResult[]> {
  const res = await timed(
    `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6` +
    `&lat=${DURBAN.lat}&lon=${DURBAN.lng}&zoom=11&location_bias_scale=0.4`,
  );
  if (!res.ok) throw new Error(`Photon ${res.status}`);
  const data = (await res.json()) as { features?: PhotonFeature[] };
  return (data.features ?? [])
    .filter((f) => f.properties.countrycode === 'ZA')
    .map(fromPhoton);
}

async function photonReverse(lat: string, lng: string): Promise<GeoResult[]> {
  const res = await timed(`https://photon.komoot.io/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&limit=1`);
  if (!res.ok) throw new Error(`Photon ${res.status}`);
  const data = (await res.json()) as { features?: PhotonFeature[] };
  return (data.features ?? []).map(fromPhoton);
}

/* ── Nominatim (fallback) ───────────────────────────────────────────── */

// Rough bounding box around the eThekwini metro (west, north, east, south).
const VIEWBOX = '30.60,-29.50,31.20,-30.20';

type NominatimPlace = {
  lat: string;
  lon: string;
  display_name: string;
  address?: Record<string, string>;
};

function fromNominatim(p: NominatimPlace): GeoResult {
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

async function nominatimSearch(q: string): Promise<GeoResult[]> {
  const res = await timed(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6` +
    `&countrycodes=za&viewbox=${VIEWBOX}&bounded=0&q=${encodeURIComponent(q)}`,
  );
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return ((await res.json()) as NominatimPlace[]).map(fromNominatim);
}

async function nominatimReverse(lat: string, lng: string): Promise<GeoResult[]> {
  const res = await timed(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1` +
    `&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`,
  );
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const place = (await res.json()) as NominatimPlace & { error?: string };
  return place.error || !place.lat ? [] : [fromNominatim(place)];
}

/* ── Handler ────────────────────────────────────────────────────────── */

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
    if (lat && lng) {
      let results = await photonReverse(lat, lng).catch(() => [] as GeoResult[]);
      if (results.length === 0) results = await nominatimReverse(lat, lng).catch(() => []);
      return NextResponse.json({ results });
    }

    if (q && q.trim().length >= 3) {
      let results = await photonSearch(q.trim()).catch(() => [] as GeoResult[]);
      if (results.length === 0) results = await nominatimSearch(q.trim()).catch(() => []);
      return NextResponse.json({ results });
    }

    return NextResponse.json({ results: [] });
  } catch (e) {
    // A geocoder outage must never block logging a call — the operator can
    // still type coordinates by hand.
    return NextResponse.json({ results: [], error: (e as Error).message }, { status: 200 });
  }
}
