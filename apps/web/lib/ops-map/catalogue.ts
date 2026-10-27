/**
 * The map's outside overlays (Disaster revision 2): warnings, hazards now,
 * risk, wards and people, past events, the April 2022 floods. Each is data:
 * what it shows, where it comes from, how it is drawn and its legend. The
 * server fetches and colours them (lib/maps/sources.ts, /api/maps/*), so the
 * page needs no outside address and no key ever reaches the browser.
 *
 * Pure: shared by the map, the layer panel and the tests (catalogue.test.ts).
 */

export const CATALOGUE_GROUPS = ['Warnings', 'Hazards now', 'Risk', 'Wards and people', 'Past events', 'April 2022 floods'] as const;
export type CatalogueGroup = (typeof CATALOGUE_GROUPS)[number];

export type LegendItem = { colour: string; label: string; shape?: 'dot' | 'area' | 'line' };

export type CatalogueOverlay = {
  id: string;
  label: string;
  group: CatalogueGroup;
  /** One line under the switch. */
  hint: string;
  /** The (i): what it shows and how to read it, in a few plain sentences. */
  about: string;
  /** Who publishes it, and where to see it on their own site. */
  source: string;
  sourceUrl: string;
  /** Map pictures (tiles) or things drawn from data (features). */
  kind: 'tiles' | 'features';
  /** How often the server fetches it again, in minutes (data that changes); undefined: once a day. */
  refreshMinutes?: number;
  /** Tiles: the highest zoom the source draws (Leaflet enlarges beyond it), and how see-through to start. */
  maxNativeZoom?: number;
  opacity?: number;
  /** Words people search with, beyond the label. */
  keywords: string;
  legend: LegendItem[];
  /** Needs a key on the server; without it the switch says so. */
  needsKey?: string;
};

const RISK_LEGEND: LegendItem[] = [
  { colour: '#1a9850', label: 'Very low', shape: 'area' }, { colour: '#91cf60', label: 'Low', shape: 'area' },
  { colour: '#fee08b', label: 'Medium', shape: 'area' }, { colour: '#fc8d59', label: 'High', shape: 'area' },
  { colour: '#d73027', label: 'Very high', shape: 'area' },
];
const SHARE_LEGEND = (bins: string[]): LegendItem[] =>
  ['#fff5eb', '#fdd0a2', '#fd8d3c', '#d94801', '#7f2704'].map((colour, i) => ({ colour, label: bins[i]!, shape: 'area' as const }));

export const NDMC = 'National Disaster Management Centre';
const NDMC_URL = 'https://ndmc.maps.arcgis.com';

