import { riskSeason, type CatalogueId, type OverlayFeatureProps } from '../ops-map/catalogue.ts';

/**
 * Where each map overlay comes from, fetched and coloured on the server
 * (/api/maps/features/[id], /api/maps/tiles/[id]/…). Answers are kept for a
 * while (a day for records, minutes for live data), so a busy control room
 * asks each source once, not once per screen. Keys stay here. No
 * 'server-only' import: the tests read the colour rules; only the API routes
 * import it.
 */

export type Feature = { type: 'Feature'; geometry: unknown; properties: OverlayFeatureProps };
export type Collection = { type: 'FeatureCollection'; features: Feature[]; note?: string };

/** eThekwini and a little around it: west, south, east, north. */
export const ETHEKWINI_BOX = [30.55, -30.25, 31.30, -29.40] as const;
const NDMC = 'https://services1.arcgis.com/ftGK1aDqBBnpyqag/arcgis/rest/services';
const DAY = 24 * 60;

type Raw = { type: 'Feature'; geometry: unknown; properties: Record<string, unknown> };
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v ?? Number.NaN));
const str = (v: unknown) => (v == null ? '' : String(v).trim());
const pct = (part: number, whole: number) => (whole > 0 ? (100 * part) / whole : 0);
const fmtPct = (n: number) => `${n < 10 ? n.toFixed(1) : Math.round(n)}%`;
const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s(/-])\p{L}/gu, (m) => m.toUpperCase());

async function json(url: string, timeoutMs = 20_000): Promise<unknown> {
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res.json();
}

/**
 * Every feature of an NDMC layer inside eThekwini, as GeoJSON in degrees,
 * page by page (a layer gives 1 000 or 2 000 at a time). Shapes are
 * simplified to about 50 m, more than fine at city zoom.
 */
export async function ndmcQuery(path: string, opts: { where?: string; fields: string; simplify?: boolean; max?: number }): Promise<Raw[]> {
  const out: Raw[] = [];
  const box = ETHEKWINI_BOX.join(',');
  for (let offset = 0; offset < (opts.max ?? 6000); offset += 1000) {
    const q = new URLSearchParams({
      where: opts.where ?? '1=1', outFields: opts.fields, outSR: '4326', f: 'geojson', returnGeometry: 'true',
      geometry: box, geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
      resultOffset: String(offset), resultRecordCount: '1000', geometryPrecision: '5',
      ...(opts.simplify ? { maxAllowableOffset: '0.0005' } : {}),
    });
    const page = (await json(`${NDMC}/${path}/query?${q}`, 30_000)) as { features?: Raw[]; error?: { message?: string } };
    if (page.error) throw new Error(page.error.message ?? 'The NDMC layer refused the question.');
    const got = page.features ?? [];
    out.push(...got);
    if (got.length < 1000) break;
  }
  return out;
}

/* ── Colours ─────────────────────────────────────────────────────────── */

const RISK = ['#1a9850', '#91cf60', '#fee08b', '#fc8d59', '#d73027'];
const RISK_NAME = ['Very low', 'Low', 'Medium', 'High', 'Very high'];
/** An NDMC risk score (about 1 to 5) → its class colour and name. */
export function riskClass(score: number): { colour: string; name: string } {
  const i = Math.min(4, Math.max(0, Math.round(Number.isFinite(score) ? score : 1) - 1));
  return { colour: RISK[i]!, name: RISK_NAME[i]! };
}

const SHARE = ['#fff5eb', '#fdd0a2', '#fd8d3c', '#d94801', '#7f2704'];
/** A percentage → its colour, by the overlay's bins (the lower edges of bins 2 to 5). */
export function shareColour(value: number, edges: [number, number, number, number]): string {
  const i = edges.filter((e) => value >= e).length;
  return SHARE[i]!;
}

/** SPI → the drought class. */
export function spiClass(spi: number): { colour: string; name: string } {
  if (spi <= -2) return { colour: '#8c510a', name: 'Extremely dry' };
  if (spi <= -1.5) return { colour: '#d8b365', name: 'Severely dry' };
  if (spi <= -1) return { colour: '#f6e8c3', name: 'Moderately dry' };
  if (spi < 1) return { colour: '#e5e7eb', name: 'Near normal' };
  if (spi < 1.5) return { colour: '#c7eae5', name: 'Moderately wet' };
  return { colour: '#5ab4ac', name: 'Very wet' };
}

