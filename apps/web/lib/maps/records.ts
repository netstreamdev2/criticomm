import { ndmcQuery, overlayFeatures } from './sources.ts';
import { wardAt } from './geo.ts';

/**
 * Past disasters for the records (0119): the SA Weather Service's record of
 * weather disasters in eThekwini (the Caelum list, from the NDMC), each with
 * its ward, and the major events in the Director's briefing of 1 December
 * 2025. Rows as import_past_events() takes them.
 */

export type PastEventRow = {
  source_ref: string; year: number; occurred_on?: string | null; event: string; category?: string | null; priority_risk?: string | null;
  place?: string | null; ward?: number | null; lat?: number | null; lng?: number | null; deaths?: number | null; injured?: number | null;
  missing?: number | null; homes?: number | null; affected?: number | null; displaced?: number | null; cost?: string | null; notes?: string | null;
};

export const SAWS_RECORDS = 'SA Weather Service records';
export const BRIEFING = 'Director’s briefing, 1 December 2025';
/** The database's name for the briefing (with a plain apostrophe). */
export const BRIEFING_SOURCE = "Director's briefing, 1 December 2025";

/** The top ten risk a recorded event counts towards, from its NDMC category and SAWS's words. */
export function recordRisk(category: string, event: string): string | null {
  const c = `${category} ${event}`.toLowerCase();
  if (/surge|wave|coastal|tidal/.test(c)) return 'Storm surge';
  if (/land|debris|mud|rockfall/.test(c)) return 'Landslides';
  if (/flood|rain|downpour/.test(c)) return 'Floods';
  if (/storm|wind|hail|tornado|lightning|convective|gale|cyclone/.test(c)) return 'Severe storms';
  if (/disease|epidemic|cholera|covid/.test(c)) return 'Human disease';
  if (/unrest|riot/.test(c)) return 'Civil unrest and crime';
  return null;
}

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s(/-])\p{L}/gu, (m) => m.toUpperCase());
const int = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

/** SAWS's recorded events in eThekwini, each placed in its ward. */
export async function sawsRecordRows(): Promise<PastEventRow[]> {
  const [events, wards] = await Promise.all([
    ndmcQuery('Caelum_upto_end2024/FeatureServer/0', {
      where: "MUNICNAME='eThekwini'",
      fields: 'FID,Year,Month,Day,Event,NDMC_Cat,Place,Latitude,Longitude,Comments,Affected,Deaths,Injuries,Houses,Damage_cos',
    }),
    overlayFeatures('wards'),
  ]);
  const wardShapes = (wards?.features ?? []).map((w) => ({ geometry: w.geometry, properties: { ward: w.properties.ward } }));
  return events.flatMap((f): PastEventRow[] => {
    const p = f.properties;
    const year = int(p.Year);
    if (!year || year < 1600) return [];
    const month = int(p.Month);
    const day = int(p.Day);
    const lat = Number(p.Latitude);
    const lng = Number(p.Longitude);
    const placed = Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0;
    const event = titleCase(String(p.Event ?? '').trim()) || 'Weather event';
    const category = String(p.NDMC_Cat ?? '').trim() || null;
    return [{
      source_ref: String(p.FID), year,
      occurred_on: month && day && month <= 12 && day <= 31 ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null,
      event, category, priority_risk: recordRisk(category ?? '', event),
      place: titleCase(String(p.Place ?? '').trim()) || null,
      ward: placed ? wardAt(lng, lat, wardShapes) : null, lat: placed ? lat : null, lng: placed ? lng : null,
      deaths: int(p.Deaths), injured: int(p.Injuries), homes: int(p.Houses), affected: int(p.Affected),
      cost: String(p.Damage_cos ?? '').trim() || null, notes: String(p.Comments ?? '').trim().slice(0, 2000) || null,
    }];
  });
}

/**
 * The major events in the Director's briefing (1 December 2025), as the
 * briefing gives them: costs from the World Bank's diagnostic report on
 * disaster risk financing; the April 2022 figures from the City's flood
 * dashboard as at 9 May 2022.
 */
export const BRIEFING_ROWS: PastEventRow[] = [
  { source_ref: '2017-floods', year: 2017, event: '2017 floods', category: 'Floods', priority_risk: 'Floods', cost: 'R576 million' },
  { source_ref: '2019-floods', year: 2019, event: '2019 floods', category: 'Floods', priority_risk: 'Floods', cost: 'R1.8 billion' },
  {
    source_ref: '2020-covid', year: 2020, event: 'Covid-19', category: 'Human disease', priority_risk: 'Human disease',
    notes: 'Heavy financial impact due to lost revenue, the fiscal cost of responding and shipping backlogs affecting the port.',
  },
  { source_ref: '2021-unrest', year: 2021, event: '2021 riots', category: 'Civil unrest', priority_risk: 'Civil unrest and crime', cost: 'R20 billion' },
  {
    source_ref: '2022-floods', year: 2022, occurred_on: '2022-04-11', event: 'April 2022 floods', category: 'Floods', priority_risk: 'Floods',
    deaths: 390, missing: 60, injured: 7, homes: 18764, displaced: 9091, affected: 12494 + 28954,
    cost: 'Preliminary: R5.6 billion roads, R1.9 billion housing, billions in other infrastructure',
    notes: 'As at 9 May 2022: 78 wards impacted; 18,764 dwellings affected (18,672 totally and 93 partially damaged); 9,091 people in care centres; '
      + '12,494 children and 28,954 adults affected; 430 roads affected; 248 schools damaged.',
  },
];