export const CATALOGUE = [
  /* ── Warnings ─────────────────────────────────────────────────────── */
  {
    id: 'saws-areas', label: 'Weather warning areas', group: 'Warnings', kind: 'features', refreshMinutes: 5,
    hint: 'The parts of eThekwini under a SA Weather Service warning now, in its colour.',
    about: 'Each SA Weather Service impact-based warning in force for eThekwini, drawn where SAWS drew it, in the warning’s colour. Click an area for the hazard, the level and until when it is valid.',
    source: 'SA Weather Service', sourceUrl: 'https://www.weathersa.co.za/warnings', keywords: 'saws warning level yellow orange red storm rain wind waves',
    legend: [{ colour: '#facc15', label: 'Yellow (1 to 4)', shape: 'area' }, { colour: '#f97316', label: 'Orange (5 to 8)', shape: 'area' },
      { colour: '#dc2626', label: 'Red (9 and 10)', shape: 'area' }],
  },
  /* ── Hazards now ──────────────────────────────────────────────────── */
  {
    id: 'flood-modis-2d', label: 'Flooding seen from space (MODIS, 2 days)', group: 'Hazards now', kind: 'tiles', refreshMinutes: 180,
    maxNativeZoom: 9, opacity: 0.75, hint: 'Water where there is usually none, from NASA satellites over the last two days.',
    about: 'NASA’s near real-time flood map from the MODIS satellites: red is flood water, yellow a place that floods often, blue normal surface water. Clouds hide the ground, so a gap is not proof of no flooding. About 250 m detail.',
    source: 'NASA LANCE', sourceUrl: 'https://lance.modaps.eosdis.nasa.gov/flood/viewer/', keywords: 'flood satellite water nasa lance modis inundation',
    legend: [{ colour: '#e11d48', label: 'Flood water', shape: 'area' }, { colour: '#facc15', label: 'Floods often', shape: 'area' },
      { colour: '#2563eb', label: 'Normal water', shape: 'area' }],
  },
  {
    id: 'flood-viirs-2d', label: 'Flooding seen from space (VIIRS, 2 days)', group: 'Hazards now', kind: 'tiles', refreshMinutes: 180,
    maxNativeZoom: 9, opacity: 0.75, hint: 'The same from NASA’s newer VIIRS satellites: finer, about 375 m.',
    about: 'NASA’s flood map from the VIIRS satellites over the last two days, in the same colours as the MODIS one. Use both: each sees through gaps in the other’s clouds.',
    source: 'NASA LANCE', sourceUrl: 'https://lance.modaps.eosdis.nasa.gov/flood/viewer/', keywords: 'flood satellite water nasa lance viirs inundation',
    legend: [{ colour: '#e11d48', label: 'Flood water', shape: 'area' }, { colour: '#facc15', label: 'Floods often', shape: 'area' },
      { colour: '#2563eb', label: 'Normal water', shape: 'area' }],
  },
  {
    id: 'fires-now', label: 'Fires burning now', group: 'Hazards now', kind: 'tiles', refreshMinutes: 60,
    maxNativeZoom: 12, opacity: 1, hint: 'Hot spots seen by NASA satellites in the last 24 hours.',
    about: 'Fires and other hot spots seen by NASA’s VIIRS satellites in the last day. A dot can also be a hot factory roof or a flare. Satellites pass over a few times a day, so a fire that started an hour ago may not show yet.',
    source: 'NASA FIRMS', sourceUrl: 'https://firms.modaps.eosdis.nasa.gov/map/', keywords: 'fire wildfire veld hotspot thermal firms burning',
    legend: [{ colour: '#ef4444', label: 'Hot spot', shape: 'dot' }],
  },
  {
    id: 'clouds-satellite', label: 'Clouds from satellite', group: 'Hazards now', kind: 'tiles', refreshMinutes: 15,
    maxNativeZoom: 8, opacity: 0.6, hint: 'The latest infrared picture from Meteosat: bright white is high, cold storm cloud.',
    about: 'Meteosat’s infrared picture, every 15 minutes. The brighter and whiter the cloud, the colder and higher it is: big bright blobs are thunderstorms. It works at night too.',
    source: 'EUMETSAT', sourceUrl: 'https://view.eumetsat.int', keywords: 'cloud satellite infrared meteosat storm thunderstorm eumetsat',
    legend: [{ colour: '#ffffff', label: 'High, cold cloud', shape: 'area' }, { colour: '#6b7280', label: 'Low cloud', shape: 'area' }],
  },
  {
    id: 'river-floods-3d', label: 'River floods forecast (next 3 days)', group: 'Hazards now', kind: 'tiles', refreshMinutes: 360,
    maxNativeZoom: 10, opacity: 0.9, hint: 'Rivers forecast to flood in the next three days.',
    about: 'The Global Flood Awareness System’s forecast for the big rivers, made each day. It shows where a river may rise above a flood level in the next three days. It does not see small streams or flash floods in town: use the rain radar and the warnings for those.',
    source: 'Copernicus GloFAS', sourceUrl: 'https://global-flood.emergency.copernicus.eu', keywords: 'river flood forecast glofas copernicus umgeni umlazi',
    legend: [{ colour: '#7c3aed', label: 'Severe (above 20-year level)', shape: 'line' }, { colour: '#dc2626', label: 'High (above 5-year)', shape: 'line' },
      { colour: '#f59e0b', label: 'Medium (above 2-year)', shape: 'line' }],
  },
  {
    id: 'quakes', label: 'Earthquakes (last 30 days)', group: 'Hazards now', kind: 'features', refreshMinutes: 30,
    hint: 'Earthquakes in South Africa, from the Council for Geoscience’s seismograph network.',
    about: 'Earthquakes recorded in and around South Africa in the last 30 days. The Council for Geoscience’s network reports them to the European seismology centre, which publishes them. Bigger dots are stronger quakes.',
    source: 'Council for Geoscience, through EMSC', sourceUrl: 'https://www.seismicportal.eu', keywords: 'earthquake tremor seismic quake cgs geoscience magnitude',
    legend: [{ colour: '#fde68a', label: 'Below 2.5', shape: 'dot' }, { colour: '#f59e0b', label: '2.5 to 4', shape: 'dot' },
      { colour: '#ea580c', label: '4 to 5', shape: 'dot' }, { colour: '#b91c1c', label: '5 and up', shape: 'dot' }],
  },
  {
    id: 'gdacs', label: 'Disasters in the region', group: 'Hazards now', kind: 'features', refreshMinutes: 30,
    hint: 'Floods, cyclones, quakes and droughts in southern Africa, from the UN’s alert system.',
    about: 'Current disasters in southern Africa and the Indian Ocean from GDACS, the United Nations and European Commission’s alert system, coloured by how serious GDACS rates them. Click one for its report.',
    source: 'GDACS', sourceUrl: 'https://www.gdacs.org', keywords: 'gdacs un disaster alert cyclone flood drought region mozambique',
    legend: [{ colour: '#16a34a', label: 'Green', shape: 'dot' }, { colour: '#f97316', label: 'Orange', shape: 'dot' }, { colour: '#dc2626', label: 'Red', shape: 'dot' }],
  },
  {
    id: 'cyclones', label: 'Tropical cyclones now', group: 'Hazards now', kind: 'features', refreshMinutes: 30,
    hint: 'Any tropical cyclone in the south-west Indian Ocean: where it is and where it is forecast to go.',
    about: 'Active tropical storms and cyclones in the Indian Ocean: their track so far, the forecast positions and the cone they may move in. Most seasons nothing comes near Durban; the cyclone season is November to April.',
    source: 'Esri, from the Joint Typhoon Warning Center', sourceUrl: 'https://www.arcgis.com/home/item.html?id=248e7b5827a34b248647afb012c58787',
    keywords: 'cyclone hurricane tropical storm indian ocean track cone',
    legend: [{ colour: '#a855f7', label: 'Forecast cone', shape: 'area' }, { colour: '#dc2626', label: 'Track and positions', shape: 'line' }],
  },
  {
    id: 'air-quality', label: 'Air quality', group: 'Hazards now', kind: 'features', refreshMinutes: 60,
    hint: 'How clean the air is across eThekwini this hour.',
    about: 'Air quality across eThekwini this hour, as the European air quality index (lower is cleaner). With a WAQI key on the server it shows the measuring stations themselves (SAAQIS, the national air quality network); without one, it is the modelled forecast from Open-Meteo.',
    source: 'SAAQIS through WAQI, or Open-Meteo', sourceUrl: 'https://saaqis.environment.gov.za', keywords: 'air quality pollution smoke pm2.5 saaqis waqi aqi',
    legend: [{ colour: '#50f0e6', label: 'Good', shape: 'dot' }, { colour: '#50ccaa', label: 'Fair', shape: 'dot' }, { colour: '#f0e641', label: 'Moderate', shape: 'dot' },
      { colour: '#ff5050', label: 'Poor', shape: 'dot' }, { colour: '#960032', label: 'Very poor', shape: 'dot' }],
  },
  /* ── Risk ─────────────────────────────────────────────────────────── */
  {
    id: 'flood-risk', label: 'Flood risk (this season)', group: 'Risk', kind: 'features',
    hint: 'How at risk each area is of flooding in this season.',
    about: 'The NDMC’s indicative risk profile for floods: the hazard in this season, how vulnerable the people are and what capacity there is to cope, combined into five classes. A planning guide for where to pre-position, not a forecast.',
    source: NDMC, sourceUrl: NDMC_URL, keywords: 'flood risk profile irp ndmc vulnerability capacity season', legend: RISK_LEGEND,
  },
  {
    id: 'fire-risk', label: 'Fire risk (this season)', group: 'Risk', kind: 'features',
    hint: 'How at risk each area is of veld and settlement fires in this season.',
    about: 'The NDMC’s indicative risk profile for fire, for this season: hazard, vulnerability and capacity combined into five classes. Winter is the high season for veld fires inland.',
    source: NDMC, sourceUrl: NDMC_URL, keywords: 'fire risk profile irp ndmc veld settlement season', legend: RISK_LEGEND,
  },
  {
    id: 'drought', label: 'Drought (24-month rainfall)', group: 'Risk', kind: 'features',
    hint: 'How dry each river catchment has been over two years.',
    about: 'The standardised precipitation index over 24 months for each river catchment, the latest month the NDMC has published. Below −1 is drier than usual, below −2 extremely dry.',
    source: NDMC, sourceUrl: NDMC_URL, keywords: 'drought spi rainfall dry catchment water',
    legend: [{ colour: '#8c510a', label: 'Extremely dry', shape: 'area' }, { colour: '#d8b365', label: 'Severely dry', shape: 'area' },
      { colour: '#f6e8c3', label: 'Moderately dry', shape: 'area' }, { colour: '#c7eae5', label: 'Moderately wet', shape: 'area' },
      { colour: '#5ab4ac', label: 'Very wet', shape: 'area' }],
  },
  {
    id: 'flood-hazard-100y', label: 'River flood depth (1-in-100-year flood)', group: 'Risk', kind: 'tiles',
    maxNativeZoom: 12, opacity: 0.7, hint: 'How deep a 1-in-100-year river flood would be.',
    about: 'Copernicus’s map of how deep the water would be in a river flood that comes once in a hundred years on average. Darker blue is deeper. It covers the larger rivers.',
    source: 'Copernicus GloFAS', sourceUrl: 'https://global-flood.emergency.copernicus.eu', keywords: 'flood depth hazard return period 100 year river',
    legend: [{ colour: '#bfdbfe', label: 'Shallow', shape: 'area' }, { colour: '#1d4ed8', label: 'Deep', shape: 'area' }],
  },
  {
    id: 'cyclone-risk', label: 'Tropical cyclone risk', group: 'Risk', kind: 'tiles',
    maxNativeZoom: 8, opacity: 0.6, hint: 'Where tropical cyclones have done and could do damage.',
    about: 'The NDMC’s tropical cyclone risk layer, from the tracks of past cyclones and who lives where. The north coast of KwaZulu-Natal carries the most.',
    source: NDMC, sourceUrl: NDMC_URL, keywords: 'cyclone risk tropical coast ndmc', legend: RISK_LEGEND,
  },
  /* ── Wards and people ─────────────────────────────────────────────── */
  {
    id: 'wards', label: 'Wards and councillors', group: 'Wards and people', kind: 'features',
    hint: 'eThekwini’s 111 wards; click one for its councillor.',
    about: 'The 111 eThekwini wards as the Municipal Demarcation Board drew them for the 2021 elections. Click a ward to see its councillor and number from the councillors’ list.',
    source: 'Municipal Demarcation Board, through the NDMC', sourceUrl: 'https://www.demarcation.org.za', keywords: 'ward boundary councillor demarcation',
    legend: [{ colour: '#38bdf8', label: 'Ward boundary', shape: 'line' }],
  },
  {
    id: 'ward-informal', label: 'Informal homes, by ward', group: 'Wards and people', kind: 'features',
    hint: 'The share of homes in each ward that are informal: shacks and backyard rooms.',
    about: 'The share of homes in each ward that are informal dwellings, from the 2011 Census as the NDMC fitted it to the 2016 wards. Older figures: a guide to where fire and flood hit hardest, not a count.',
    source: 'Stats SA Census 2011, through the NDMC', sourceUrl: NDMC_URL, keywords: 'informal settlement shack dwelling census ward vulnerable',
    legend: SHARE_LEGEND(['Under 5%', '5 to 15%', '15 to 30%', '30 to 50%', '50% and more']),
  },
  {
    id: 'ward-water', label: 'No piped water, by ward', group: 'Wards and people', kind: 'features',
    hint: 'The share of people in each ward with no piped water.',
    about: 'The share of people in each ward with no access to piped water, from the 2011 Census on the 2016 wards. Where water tankers are needed first when supply fails.',
    source: 'Stats SA Census 2011, through the NDMC', sourceUrl: NDMC_URL, keywords: 'water piped tanker services census ward',
    legend: SHARE_LEGEND(['Under 2%', '2 to 5%', '5 to 10%', '10 to 20%', '20% and more']),
  },
  {
    id: 'ward-children', label: 'Children, by ward', group: 'Wards and people', kind: 'features',
    hint: 'The share of people in each ward aged 16 and under.',
    about: 'The share of each ward’s people aged 16 or under, from the 2011 Census on the 2016 wards. Children need nappies, formula and schooling when families are displaced.',
    source: 'Stats SA Census 2011, through the NDMC', sourceUrl: NDMC_URL, keywords: 'children age young census ward vulnerable',
    legend: SHARE_LEGEND(['Under 25%', '25 to 30%', '30 to 35%', '35 to 40%', '40% and more']),
  },
  {
    id: 'ward-older', label: 'Older people, by ward', group: 'Wards and people', kind: 'features',
    hint: 'The share of people in each ward aged 65 and over.',
    about: 'The share of each ward’s people aged 65 or over, from the 2011 Census on the 2016 wards. Older people often need help to evacuate and medicine in the halls.',
    source: 'Stats SA Census 2011, through the NDMC', sourceUrl: NDMC_URL, keywords: 'older elderly pensioners age census ward vulnerable',
    legend: SHARE_LEGEND(['Under 3%', '3 to 5%', '5 to 8%', '8 to 12%', '12% and more']),
  },
  {
    id: 'clinics', label: 'Clinics and hospitals (open map)', group: 'Wards and people', kind: 'features',
    hint: 'Clinics and hospitals mapped on OpenStreetMap.',
    about: 'Clinics, hospitals and doctors’ rooms as mapped by volunteers on OpenStreetMap, collected by the NDMC. Not every clinic is mapped: the Health Unit’s list comes first.',
    source: 'OpenStreetMap, through the NDMC', sourceUrl: 'https://www.openstreetmap.org', keywords: 'clinic hospital health doctor medical',
    legend: [{ colour: '#ef4444', label: 'Hospital', shape: 'dot' }, { colour: '#f472b6', label: 'Clinic or doctor', shape: 'dot' }],
  },
  {
    id: 'schools', label: 'Schools (open map)', group: 'Wards and people', kind: 'features',
    hint: 'Schools and crèches mapped on OpenStreetMap: possible halls and places to warn.',
    about: 'Schools, crèches and colleges as mapped by volunteers on OpenStreetMap, collected by the NDMC. Not every school is mapped.',
    source: 'OpenStreetMap, through the NDMC', sourceUrl: 'https://www.openstreetmap.org', keywords: 'school creche college education',
    legend: [{ colour: '#2563eb', label: 'School', shape: 'dot' }],
  },
  /* ── Past events ──────────────────────────────────────────────────── */
  {
    id: 'past-events', label: 'Past weather disasters (SAWS records)', group: 'Past events', kind: 'features',
    hint: 'Every recorded flood, storm, landslide and more in eThekwini since the 1800s.',
    about: 'The SA Weather Service’s record of weather disasters in eThekwini (the Caelum list, to the end of 2024), mapped by the NDMC. Click one for the date, what happened, and the deaths and damage recorded.',
    source: 'SA Weather Service, through the NDMC', sourceUrl: NDMC_URL, keywords: 'history past events caelum flood storm landslide deaths record',
    legend: [{ colour: '#2563eb', label: 'Flood or heavy rain', shape: 'dot' }, { colour: '#7c3aed', label: 'Storm, wind or hail', shape: 'dot' },
      { colour: '#92400e', label: 'Landslide', shape: 'dot' }, { colour: '#dc2626', label: 'Fire', shape: 'dot' }, { colour: '#64748b', label: 'Other', shape: 'dot' }],
  },
  {
    id: 'past-fires', label: 'Past fires from satellite (2000 to now)', group: 'Past events', kind: 'features',
    hint: 'Fires seen by satellite in eThekwini since 2000.',
    about: 'Fires the MODIS satellites saw with high confidence (above 80%) in eThekwini since 2000, collected by the NDMC. Where fires come back year after year.',
    source: 'NASA MODIS, through the NDMC', sourceUrl: NDMC_URL, keywords: 'fire history modis veld hotspot past years',
    legend: [{ colour: '#dc2626', label: 'Last 5 years', shape: 'dot' }, { colour: '#f97316', label: '5 to 15 years ago', shape: 'dot' },
      { colour: '#fbbf24', label: 'Older', shape: 'dot' }],
  },
  /* ── April 2022 floods ────────────────────────────────────────────── */
  {
    id: 'flood2022-damage', label: 'Damage by ward (April 2022 floods)', group: 'April 2022 floods', kind: 'features',
    hint: 'Roads, homes and bridges damaged in the April 2022 floods.',
    about: 'Damage from the floods of 11 and 12 April 2022, observed by Disaster Management from satellite pictures and filed by ward (3 May 2022). Shows where the next big rain will likely hurt again.',
    source: NDMC, sourceUrl: NDMC_URL, keywords: '2022 april floods damage roads homes bridges ward',
    legend: [{ colour: '#dc2626', label: 'Homes', shape: 'dot' }, { colour: '#64748b', label: 'Roads', shape: 'dot' },
      { colour: '#7c3aed', label: 'Bridges', shape: 'dot' }, { colour: '#f59e0b', label: 'Other', shape: 'dot' }],
  },
  {
    id: 'flood2022-satellite', label: 'Damage seen from satellite (April 2022)', group: 'April 2022 floods', kind: 'features',
    hint: 'Mudslides, flooding and damaged buildings mapped by SANSA after the April 2022 floods.',
    about: 'Damage points the South African National Space Agency mapped from satellite pictures on 5 May 2022, after the April floods: mudslides, flooding and damaged buildings.',
    source: 'SANSA, through the NDMC', sourceUrl: 'https://www.sansa.org.za', keywords: '2022 april floods sansa satellite mudslide damage',
    legend: [{ colour: '#92400e', label: 'Mudslide', shape: 'dot' }, { colour: '#2563eb', label: 'Flooding', shape: 'dot' }, { colour: '#f59e0b', label: 'Other', shape: 'dot' }],
  },
  {
    id: 'flood2022-needs', label: 'Needs reported (April 2022)', group: 'April 2022 floods', kind: 'features',
    hint: 'What people said they needed after the April 2022 floods.',
    about: 'Needs reported by the public on the PISTA platform after the April 2022 floods (22 April 2022): food, clothing, shelter and more. Only the kind of need is shown here, never the person.',
    source: 'PISTA, through the NDMC', sourceUrl: NDMC_URL, keywords: '2022 april floods needs relief food clothing shelter pista',
    legend: [{ colour: '#e11d48', label: 'A need', shape: 'dot' }],
  },
  {
    id: 'flood2022-offers', label: 'Help offered (April 2022)', group: 'April 2022 floods', kind: 'features',
    hint: 'Help people and businesses offered after the April 2022 floods.',
    about: 'Offers of help on the PISTA platform after the April 2022 floods (24 April 2022): transport, food, communications and more. Only the kind of help is shown, never the person.',
    source: 'PISTA, through the NDMC', sourceUrl: NDMC_URL, keywords: '2022 april floods offers help resources donations pista',
    legend: [{ colour: '#16a34a', label: 'An offer', shape: 'dot' }],
  },
] as const satisfies readonly CatalogueOverlay[];

