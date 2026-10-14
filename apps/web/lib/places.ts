/**
 * Finding a place from what a frightened caller can say: "Gateway", "the
 * Engen near the Pavilion", "taxi rank in Umlazi". No dependencies, so it can
 * be tested; lib/geocode does the lookups.
 *
 * Names people use for well-known eThekwini places are widened to the name
 * on the map, so "Gateway" finds Gateway Theatre of Shopping. Each name here
 * was checked against the map (October 2026); the point always comes from the
 * map itself, never from this list.
 */

const ALIASES: Array<[RegExp, string]> = [
  [/^gateway( mall)?$/i, 'Gateway Theatre of Shopping'],
  [/^(the )?pavilion( mall| shopping centre)?$/i, 'Pavilion Shopping Centre'],
  [/^ushaka( marine( world)?)?$/i, 'uShaka Marine World'],
  [/^moses mabhida( stadium)?$/i, 'Moses Mabhida Stadium'],
  [/^kings park( stadium)?$/i, 'Kings Park Stadium Durban'],
  [/^(king edward|king edward hospital|ked)$/i, 'King Edward VIII Hospital'],
  [/^addington( hospital)?$/i, 'Addington Hospital'],
  [/^(albert luthuli|iale|inkosi albert luthuli)( hospital)?$/i, 'Inkosi Albert Luthuli Central Hospital'],
  [/^(prince mshiyeni|mshiyeni)( hospital)?$/i, 'Prince Mshiyeni Memorial Hospital'],
  [/^(rk khan|r k khan)( hospital)?$/i, 'R K Khan Hospital'],
  [/^workshop( mall)?$/i, 'The Workshop Durban'],
  [/^galleria( mall)?$/i, 'Galleria Amanzimtoti'],
  [/^westwood( mall)?$/i, 'Saxony Westwood'],
  [/^bridge city( mall)?$/i, 'Bridge City Shopping Centre'],
  [/^(the )?(icc|durban icc|international convention centre)$/i, 'Inkosi Albert Luthuli International Convention Centre'],
  [/^warwick( junction)?$/i, 'Warwick Junction'],
  [/^(durban station|berea station)$/i, 'Durban Station'],
  [/^king shaka airport$|^airport$/i, 'King Shaka International Airport'],
];

/** The kind of place a word asks for, as the map tags it. */
const KIND_WORDS: Array<[RegExp, string]> = [
  [/\b(garage|petrol|fuel|filling station|engen|shell|bp|caltex|sasol|total|astron)\b/i, 'amenity:fuel'],
  [/\b(hospital)\b/i, 'amenity:hospital'],
  [/\b(clinic)\b/i, 'amenity:clinic'],
  [/\b(police station|saps)\b/i, 'amenity:police'],
  [/\b(fire station)\b/i, 'amenity:fire_station'],
  [/\b(school|primary|high school)\b/i, 'amenity:school'],
  [/\b(taxi rank|bus station|bus rank|rank)\b/i, 'amenity:bus_station'],
  [/\b(mall|shopping centre|shopping center|plaza)\b/i, 'shop:mall'],
  [/\b(supermarket|spar|shoprite|pick n pay|checkers|boxer|woolworths)\b/i, 'shop:supermarket'],
  [/\b(church|mosque|temple)\b/i, 'amenity:place_of_worship'],
  [/\b(pharmacy|chemist|clicks|dis-chem|dischem)\b/i, 'amenity:pharmacy'],
  [/\b(bank|atm)\b/i, 'amenity:bank'],
  [/\b(stadium)\b/i, 'leisure:stadium'],
  [/\b(beach)\b/i, 'natural:beach'],
];

export type PlaceQuery = {
  /** What to look for, widened where it is a well-known place. */
  what: string;
  /** "near …": the place to look around, if the caller gave one. */
  near: string | null;
  /** The kind of place asked for, as the map tags it, e.g. amenity:fuel. */
  kind: string | null;
  /**
   * Without "near": the place named beside the kind, to look around when the
   * whole search finds nothing ("South Beach taxi rank" → "South Beach").
   */
  around: string | null;
  /** The words that named the kind, as typed: "Spar", "taxi rank". */
  asked: string | null;
};

