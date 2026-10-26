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
  /** The municipal ward, when the map names it ("eThekwini Ward 35" gives "35"). */
  ward?: string | null;
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

/** The suburb, not the ward: the maps give "eThekwini Ward 35" beside "Somerset Park". */
const suburbOf = (...names: Array<string | undefined>) => names.find((n) => n && !/\bward\s+\d+/i.test(n)) ?? null;
/** The ward number the maps give beside the suburb. */
const wardOf = (...names: Array<string | undefined>) => {
  for (const n of names) {
    const m = n ? /\bward\s+(\d{1,3})\b/i.exec(n) : null;
    if (m) return m[1] ?? null;
  }
  return null;
};

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
  const suburb = suburbOf(p.locality, p.district);
  const city = p.city ?? p.town ?? 'Durban';
  return {
    label: shortLabel(isPlace ? p.name! : street ?? p.name ?? null, isPlace ? street : null, suburb, city),
    lat: f.geometry.coordinates[1],
    lng: f.geometry.coordinates[0],
    suburb,
    ward: wardOf(p.locality, p.district, p.name),
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
  const suburb = suburbOf(a.suburb, a.neighbourhood, a.city_district, a.village);
  const town = a.town ?? a.city ?? a.village ?? null;
  const label = shortLabel(isPlace ? p.name! : street ?? p.name ?? null, isPlace ? street : null, suburb, town);
  return {
    label: label || p.display_name,
    lat: Number(p.lat),
    lng: Number(p.lon),
    suburb,
    ward: wardOf(a.suburb, a.neighbourhood, a.city_district, a.quarter, a.municipality),
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
/** In eThekwini or just over its edge: not a namesake in Pietermaritzburg or Johannesburg. */
const inMetro = (r: GeoResult) => r.lat < -29.35 && r.lat > -30.35 && r.lng > 30.45 && r.lng < 31.35;

/** About 4 km each way around the place named. */
const NEAR_BOX = 0.04;

/** What is asked for, around a place: "Engen" around "Pavilion Shopping Centre". */
async function searchAround(what: string, place: string, kind: string | null): Promise<GeoResult[]> {
  const anchor = (await lookup(place)).filter(inMetro)[0];
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
  if (results.length === 0 && photonUp()) results = merge(await nominatimSearch(text).catch(() => [] as GeoResult[]));
  const local = results.filter(inMetro);
  return local.length ? local : results;
}

/** The address at a point. Never throws. */
export async function reverseLookup(lat: string, lng: string): Promise<GeoResult[]> {
  let results: GeoResult[] = [];
  if (photonUp()) results = await photonReverse(lat, lng).catch(() => { photonFailed(); return [] as GeoResult[]; });
  if (results.length === 0) results = await nominatimReverse(lat, lng).catch(() => []);
  return results;
}

/* ── The ward and municipality at a point ───────────────────────────── */

export type AreaAt = {
  /** The ward the point falls inside ("76"), from the ward boundaries on the map. */
  ward: string | null;
  /** The municipality, as the Plan lists them ("eThekwini Metro", "Ugu"); null outside KwaZulu-Natal's list. */
  municipality: string | null;
};

const areaCache = new Map<string, { at: number; area: AreaAt }>();
const AREA_CACHE_MS = 24 * 60 * 60_000;

/** "eThekwini Metropolitan Municipality" → "eThekwini Metro"; "Ugu District Municipality" → "Ugu". */
function municipalityOf(names: Array<string | undefined>, list: readonly string[]): string | null {
  for (const n of names) {
    if (!n) continue;
    const name = n.toLowerCase();
    const found = list.find((m) => name.startsWith(m.toLowerCase().replace(/ metro$/, '')));
    if (found) return found;
  }
  return null;
}

/**
 * The ward a point falls inside, not the ward a nearby place is named after:
 * asked at the zoom of ward boundaries, the map answers with the boundary
 * that holds the point ("eThekwini Ward 76"). Kept a day: wards move only at
 * elections. Never throws; null when the map cannot be asked.
 */
export async function areaAt(lat: number, lng: number, municipalities: readonly string[]): Promise<AreaAt | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const hit = areaCache.get(key);
  if (hit && Date.now() - hit.at < AREA_CACHE_MS) return hit.area;
  try {
    const res = await timed(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=14&lat=${lat}&lon=${lng}`,
    );
    if (!res.ok) return null;
    const p = (await res.json()) as NominatimPlace & { error?: string };
    if (p.error) return null;
    const a = p.address ?? {};
    const area = {
      ward: wardOf(p.name, a.suburb, a.city_district, a.quarter, a.neighbourhood, a.municipality),
      municipality: municipalityOf([a.county, a.municipality, a.city, a.state_district], municipalities),
    };
    if (areaCache.size > 2000) areaCache.clear();
    areaCache.set(key, { at: Date.now(), area });
    return area;
  } catch {
    return null;
  }
}
