import { overlayFeatures, type Collection } from './sources.ts';
import { areaMiddle, pointInArea } from './geo.ts';

/**
 * What the open data says about each eThekwini ward, for the ward profiles:
 * its outline (the 2020 wards), the 2011 Census shares (fitted by the NDMC to
 * the 2016 wards, matched here by ward number), the damage points of the
 * April 2022 floods, and the flood and fire risk where the ward's middle
 * lies. A source that does not answer leaves its figures blank and is named
 * in `missing`.
 */

export type WardFacts = {
  ward: number; geometry: unknown; people: number | null;
  informal: number | null; water: number | null; children: number | null; older: number | null;
  damage2022: number; damageByType: Record<string, number>; floodRisk: string | null; fireRisk: string | null;
};

const SOURCES = ['wards', 'ward-informal', 'ward-water', 'ward-children', 'ward-older', 'flood2022-damage', 'flood-risk', 'fire-risk'] as const;
const NAMES: Record<(typeof SOURCES)[number], string> = {
  wards: 'ward outlines', 'ward-informal': 'informal homes', 'ward-water': 'piped water', 'ward-children': 'children', 'ward-older': 'older people',
  'flood2022-damage': '2022 flood damage', 'flood-risk': 'flood risk', 'fire-risk': 'fire risk',
};

export async function wardFacts(): Promise<{ wards: WardFacts[]; missing: string[] }> {
  const got = await Promise.all(SOURCES.map((id) => overlayFeatures(id).catch(() => null)));
  const data = Object.fromEntries(SOURCES.map((id, i) => [id, got[i]])) as Record<(typeof SOURCES)[number], Collection | null>;
  const missing = SOURCES.filter((id) => !data[id]).map((id) => NAMES[id]);
  const share = (id: (typeof SOURCES)[number]) => new Map((data[id]?.features ?? [])
    .filter((f) => f.properties.ward != null).map((f) => [f.properties.ward!, f.properties] as const));
  const informal = share('ward-informal');
  const water = share('ward-water');
  const children = share('ward-children');
  const older = share('ward-older');
  const damage = new Map<number, Record<string, number>>();
  for (const f of data['flood2022-damage']?.features ?? []) {
    if (f.properties.ward == null) continue;
    const type = f.properties.lines?.[0] || 'Other';
    const m = damage.get(f.properties.ward) ?? {};
    m[type] = (m[type] ?? 0) + 1;
    damage.set(f.properties.ward, m);
  }
  const riskAt = (id: 'flood-risk' | 'fire-risk', middle: [number, number] | null) => {
    if (!middle) return null;
    const hit = (data[id]?.features ?? []).find((f) => pointInArea(middle[0], middle[1], f.geometry as { type?: string; coordinates?: unknown }));
    return hit ? hit.properties.title.replace(/^.*?:\s*/, '') : null;
  };
  const wards = (data.wards?.features ?? []).filter((f) => f.properties.ward != null).map((f): WardFacts => {
    const n = f.properties.ward!;
    const middle = areaMiddle(f.geometry as { type?: string; coordinates?: unknown });
    const byType = damage.get(n) ?? {};
    return {
      ward: n, geometry: f.geometry, people: informal.get(n)?.count ?? water.get(n)?.count ?? null,
      informal: informal.get(n)?.value ?? null, water: water.get(n)?.value ?? null,
      children: children.get(n)?.value ?? null, older: older.get(n)?.value ?? null,
      damage2022: Object.values(byType).reduce((a, b) => a + b, 0), damageByType: byType,
      floodRisk: riskAt('flood-risk', middle), fireRisk: riskAt('fire-risk', middle),
    };
  }).sort((a, b) => a.ward - b.ward);
  return { wards, missing };
}