export function quakeColour(mag: number): string {
  return mag >= 5 ? '#b91c1c' : mag >= 4 ? '#ea580c' : mag >= 2.5 ? '#f59e0b' : '#fde68a';
}

/** The European air quality index's bands. */
export function aqiBand(index: number): { colour: string; name: string } {
  if (index < 20) return { colour: '#50f0e6', name: 'Good' };
  if (index < 40) return { colour: '#50ccaa', name: 'Fair' };
  if (index < 60) return { colour: '#f0e641', name: 'Moderate' };
  if (index < 80) return { colour: '#ff5050', name: 'Poor' };
  return { colour: '#960032', name: 'Very poor' };
}

/** The SAWS historical events' categories, as the map colours them. */
export function eventColour(category: string): string {
  const c = category.toLowerCase();
  if (/flood|rain/.test(c)) return '#2563eb';
  if (/storm|wind|hail|tornado|lightning|convective/.test(c)) return '#7c3aed';
  if (/land|debris|mud/.test(c)) return '#92400e';
  if (/fire/.test(c)) return '#dc2626';
  return '#64748b';
}

/* ── GDACS ────────────────────────────────────────────────────────────── */

const GDACS_COLOUR: Record<string, string> = { Green: '#16a34a', Orange: '#f97316', Red: '#dc2626' };
const GDACS_KIND: Record<string, string> = { FL: 'Flood', TC: 'Tropical cyclone', EQ: 'Earthquake', VO: 'Volcano', DR: 'Drought', WF: 'Wildfire', TS: 'Tsunami' };
const tagText = (xml: string, tag: string) => (new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml)?.[1] ?? '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