export type CatalogueId = (typeof CATALOGUE)[number]['id'];
export const CATALOGUE_IDS: readonly CatalogueId[] = CATALOGUE.map((o) => o.id);

export function isCatalogueId(id: string): id is CatalogueId {
  return (CATALOGUE_IDS as readonly string[]).includes(id);
}

export function catalogueOverlay(id: string): CatalogueOverlay | null {
  return (CATALOGUE as readonly CatalogueOverlay[]).find((o) => o.id === id) ?? null;
}

/** The feature an overlay sends, ready to draw: colour and words chosen on the server. */
export type OverlayFeatureProps = {
  title: string;
  lines?: string[];
  colour: string;
  /** Points: the dot's size in pixels. */
  radius?: number;
  /** Areas: fill (default) or outline only. */
  outline?: boolean;
  /** A short label drawn on the map (a ward number). */
  label?: string;
  /** Read more on the source's own site. */
  url?: string;
  ward?: number;
  /** A census share (per cent) and the ward's people, for the ward profiles. */
  value?: number;
  count?: number;
};

/** Does an overlay match what was typed in the panel's search box? */
export function matchesSearch(o: { label: string; hint: string; keywords: string; source: string; group: string }, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = `${o.label} ${o.hint} ${o.keywords} ${o.source} ${o.group}`.toLowerCase();
  return words.every((w) => text.includes(w));
}

/** The season the NDMC's risk profiles use: summer December to February, and so on. */
export function riskSeason(at: Date = new Date()): 'Summer' | 'Autumn' | 'Winter' | 'Spring' {
  const m = new Date(at.getTime() + 2 * 3600_000).getUTCMonth();
  return m === 11 || m <= 1 ? 'Summer' : m <= 4 ? 'Autumn' : m <= 7 ? 'Winter' : 'Spring';
}
