import 'server-only';
import { kindSearchWord, parsePlaceQuery, placeKindLabel } from './places';

/**
 * Address ⇄ coordinate lookup, server-side, biased to Durban.
 *
 * Photon (komoot) is the primary provider: key-free, fast, and — unlike
 * Nominatim, whose usage policy blocks many cloud egress ranges — reliable
 * from serverless hosts. Nominatim stays as the fallback. Used by
 * /api/geocode (the intake form) and by Criti when it logs a call.
 *
 * When Photon times out or fails, it is left alone for a minute and every
 * lookup goes straight to Nominatim, so a slow Photon never makes each search
 * wait out its timeout first. Answers are kept for ten minutes.
 */

const DURBAN = { lat: -29.8587, lng: 31.0218 };
const UA = 'CriticomV5/1.0 (eThekwini Emergency Services dispatch console)';

export type GeoResult = {
  label: string;
  lat: number;
  lng: number;
  suburb: string | null;
  city: string;
  postalCode: string | null;
  /** A named place (a mall, a fuel station, a hospital), when it is one. */
  place?: string | null;
  /** What kind of place: "Shopping centre", "Fuel station". */
  kind?: string | null;
  /** The place it was found near, for "the Engen near the Pavilion". */
  near?: string | null;
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

/** Map tags that name a road, an area or a boundary rather than a place someone can stand at. */
const NOT_A_PLACE = new Set(['highway', 'place', 'boundary', 'landuse', 'waterway']);

/** "Gateway Theatre of Shopping, Sugar Road, Somerset Park, Umhlanga": short, place first. */
function shortLabel(name: string | null, street: string | null, suburb: string | null, town: string | null) {
  const parts: string[] = [];
  for (const p of [name, street, suburb, town]) if (p && !parts.includes(p)) parts.push(p);
  return parts.join(', ');
}

/* ── Photon (primary) ───────────────────────────────────────────────── */

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string; housenumber?: string; street?: string;
    district?: string; locality?: string; city?: string; town?: string;
    postcode?: string; countrycode?: string; state?: string;
    osm_key?: string; osm_value?: string;
  };
};

function fromPhoton(f: PhotonFeature): GeoResult {
  const p = f.properties;
  const isPlace = Boolean(p.name) && Boolean(p.osm_key) && !NOT_A_PLACE.has(p.osm_key!);
  const street = p.housenumber && p.street ? `${p.housenumber} ${p.street}` : p.street ?? null;
  const suburb = p.district ?? p.locality ?? null;
  const city = p.city ?? p.town ?? 'Durban';
  return {
    label: shortLabel(isPlace ? p.name! : street ?? p.name ?? null, isPlace ? street : null, suburb, city),
    lat: f.geometry.coordinates[1],
    lng: f.geometry.coordinates[0],
    suburb,
    city,
    postalCode: p.postcode ?? null,
    place: isPlace ? p.name! : null,
    kind: isPlace ? placeKindLabel(p.osm_key, p.osm_value) : null,
  };
}

type Around = {
  /** Look around here first (default: central Durban). */
  lat?: number;
  lng?: number;
  /** Keep to a box around the point, in degrees each way. */
  box?: number;
  /** Only this kind of place, e.g. amenity:fuel (Photon only). */
  osmTag?: string | null;
};

async function photonSearch(q: string, o: Around = {}): Promise<GeoResult[]> {
  const lat = o.lat ?? DURBAN.lat;
  const lng = o.lng ?? DURBAN.lng;
  const box = o.box ? `&bbox=${lng - o.box},${lat - o.box},${lng + o.box},${lat + o.box}` : '';
  const tag = o.osmTag ? `&osm_tag=${encodeURIComponent(o.osmTag)}` : '';
  const res = await timed(
    `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6` +
    `&lat=${lat}&lon=${lng}&zoom=${o.box ? 15 : 11}&location_bias_scale=${o.box ? 0.2 : 0.4}${box}${tag}`,
    3500,
  );
  if (!res.ok) throw new Error(`Photon ${res.status}`);
  const data = (await res.json()) as { features?: PhotonFeature[] };
  return (data.features ?? [])
    .filter((f) => f.properties.countrycode === 'ZA')
    .map(fromPhoton);
}

async function photonReverse(lat: string, lng: string): Promise<GeoResult[]> {
  const res = await timed(`https://photon.komoot.io/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&limit=1`, 3500);
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
  name?: string;
  category?: string;
  type?: string;
  address?: Record<string, string>;
};

function fromNominatim(p: NominatimPlace): GeoResult {
  const a = p.address ?? {};
  const isPlace = Boolean(p.name) && Boolean(p.category) && !NOT_A_PLACE.has(p.category!);
  const street = a.road ? (a.house_number ? `${a.house_number} ${a.road}` : a.road) : null;
  const suburb = a.suburb ?? a.neighbourhood ?? a.city_district ?? a.village ?? null;
  const town = a.town ?? a.city ?? a.village ?? null;
  const label = shortLabel(isPlace ? p.name! : street ?? p.name ?? null, isPlace ? street : null, suburb, town);
  return {
    label: label || p.display_name,
    lat: Number(p.lat),
    lng: Number(p.lon),
    suburb,
    city: a.city ?? a.town ?? a.municipality ?? 'Durban',
    postalCode: a.postcode ?? null,
    place: isPlace ? p.name! : null,
    kind: isPlace ? placeKindLabel(p.category, p.type) : null,
  };
}

