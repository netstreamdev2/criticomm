/**
 * The eThekwini region a call is in, from where it was pinned.
 *
 * Regions are the metro's: Central, North, South, West (Inner West) and Outer
 * (Outer West). The suburb the address search returns decides first; failing
 * that, the nearest known area to the pin, as long as the pin is inside the
 * metro. A pin outside eThekwini gets no region, and the call-taker picks one.
 */

export type Region = 'Central' | 'North' | 'South' | 'West' | 'Outer';

/** Known areas and roughly where they are. */
const AREAS: Array<[name: string, region: Region, lat: number, lng: number]> = [
  // Central
  ['Durban CBD', 'Central', -29.8587, 31.0218], ['Durban Central', 'Central', -29.8587, 31.0218],
  ['Berea', 'Central', -29.8500, 31.0000], ['Glenwood', 'Central', -29.8700, 30.9950],
  ['Musgrave', 'Central', -29.8440, 31.0040], ['Morningside', 'Central', -29.8300, 31.0150],
  ['Greyville', 'Central', -29.8400, 31.0250], ['Overport', 'Central', -29.8350, 30.9950],
  ['Umbilo', 'Central', -29.8790, 30.9900], ['Point', 'Central', -29.8680, 31.0450],
  ['South Beach', 'Central', -29.8650, 31.0400], ['North Beach', 'Central', -29.8450, 31.0350],
  ['Stamford Hill', 'Central', -29.8250, 31.0300], ['Sydenham', 'Central', -29.8250, 30.9750],
  ['Congella', 'Central', -29.8830, 31.0000], ['Cato Manor', 'Central', -29.8540, 30.9600],
  ['Mayville', 'Central', -29.8350, 30.9650], ['Essenwood', 'Central', -29.8420, 31.0080],
  ['Windermere', 'Central', -29.8300, 31.0200], ['Bulwer', 'Central', -29.8630, 31.0050],
  ['Sherwood', 'Central', -29.8480, 30.9520], ['Springfield', 'Central', -29.8170, 30.9800],
  ['Puntans Hill', 'Central', -29.8400, 30.9850], ['Asherville', 'Central', -29.8250, 30.9700],
  // North
  ['Durban North', 'North', -29.7900, 31.0300], ['Umhlanga', 'North', -29.7270, 31.0830],
  ['La Lucia', 'North', -29.7550, 31.0650], ['Glenashley', 'North', -29.7650, 31.0600],
  ['Phoenix', 'North', -29.7000, 30.9800], ['Verulam', 'North', -29.6430, 31.0480],
  ['Tongaat', 'North', -29.5730, 31.1170], ['Mount Edgecombe', 'North', -29.7050, 31.0400],
  ['Umdloti', 'North', -29.6730, 31.1150], ['Ottawa', 'North', -29.6680, 31.0280],
  ['KwaMashu', 'North', -29.7450, 30.9800], ['Inanda', 'North', -29.6900, 30.9500],
  ['Ntuzuma', 'North', -29.7300, 30.9480], ['Newlands', 'North', -29.7720, 30.9680],
  ['Red Hill', 'North', -29.7750, 31.0150], ['Greenwood Park', 'North', -29.7800, 31.0050],
  ['Avoca', 'North', -29.7600, 31.0050], ['Briardene', 'North', -29.7900, 31.0050],
  ['Glen Anil', 'North', -29.7580, 31.0380], ['Sunningdale', 'North', -29.7480, 31.0480],
  ['Cornubia', 'North', -29.7080, 31.0450], ['La Mercy', 'North', -29.6250, 31.1250],
  ['Westbrook', 'North', -29.6050, 31.1150], ['Waterloo', 'North', -29.6630, 31.0150],
  ['Effingham', 'North', -29.7700, 31.0150], ['Parlock', 'North', -29.7780, 31.0000],
  ['Umgeni Park', 'North', -29.8050, 31.0250], ['Kenville', 'North', -29.7930, 31.0080],
  // South
  ['Bluff', 'South', -29.9350, 31.0200], ['Wentworth', 'South', -29.9250, 31.0050],
  ['Merebank', 'South', -29.9500, 30.9700], ['Chatsworth', 'South', -29.9100, 30.8900],
  ['Umlazi', 'South', -29.9700, 30.8900], ['Isipingo', 'South', -29.9900, 30.9300],
  ['Amanzimtoti', 'South', -30.0500, 30.8800], ['Kingsburgh', 'South', -30.0750, 30.8600],
  ['Umbogintwini', 'South', -30.0250, 30.9050], ['Montclair', 'South', -29.9100, 30.9700],
  ['Woodlands', 'South', -29.9150, 30.9500], ['Yellowwood Park', 'South', -29.9200, 30.9300],
  ['Clairwood', 'South', -29.9100, 30.9800], ['Jacobs', 'South', -29.9150, 30.9900],
  ['Mobeni', 'South', -29.9300, 30.9600], ['Lamontville', 'South', -29.9500, 30.9400],
  ['Umkomaas', 'South', -30.2000, 30.8000], ['Illovo', 'South', -30.1150, 30.8350],
  ['Folweni', 'South', -30.0000, 30.8300], ['Austerville', 'South', -29.9300, 31.0000],
  ['Brighton Beach', 'South', -29.9300, 31.0250], ['Shallcross', 'South', -29.8900, 30.8600],
  ['Bayview', 'South', -29.9200, 30.8800], ['Prospecton', 'South', -29.9700, 30.9350],
  ['Warner Beach', 'South', -30.0850, 30.8550], ['Doonside', 'South', -30.0650, 30.8700],
  // West (Inner West)
  ['Pinetown', 'West', -29.8150, 30.8550], ['Westville', 'West', -29.8350, 30.9300],
  ['Queensburgh', 'West', -29.8700, 30.9300], ['Malvern', 'West', -29.8800, 30.9200],
  ['Escombe', 'West', -29.8750, 30.9350], ['Northdene', 'West', -29.8600, 30.9150],
  ['Moseley', 'West', -29.8500, 30.9050], ['New Germany', 'West', -29.8000, 30.8800],
  ['Clermont', 'West', -29.8200, 30.8700], ['KwaDabeka', 'West', -29.7900, 30.8750],
  ['Mariannhill', 'West', -29.8450, 30.8250], ['Cowies Hill', 'West', -29.8250, 30.8800],
  ['Sarnia', 'West', -29.8350, 30.8900], ['Bellair', 'West', -29.8750, 30.9500],
  ['Hillary', 'West', -29.8650, 30.9450], ['Paradise Valley', 'West', -29.8300, 30.8950],
  ['St Wendolins', 'West', -29.8450, 30.8450], ['Westmead', 'West', -29.8250, 30.8550],
  ['Chesterville', 'West', -29.8450, 30.9400], ['Klaarwater', 'West', -29.8600, 30.8300],
  // Outer (Outer West)
  ['Kloof', 'Outer', -29.7900, 30.8300], ['Gillitts', 'Outer', -29.7900, 30.8000],
  ['Hillcrest', 'Outer', -29.7800, 30.7650], ['Waterfall', 'Outer', -29.7500, 30.8100],
  ["Botha's Hill", 'Outer', -29.7550, 30.7300], ['Bothas Hill', 'Outer', -29.7550, 30.7300],
  ['Assagay', 'Outer', -29.7650, 30.7400], ['Drummond', 'Outer', -29.7500, 30.7000],
  ['Hammarsdale', 'Outer', -29.7950, 30.6500], ['Mpumalanga', 'Outer', -29.8100, 30.6300],
  ['Cato Ridge', 'Outer', -29.7350, 30.5800], ['Shongweni', 'Outer', -29.8350, 30.7200],
  ['Winston Park', 'Outer', -29.7900, 30.7800], ['Forest Hills', 'Outer', -29.7700, 30.8200],
  ['Everton', 'Outer', -29.8000, 30.8100], ['Inchanga', 'Outer', -29.7400, 30.6750],
  ['Monteseel', 'Outer', -29.7300, 30.7100],
];

const normal = (s: string) => s.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^a-z]/g, '');

/** Kilometres between two points (haversine). */
function km(aLat: number, aLng: number, bLat: number, bLng: number) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(bLat - aLat) / 2) ** 2
    + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** No known area this close means the pin is outside the metro. */
const OUTSIDE_KM = 12;

/**
 * The region for a pinned location. `suburb` is what the address search
 * returned for it, when it returned one.
 */
export function regionFor(lat: number | null, lng: number | null, suburb?: string | null): Region | null {
  if (suburb) {
    const s = normal(suburb);
    const named = s ? AREAS.find(([name]) => {
      const n = normal(name);
      return s === n || s.startsWith(n) || (n.length >= 5 && s.includes(n));
    }) : undefined;
    if (named) return named[1];
  }
  if (lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  let best: { region: Region; d: number } | null = null;
  for (const [, region, aLat, aLng] of AREAS) {
    const d = km(lat, lng, aLat, aLng);
    if (!best || d < best.d) best = { region, d };
  }
  return best && best.d <= OUTSIDE_KM ? best.region : null;
}