/** GDACS's current events in southern Africa and the south-west Indian Ocean, from its RSS. */
export function gdacsItems(xml: string): Feature[] {
  return xml.split('<item>').slice(1).flatMap((item) => {
    const lat = Number(tagText(item, 'geo:lat'));
    const lng = Number(tagText(item, 'geo:long'));
    if (tagText(item, 'gdacs:iscurrent') !== 'true' || !Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    if (lat < -45 || lat > 0 || lng < 5 || lng > 75) return [];
    const level = tagText(item, 'gdacs:alertlevel');
    const kind = GDACS_KIND[tagText(item, 'gdacs:eventtype')] ?? 'Disaster';
    const name = tagText(item, 'gdacs:eventname') || tagText(item, 'gdacs:country');
    return [feature(point(lng, lat), {
      title: `${kind}: ${name}`, colour: GDACS_COLOUR[level] ?? '#64748b', radius: 9,
      lines: [`${level} alert`, tagText(item, 'title').slice(0, 160)],
      url: tagText(item, 'link').replace(/^http:/, 'https:') || 'https://www.gdacs.org',
    })];
  });
}

/* ── The sources ─────────────────────────────────────────────────────── */

type FeatureSource = { minutes: number; fetch: () => Promise<Collection> };
const fc = (features: Feature[], note?: string): Collection => ({ type: 'FeatureCollection', features, ...(note ? { note } : {}) });
const feature = (geometry: unknown, properties: OverlayFeatureProps): Feature => ({ type: 'Feature', geometry, properties });
const point = (lng: number, lat: number) => ({ type: 'Point', coordinates: [lng, lat] });

/** Census shares by ward (2011 Census on the 2016 wards). */
function wardShare(service: string, fields: string, value: (p: Record<string, unknown>) => number, edges: [number, number, number, number], what: string): FeatureSource {
  return {
    minutes: DAY,
    fetch: async () => fc((await ndmcQuery(`${service}/FeatureServer/0`, { where: "CAT_B='ETH'", fields: `WardNo,POPTotal,${fields}`, simplify: true }))
      .map((f) => {
        const v = value(f.properties);
        return feature(f.geometry, {
          title: `Ward ${str(f.properties.WardNo)}`, colour: shareColour(v, edges), ward: num(f.properties.WardNo),
          value: Math.round(v * 10) / 10, count: Math.round(num(f.properties.POPTotal)),
          lines: [`${fmtPct(v)} ${what}`, `About ${Math.round(num(f.properties.POPTotal)).toLocaleString('en-ZA')} people (Census 2011)`],
        });
      })),
  };
}

const FEATURES: Partial<Record<CatalogueId, FeatureSource>> = {
  quakes: {
    minutes: 30,
    fetch: async () => {
      const since = new Date(Date.now() - 30 * 24 * 3600_000).toISOString().slice(0, 10);
      const j = (await json(`https://www.seismicportal.eu/fdsnws/event/1/query?format=json&minlat=-35&maxlat=-22&minlon=16&maxlon=33&starttime=${since}&limit=500`)) as { features?: Raw[] };
      return fc((j.features ?? []).map((f) => {
        const p = f.properties;
        const mag = num(p.mag);
        return feature(f.geometry, {
          title: `Magnitude ${mag.toFixed(1)}`, colour: quakeColour(mag), radius: Math.max(4, Math.min(16, 3 + mag * 2.2)),
          lines: [titleCase(str(p.flynn_region)), new Date(str(p.time)).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' }),
            `${Math.round(num(p.depth))} km deep · reported by ${str(p.auth) || 'EMSC'}`],
          url: `https://www.seismicportal.eu/eventdetails.html?unid=${encodeURIComponent(str(p.unid))}`,
        });
      }));
    },
  },
  gdacs: {
    minutes: 30,
    // GDACS's own list as RSS: one file, quick to fetch (its search service is slow and often times out).
    fetch: async () => {
      const res = await fetch('https://www.gdacs.org/xml/rss.xml', { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`www.gdacs.org answered ${res.status}`);
      return fc(gdacsItems(await res.text()));
    },
  },
  cyclones: {
    minutes: 30,
    fetch: async () => {
      const base = 'https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/Active_Hurricanes_v1/FeatureServer';
      const box = 'geometry=20,-45,90,0&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outSR=4326&f=geojson&where=1%3D1&outFields=*';
      const layer = (l: number) => json(`${base}/${l}/query?${box}`).catch(() => ({ features: [] })) as Promise<{ features?: Raw[] }>;
      const [cone, track, positions] = await Promise.all([layer(4), layer(3), layer(0)]);
      const name = (p: Record<string, unknown>) => str(p.STORMNAME ?? p.STORMID ?? 'Tropical storm');
      return fc([
        ...(cone.features ?? []).map((f) => feature(f.geometry, { title: name(f.properties), colour: '#a855f7', lines: ['Forecast cone'] })),
        ...(track.features ?? []).map((f) => feature(f.geometry, { title: name(f.properties), colour: '#dc2626', outline: true, lines: ['Track so far'] })),
        ...(positions.features ?? []).map((f) => feature(f.geometry, {
          title: name(f.properties), colour: '#dc2626', radius: 6,
          lines: [str(f.properties.STORMTYPE), f.properties.MAXWIND ? `Winds ${num(f.properties.MAXWIND)} knots` : '', str(f.properties.FLDATELBL)].filter(Boolean),
        })),
      ], (cone.features?.length || track.features?.length || positions.features?.length) ? undefined : 'No tropical cyclone in the south-west Indian Ocean now.');
    },
  },
  'air-quality': {
    minutes: 60,
    fetch: async () => {
      const token = process.env.WAQI_TOKEN;
      if (token) {
        const [w, s, e, n] = ETHEKWINI_BOX;
        const j = (await json(`https://api.waqi.info/v2/map/bounds?latlng=${s},${w},${n},${e}&networks=all&token=${encodeURIComponent(token)}`)) as {
          data?: Array<{ lat: number; lon: number; aqi: string; station?: { name?: string; time?: string } }>;
        };
        return fc((j.data ?? []).filter((d) => Number.isFinite(Number(d.aqi))).map((d) => {
          // WAQI's index is the US one: show the number and a plain band.
          const aqi = Number(d.aqi);
          const band = aqi <= 50 ? aqiBand(10) : aqi <= 100 ? aqiBand(45) : aqi <= 150 ? aqiBand(65) : aqiBand(90);
          return feature(point(d.lon, d.lat), {
            title: str(d.station?.name) || 'Air quality station', colour: band.colour, radius: 9,
            lines: [`${band.name} (index ${aqi})`, d.station?.time ? `Measured ${str(d.station.time)}` : ''].filter(Boolean),
          });
        }));
      }
      // Modelled air quality on a small grid over the city (no key needed).
      const lats = [-29.65, -29.8, -29.95, -30.1];
      const lngs = [30.75, 30.9, 31.05];
      const pts = lats.flatMap((lat) => lngs.map((lng) => [lat, lng] as const));
      const j = (await json(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${pts.map((p) => p[0]).join(',')}&longitude=${pts.map((p) => p[1]).join(',')}&current=european_aqi,pm2_5,pm10`)) as
        Array<{ latitude: number; longitude: number; current?: { european_aqi?: number; pm2_5?: number; pm10?: number } }> | { current?: unknown };
      const rows = Array.isArray(j) ? j : [j as { latitude: number; longitude: number; current?: { european_aqi?: number; pm2_5?: number; pm10?: number } }];
      return fc(rows.filter((r) => r.current?.european_aqi != null).map((r) => {
        const band = aqiBand(r.current!.european_aqi!);
        return feature(point(r.longitude, r.latitude), {
          title: `Air quality: ${band.name}`, colour: band.colour, radius: 11,
          lines: [`Index ${Math.round(r.current!.european_aqi!)} (modelled)`, `PM2.5 ${r.current!.pm2_5 ?? '—'} · PM10 ${r.current!.pm10 ?? '—'} µg/m³`],
        });
      }), 'Modelled, not measured. A WAQI key on the server shows the measuring stations.');
    },
  },
  'flood-risk': {
    minutes: DAY,
    fetch: async () => {
      const season = riskSeason();
      const field = { Summer: 'RTOT_Su', Autumn: 'RTOT_Au', Winter: 'RTOT_Wi', Spring: 'RTOT_Sp' }[season];
      return fc((await ndmcQuery('Risk_Floods_WFL1/FeatureServer/0', { fields: `MESO_ID,${field},VULTOT,CAPTOT`, simplify: true })).map((f) => {
        const r = riskClass(num(f.properties[field]));
        return feature(f.geometry, {
          title: `Flood risk (${season.toLowerCase()}): ${r.name}`, colour: r.colour,
          lines: [`Vulnerability ${num(f.properties.VULTOT).toFixed(1)} · capacity ${num(f.properties.CAPTOT).toFixed(1)} (1 low to 5 high)`],
        });
      }));
    },
  },
  'fire-risk': {
    minutes: DAY,
    fetch: async () => {
      const season = riskSeason();
      const layer = { Summer: 15, Autumn: 14, Winter: 13, Spring: 7 }[season];
      const field = `RiskTotal${season}`;
      return fc((await ndmcQuery(`IRP_Fire/FeatureServer/${layer}`, { fields: `MESO_ID,${field},VulnerabilityTotal,CapacityTotal`, simplify: true })).map((f) => {
        const r = riskClass(num(f.properties[field]));
        return feature(f.geometry, {
          title: `Fire risk (${season.toLowerCase()}): ${r.name}`, colour: r.colour,
          lines: [`Vulnerability ${num(f.properties.VulnerabilityTotal).toFixed(1)} · capacity ${num(f.properties.CapacityTotal).toFixed(1)} (1 low to 5 high)`],
        });
      }));
    },
  },
  drought: {
    minutes: DAY,
    fetch: async () => {
      const rows = await ndmcQuery('SPI24_upto_03_2025_Project/FeatureServer/6', { fields: '*', simplify: true });
      // The latest month published is the last NYYYY_MM column with a value.
      const months = rows.length ? Object.keys(rows[0]!.properties).filter((k) => /^N\d{4}_\d{2}$/.test(k)).sort() : [];
      const latest = [...months].reverse().find((m) => rows.some((r) => Number.isFinite(num(r.properties[m])))) ?? null;
      const label = latest ? new Date(`${latest.slice(1, 5)}-${latest.slice(6)}-15`).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' }) : '';
      return fc(rows.map((f) => {
        const spi = latest ? num(f.properties[latest]) : Number.NaN;
        const c = spiClass(spi);
        return feature(f.geometry, {
          title: `Catchment ${str(f.properties.QUATERNA)}: ${c.name}`, colour: c.colour,
          lines: [Number.isFinite(spi) ? `SPI ${spi.toFixed(2)} (24 months to ${label})` : 'No figure'],
        });
      }), latest ? `The latest month published: ${label}.` : undefined);
    },
  },
  wards: {
    minutes: DAY,
    fetch: async () => fc((await ndmcQuery('Boundaries22/FeatureServer/9', { where: "CAT_B='ETH'", fields: 'WardNo,WardID', simplify: true }))
      .map((f) => feature(f.geometry, {
        title: `Ward ${str(f.properties.WardNo)}`, colour: '#38bdf8', outline: true, label: str(f.properties.WardNo), ward: num(f.properties.WardNo),
        lines: [`Ward ID ${str(f.properties.WardID)}`],
      }))),
  },
  'ward-informal': wardShare('Wards_Dwellings', 'InformalDw,Informal_1,HouseBrick,Traditio_1,FlatApartm,ClusterinC,TownHouse_,Semidetach,HouseFlatR,RoomFlatle,CaravanTen,Dwell_Othe',
    (p) => {
      const informal = num(p.InformalDw) + num(p.Informal_1);
      const all = ['InformalDw', 'Informal_1', 'HouseBrick', 'Traditio_1', 'FlatApartm', 'ClusterinC', 'TownHouse_', 'Semidetach', 'HouseFlatR', 'RoomFlatle', 'CaravanTen', 'Dwell_Othe']
        .reduce((n, k) => n + (Number.isFinite(num(p[k])) ? num(p[k]) : 0), 0);
      return pct(informal, all);
    }, [5, 15, 30, 50], 'of homes are informal'),
  'ward-water': wardShare('Wards_Services', 'NoAccessPi', (p) => pct(num(p.NoAccessPi), num(p.POPTotal)), [2, 5, 10, 20], 'of people have no piped water'),
  'ward-children': wardShare('Wards_Demographic', 'Age0_16', (p) => pct(num(p.Age0_16), num(p.POPTotal)), [25, 30, 35, 40], 'of people are 16 or under'),
  'ward-older': wardShare('Wards_Demographic', 'Age65Plus', (p) => pct(num(p.Age65Plus), num(p.POPTotal)), [3, 5, 8, 12], 'of people are 65 or over'),
  clinics: {
    minutes: DAY,
    fetch: async () => fc((await ndmcQuery('HealthFacilities_Poi_Project/FeatureServer/0', { fields: 'name,amenity,healthcare,addr_full' }))
      .map((f) => {
        const kind = str(f.properties.amenity || f.properties.healthcare);
        return feature(f.geometry, {
          title: str(f.properties.name) || titleCase(kind), colour: kind === 'hospital' ? '#ef4444' : '#f472b6', radius: kind === 'hospital' ? 8 : 6,
          lines: [titleCase(kind), str(f.properties.addr_full)].filter(Boolean),
        });
      })),
  },
  schools: {
    minutes: DAY,
    fetch: async () => fc((await ndmcQuery('EducationFacilities__Project/FeatureServer/0', { fields: 'name,amenity,addr_full' }))
      .map((f) => feature(f.geometry, {
        title: str(f.properties.name) || 'School', colour: '#2563eb', radius: 6, lines: [titleCase(str(f.properties.amenity)), str(f.properties.addr_full)].filter(Boolean),
      }))),
  },
  'past-events': {
    minutes: DAY,
    fetch: async () => fc((await ndmcQuery('Caelum_upto_end2024/FeatureServer/0', {
      where: "MUNICNAME='eThekwini'", fields: 'Year,Month,Day,Event,NDMC_Cat,Place,Comments,Deaths,Injuries,Houses,Affected,Damage_cos',
    })).map((f) => {
      const p = f.properties;
      const when = [num(p.Day) || '', num(p.Month) ? new Date(2000, num(p.Month) - 1, 1).toLocaleString('en-ZA', { month: 'long' }) : '', num(p.Year) || '']
        .filter(Boolean).join(' ');
      const toll = [num(p.Deaths) > 0 ? `${num(p.Deaths)} died` : '', num(p.Injuries) > 0 ? `${num(p.Injuries)} injured` : '',
        num(p.Houses) > 0 ? `${num(p.Houses)} houses` : '', num(p.Affected) > 0 ? `${num(p.Affected)} affected` : ''].filter(Boolean).join(' · ');
      return feature(f.geometry, {
        title: `${titleCase(str(p.Event))}${when ? `, ${when}` : ''}`, colour: eventColour(`${str(p.NDMC_Cat)} ${str(p.Event)}`), radius: num(p.Deaths) > 0 ? 8 : 6,
        lines: [str(p.NDMC_Cat), titleCase(str(p.Place)), toll, str(p.Comments).slice(0, 160)].filter(Boolean),
      });
    })),
  },
  'past-fires': {
    minutes: DAY,
    fetch: async () => {
      const now = new Date().getFullYear();
      return fc((await ndmcQuery('FiresUpto2026_LM_v5_Project/FeatureServer/0', { where: 'CONFIDENCE>80', fields: 'Year,Month,Day,CONFIDENCE,LM_Name' }))
        .map((f) => {
          const y = num(f.properties.Year);
          return feature(f.geometry, {
            title: `Fire, ${num(f.properties.Day)} ${str(f.properties.Month)} ${y}`, colour: now - y <= 5 ? '#dc2626' : now - y <= 15 ? '#f97316' : '#fbbf24', radius: 4,
            lines: [`${num(f.properties.CONFIDENCE)}% sure it was a fire`, str(f.properties.LM_Name)],
          });
        }));
    },
  },
  'flood2022-damage': {
    minutes: DAY,
    fetch: async () => fc((await ndmcQuery('Wards_Damage_v2_Project/FeatureServer/88', { fields: 'TYPE_1,DAMAGE_1,WardNo_1' })).map((f) => {
      const type = str(f.properties.TYPE_1);
      const colour = /house|home|dwell|struct|build/i.test(type) ? '#dc2626' : /road/i.test(type) ? '#64748b' : /bridge/i.test(type) ? '#7c3aed' : '#f59e0b';
      return feature(f.geometry, {
        title: str(f.properties.DAMAGE_1) || type, colour, radius: 5, lines: [type, `Ward ${str(f.properties.WardNo_1)}`], ward: num(f.properties.WardNo_1),
      });
    })),
  },
  'flood2022-satellite': {
    minutes: DAY,
    fetch: async () => fc((await ndmcQuery('Durban_incidents_v2_Project/FeatureServer/104', { fields: 'Incident,Damaged_Pr,Place_name' })).map((f) => {
      const what = str(f.properties.Incident);
      const colour = /mud|slide|land/i.test(what) ? '#92400e' : /flood/i.test(what) ? '#2563eb' : '#f59e0b';
      return feature(f.geometry, { title: what || 'Damage', colour, radius: 5, lines: [str(f.properties.Damaged_Pr), str(f.properties.Place_name)].filter(Boolean) });
    })),
  },
  'flood2022-needs': {
    minutes: DAY,
    // Only the kind of need: the descriptions can carry people's names and numbers.
    fetch: async () => fc((await ndmcQuery('Needs_240422_Project/FeatureServer/33', { fields: 'need_type' }))
      .map((f) => feature(f.geometry, { title: `Need: ${str(f.properties.need_type) || 'not said'}`, colour: '#e11d48', radius: 5 }))),
  },
  'flood2022-offers': {
    minutes: DAY,
    fetch: async () => fc((await ndmcQuery('Resources_240422_Project/FeatureServer/30', { fields: 'resource_type' }))
      .map((f) => feature(f.geometry, { title: `Offer: ${str(f.properties.resource_type) || 'not said'}`, colour: '#16a34a', radius: 5 }))),
  },
};

const cache = new Map<string, { at: number; data: Collection }>();
const busy = new Map<string, Promise<Collection>>();

/** The overlay's features, from the cache while it is fresh; null for overlays the server does not fetch this way. */
export async function overlayFeatures(id: CatalogueId): Promise<Collection | null> {
  const src = FEATURES[id];
  if (!src) return null;
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < src.minutes * 60_000) return hit.data;
  const running = busy.get(id);
  if (running) return running;
  const job = src.fetch()
    .then((data) => { cache.set(id, { at: Date.now(), data }); return data; })
    .catch((e) => {
      // Stale beats nothing in an emergency: keep showing the last good answer.
      if (hit) return { ...hit.data, note: 'Could not refresh just now; showing the last answer.' };
      throw e;
    })
    .finally(() => busy.delete(id));
  busy.set(id, job);
  return job;
}

export const hasFeatureSource = (id: string) => id in FEATURES;

/* ── Map pictures ────────────────────────────────────────────────────── */

/** The tile's corners in web Mercator metres, for a WMS picture of it. */
export function tileBbox(z: number, x: number, y: number): [number, number, number, number] {
  const size = (2 * Math.PI * 6378137) / 2 ** z;
  const origin = Math.PI * 6378137;
  return [x * size - origin, origin - (y + 1) * size, (x + 1) * size - origin, origin - y * size];
}

const wms = (base: string, layers: string, z: number, x: number, y: number, extra = '') =>
  `${base}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=${layers}&STYLES=&CRS=EPSG:3857&BBOX=${tileBbox(z, x, y).join(',')}` +
  `&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=TRUE${extra}`;

const utcDay = (daysAgo = 0) => new Date(Date.now() - daysAgo * 24 * 3600_000).toISOString().slice(0, 10);

type TileSource = { minutes: number; maxZoom: number; url: (z: number, x: number, y: number) => string };
const GIBS = 'https://gibs.earthdata.nasa.gov';
const TILES: Partial<Record<CatalogueId, TileSource>> = {
  'flood-modis-2d': { minutes: 180, maxZoom: 9, url: (z, x, y) => `${GIBS}/wmts/epsg3857/best/MODIS_Combined_Flood_2-Day/default/default/GoogleMapsCompatible_Level9/${z}/${y}/${x}.png` },
  'flood-viirs-2d': { minutes: 180, maxZoom: 9, url: (z, x, y) => `${GIBS}/wmts/epsg3857/best/VIIRS_Combined_Flood_2-Day/default/default/GoogleMapsCompatible_Level9/${z}/${y}/${x}.png` },
  'fires-now': {
    minutes: 60, maxZoom: 12,
    // No date: GIBS answers with the latest day it has (today's is not out until tonight).
    url: (z, x, y) => wms(`${GIBS}/wms/epsg3857/best/wms.cgi`, 'VIIRS_NOAA20_Thermal_Anomalies_375m_All,VIIRS_SNPP_Thermal_Anomalies_375m_All', z, x, y),
  },
  'clouds-satellite': { minutes: 15, maxZoom: 8, url: (z, x, y) => wms('https://view.eumetsat.int/geoserver/ows', 'msg_fes:ir108', z, x, y) },
  // GloFAS publishes each forecast the next morning: yesterday's run is the latest.
  'river-floods-3d': {
    minutes: 360, maxZoom: 10,
    url: (z, x, y) => wms('https://ows.globalfloods.eu/glofas-ows/ows.py', 'sumAL41EGE', z, x, y, `&TIME=${utcDay(1)}T00:00Z`),
  },
  'flood-hazard-100y': { minutes: DAY, maxZoom: 12, url: (z, x, y) => wms('https://ows.globalfloods.eu/glofas-ows/ows.py', 'FloodHazard100y', z, x, y) },
  'cyclone-risk': {
    minutes: DAY, maxZoom: 7,
    url: (z, x, y) => `https://tiles.arcgis.com/tiles/ftGK1aDqBBnpyqag/arcgis/rest/services/Tropical_Cyclone_Risk_WTL1/MapServer/tile/${z}/${y}/${x}`,
  },
};

export function overlayTileUrl(id: CatalogueId, z: number, x: number, y: number): { url: string; minutes: number } | null {
  const src = TILES[id];
  if (!src || z > src.maxZoom) return null;
  return { url: src.url(z, x, y), minutes: src.minutes };
}

export const hasTileSource = (id: string) => id in TILES;