async function nominatimSearch(q: string, o: Around = {}): Promise<GeoResult[]> {
  // Nominatim's box is west, north, east, south; bounded keeps to it.
  const view = o.box && o.lat !== undefined && o.lng !== undefined
    ? `&viewbox=${o.lng - o.box},${o.lat + o.box},${o.lng + o.box},${o.lat - o.box}&bounded=1`
    : `&viewbox=${VIEWBOX}&bounded=0`;
  const res = await timed(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6` +
    `&countrycodes=za${view}&q=${encodeURIComponent(q)}`,
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

/* ── Choosing the provider ──────────────────────────────────────────── */

const PHOTON_REST_MS = 60_000;
let photonRestsUntil = 0;
const photonUp = () => Date.now() >= photonRestsUntil;
const photonFailed = () => { photonRestsUntil = Date.now() + PHOTON_REST_MS; };

const CACHE_MS = 10 * 60_000;
const cache = new Map<string, { at: number; results: GeoResult[] }>();

/**
 * One search: Photon, or Nominatim while Photon rests. An empty answer is an
 * answer; only a failure tries the other. Never throws.
 */
async function lookup(q: string, o: Around = {}): Promise<GeoResult[]> {
  const key = JSON.stringify([q.toLowerCase(), o]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.results;
  let results: GeoResult[] | null = null;
  if (photonUp()) {
    results = await photonSearch(q, o).catch(() => { photonFailed(); return null; });
  }
  if (results === null) results = await nominatimSearch(q, o).catch(() => null);
  if (results === null) return [];
  if (cache.size > 300) cache.clear();
  cache.set(key, { at: Date.now(), results });
  return results;
}

/* ── Lookups ────────────────────────────────────────────────────────── */

/** Places matching an address, best first. Never throws: an outage is no results. */
export async function searchAddress(q: string): Promise<GeoResult[]> {
  const text = q.trim();
  if (text.length < 3) return [];
  let results = await lookup(text);
  if (results.length === 0 && photonUp()) results = await nominatimSearch(text).catch(() => []);
  return results;
}

/** Each place once: by its point, and by its name (one road in several pieces is one road). */
const merge = (...lists: GeoResult[][]) => {
  const seen = new Set<string>();
  const out: GeoResult[] = [];
  for (const r of lists.flat()) {
    const point = `${r.lat.toFixed(5)},${r.lng.toFixed(5)}`;
    const name = r.label.toLowerCase();
    if (seen.has(point) || seen.has(name)) continue;
    seen.add(point);
    seen.add(name);
    out.push(r);
  }
  return out.slice(0, 8);
};
/** About 150 km: the metro and its edges, not a namesake street in Johannesburg. */
const nearDurban = (r: GeoResult) => Math.abs(r.lat - DURBAN.lat) < 1.4 && Math.abs(r.lng - DURBAN.lng) < 1.4;

/** About 4 km each way around the place named. */
const NEAR_BOX = 0.04;

/** What is asked for, around a place: "Engen" around "Pavilion Shopping Centre". */
async function searchAround(what: string, place: string, kind: string | null): Promise<GeoResult[]> {
  const anchor = (await lookup(place)).filter(nearDurban)[0];
  if (!anchor) return [];
  const at = { lat: anchor.lat, lng: anchor.lng, box: NEAR_BOX };
  // Taxi ranks are mapped as bus stations, taxi stands or neither: no tag filter for them.
  const tag = kind && kind !== 'amenity:bus_station' ? kind : null;
  // A kind of place was asked for: a street is not an answer.
  const fit = (list: GeoResult[]) => (kind ? list.filter((r) => r.place) : list);
  let found = fit(await lookup(what, { ...at, osmTag: tag }));
  // "the garage": any fuel station there, whatever its name.
  const word = kindSearchWord(kind);
  if (found.length === 0 && word && word !== what.toLowerCase()) found = fit(await lookup(word, { ...at, osmTag: tag }));
  // Without the filter (Photon only: Nominatim never had it, so it would ask the same again).
  if (found.length === 0 && tag && photonUp()) found = fit(await lookup(what, at));
  if (found.length === 0) return [];
  // The ones called what was asked for first: "Spar" before any other supermarket.
  const asked = what.toLowerCase();
  found = [...found].sort((a, b) => Number(!(b.place ?? '').toLowerCase().includes(asked)) - Number(!(a.place ?? '').toLowerCase().includes(asked)) || 0);
  const nearName = anchor.place ?? anchor.label.split(',')[0]!;
  return merge(found.map((r) => ({ ...r, near: nearName })), [anchor]);
}

/**
 * Addresses and named places, for what a caller can say (lib/places):
 * "Gateway" (widened to the name on the map), "Engen near the Pavilion" (fuel
 * stations within about 4 km of it), "South Beach taxi rank", or a street.
 * Never throws.
 */
export async function searchPlaces(q: string): Promise<GeoResult[]> {
  const text = q.trim();
  if (text.length < 3) return [];
  const query = parsePlaceQuery(text);
  if (query.near) {
    const found = await searchAround(query.what, query.near, query.kind);
    if (found.length) return found;
  }
  const [widened, plain] = await Promise.all([
    query.what !== text && !query.near ? lookup(query.what) : Promise.resolve([] as GeoResult[]),
    lookup(text),
  ]);
  let results = merge(widened, plain);
  if (results.length === 0 && query.around && query.kind) {
    results = await searchAround(query.asked ?? kindSearchWord(query.kind) ?? query.what, query.around, query.kind);
  }
  if (results.length === 0 && photonUp()) results = await nominatimSearch(text).catch(() => []);
  const local = results.filter(nearDurban);
  return local.length ? local : results;
}

/** The address at a point. Never throws. */
export async function reverseLookup(lat: string, lng: string): Promise<GeoResult[]> {
  let results: GeoResult[] = [];
  if (photonUp()) results = await photonReverse(lat, lng).catch(() => { photonFailed(); return [] as GeoResult[]; });
  if (results.length === 0) results = await nominatimReverse(lat, lng).catch(() => []);
  return results;
}
