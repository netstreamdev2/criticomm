/**
 * Small map sums done on the server: is a point inside an area, which ward
 * holds it, the middle of an area. GeoJSON order ([lng, lat]); areas are
 * Polygon or MultiPolygon, holes respected. Pure, tested (geo.test.ts).
 */

type Ring = number[][];
type Geometry = { type?: string; coordinates?: unknown };

function inRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as [number, number];
    const [xj, yj] = ring[j] as [number, number];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function polygons(g: Geometry | null | undefined): Ring[][] {
  if (!g || !Array.isArray(g.coordinates)) return [];
  if (g.type === 'Polygon') return [g.coordinates as Ring[]];
  if (g.type === 'MultiPolygon') return g.coordinates as Ring[][];
  return [];
}

/** Inside the area: inside an outer ring and none of its holes. */
export function pointInArea(lng: number, lat: number, g: Geometry | null | undefined): boolean {
  return polygons(g).some(([outer, ...holes]) => outer != null && inRing(lng, lat, outer) && !holes.some((h) => inRing(lng, lat, h)));
}

/** The ward number of the first ward that holds the point, or null. */
export function wardAt(lng: number, lat: number, wards: Array<{ geometry: unknown; properties: { ward?: number } }>): number | null {
  const hit = wards.find((w) => pointInArea(lng, lat, w.geometry as Geometry));
  return hit?.properties.ward ?? null;
}

/** The middle of the largest outer ring (the mean of its corners), as [lng, lat]. */
export function areaMiddle(g: Geometry | null | undefined): [number, number] | null {
  const rings = polygons(g).map((p) => p[0]).filter((r): r is Ring => Array.isArray(r) && r.length > 2);
  if (!rings.length) return null;
  const ring = rings.reduce((a, b) => (b.length > a.length ? b : a));
  const n = ring.length;
  return [ring.reduce((s, p) => s + (p[0] ?? 0), 0) / n, ring.reduce((s, p) => s + (p[1] ?? 0), 0) / n];
}

/** The outer rings of an area as [lat, lng] lists, for a small map (ShapesMap). */
export function areaRings(g: Geometry | null | undefined): Array<Array<[number, number]>> {
  return polygons(g).map((p) => (p[0] ?? []).map((c) => [c[1] ?? 0, c[0] ?? 0] as [number, number])).filter((r) => r.length > 2);
}