const NEAR = /^(.+?)\s+(?:near|next to|close to|by|opposite|behind|across from|at the back of)\s+(?:the\s+)?(.+)$/i;

/** Widen a well-known name; anything else stays as typed. */
export function widenName(q: string): string {
  const s = q.trim().replace(/\s+/g, ' ');
  for (const [re, name] of ALIASES) if (re.test(s)) return name;
  return s;
}

/** Read a search: what, near what, and what kind of place. */
export function parsePlaceQuery(raw: string): PlaceQuery {
  const q = raw.trim().replace(/\s+/g, ' ');
  const m = NEAR.exec(q);
  const what = m ? m[1]!.replace(/^the\s+/i, '') : q;
  const near = m ? widenName(m[2]!) : null;
  let kind: string | null = null;
  let words = '';
  for (const [re, tag] of KIND_WORDS) {
    const hit = re.exec(what);
    if (hit) { kind = tag; words = hit[0]; break; }
  }
  const rest = words
    ? what.replace(words, ' ').replace(/\s+/g, ' ').trim().replace(/^(?:(?:the|at|in|by)\s+)+/i, '').replace(/\s+(?:in|at)$/i, '')
    : '';
  return { what: near ? what : widenName(what), near, kind, around: !near && rest ? widenName(rest) : null, asked: words || null };
}

/** A plain word for a kind of place, to search for any of them nearby. */
export function kindSearchWord(tag: string | null): string | null {
  const words: Record<string, string> = {
    'amenity:fuel': 'fuel', 'amenity:hospital': 'hospital', 'amenity:clinic': 'clinic', 'amenity:police': 'police',
    'amenity:fire_station': 'fire station', 'amenity:school': 'school', 'amenity:bus_station': 'taxi rank',
    'shop:mall': 'mall', 'shop:supermarket': 'supermarket', 'amenity:place_of_worship': 'church',
    'amenity:pharmacy': 'pharmacy', 'amenity:bank': 'bank', 'leisure:stadium': 'stadium', 'natural:beach': 'beach',
  };
  return tag ? words[tag] ?? null : null;
}

/** How a place is described to the call taker, from its map tags. */
export function placeKindLabel(key: string | null | undefined, value: string | null | undefined): string | null {
  if (!key || !value) return null;
  const tag = `${key}:${value}`;
  const known: Record<string, string> = {
    'amenity:fuel': 'Fuel station', 'amenity:hospital': 'Hospital', 'amenity:clinic': 'Clinic', 'amenity:doctors': 'Doctor',
    'amenity:police': 'Police station', 'amenity:fire_station': 'Fire station', 'amenity:school': 'School',
    'amenity:college': 'College', 'amenity:university': 'University', 'amenity:bus_station': 'Bus or taxi rank',
    'amenity:taxi': 'Taxi rank', 'amenity:place_of_worship': 'Place of worship', 'amenity:pharmacy': 'Pharmacy',
    'amenity:bank': 'Bank', 'amenity:restaurant': 'Restaurant', 'amenity:fast_food': 'Takeaway', 'amenity:bar': 'Bar',
    'amenity:pub': 'Pub', 'amenity:marketplace': 'Market', 'amenity:community_centre': 'Community hall',
    'amenity:parking': 'Parking', 'shop:mall': 'Shopping centre', 'shop:supermarket': 'Supermarket',
    'shop:convenience': 'Shop', 'shop:car_repair': 'Car repair', 'leisure:stadium': 'Stadium', 'leisure:park': 'Park',
    'natural:beach': 'Beach', 'tourism:hotel': 'Hotel', 'tourism:attraction': 'Attraction',
    'railway:station': 'Station', 'public_transport:station': 'Station', 'aeroway:aerodrome': 'Airport',
    'building:hospital': 'Hospital', 'landuse:retail': 'Shops',
  };
  if (known[tag]) return known[tag];
  if (key === 'shop') return 'Shop';
  if (key === 'amenity' || key === 'tourism' || key === 'leisure') return value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  return null;
}
