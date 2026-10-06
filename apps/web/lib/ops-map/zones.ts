import type { MapZoneKind, MapZoneShape, MapZoneVisibility, Silo } from '@criticom/db';
import { ZONE_KINDS, zoneKind, type ZoneKindDef } from '@criticom/db/map-layers';

// The zone types and their colours are shared with the officer app.
export { ZONE_KINDS, zoneKind, type ZoneKindDef } from '@criticom/db/map-layers';

/**
 * Perimeters and zones on the live map: their types, who they are shared
 * with, and the geometry behind drawing them precisely. Pure — the drawing
 * tool, the save form and the cards all lean on it, and zones.test.ts pins it.
 * The checks mirror save_map_zone() (migration 0053) so a mistake is caught
 * on screen, before the database refuses it.
 */

export type LatLng = { lat: number; lng: number };

/* ── Zone types ─────────────────────────────────────────────────────── */

export function kindsForShape(shape: MapZoneShape): ZoneKindDef[] {
  return ZONE_KINDS.filter((k) => k.shapes.includes(shape));
}

export const SHAPE_LABEL: Record<MapZoneShape, string> = {
  polygon: 'Area', circle: 'Circle', line: 'Line', point: 'Point',
};

/* ── Who sees it ────────────────────────────────────────────────────── */

export const VISIBILITY: ReadonlyArray<{ key: MapZoneVisibility; label: string; hint: string }> = [
  { key: 'private', label: 'Only me', hint: 'A working draft. Nobody else sees it until you share it.' },
  { key: 'department', label: 'My department', hint: 'Your department, and the control room.' },
  { key: 'departments', label: 'Chosen departments', hint: 'Your department, the ones you tick, and the control room.' },
  { key: 'incident', label: 'Everyone on the call', hint: 'Every department the linked call is routed to, and the control room.' },
  { key: 'everyone', label: 'Everyone', hint: 'The whole organisation.' },
];

/** Departments a zone can be shared with, in the order people think of them. */
export const SHARE_SILOS: readonly Silo[] = ['Ethekwini', 'MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster'];

/** Who a zone reaches, in a sentence. `deptName` turns a silo into its department name. */
export function describeAudience(
  zone: { visibility: MapZoneVisibility; silo: Silo; shared_silos: readonly Silo[] },
  deptName: (silo: Silo) => string,
  incidentNumber?: string | null,
): string {
  switch (zone.visibility) {
    case 'private':
      return 'Only the person who set it';
    case 'department':
    case 'departments': {
      // The control room (the Ethekwini silo) always sees shared zones; name it once, last.
      const silos = zone.visibility === 'department' ? [zone.silo] : [zone.silo, ...zone.shared_silos];
      const names = [...new Set(silos)].filter((s) => s !== 'Ethekwini').map(deptName);
      return names.length ? `${names.join(', ')} and the control room` : 'The control room';
    }
    case 'incident':
      return `Everyone on ${incidentNumber ?? 'the linked call'}`;
    default:
      return 'Everyone';
  }
}

const ROLE_WORDS: Record<string, string> = {
  IncidentLogger: 'Call-taker', ControlRoom: 'Control room', SystemController: 'System controller',
  SystemAdmin: 'System administrator', SuperAdmin: 'Platform owner', FireChief: 'Fire Chief',
  Disaster: 'Disaster officer', Admin: 'Administrator',
};

/** A role as people say it: "FireChief" → "Fire Chief". */
export function roleWords(role: string | null | undefined): string {
  if (!role) return '';
  return ROLE_WORDS[role] ?? role.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/* ── How long it stands ─────────────────────────────────────────────── */

export const END_OPTIONS = [
  { key: 'none', label: 'Until stood down', hours: null },
  { key: '1h', label: '1 hour', hours: 1 },
  { key: '2h', label: '2 hours', hours: 2 },
  { key: '4h', label: '4 hours', hours: 4 },
  { key: '8h', label: '8 hours', hours: 8 },
  { key: '12h', label: '12 hours', hours: 12 },
  { key: '24h', label: '24 hours', hours: 24 },
  { key: 'custom', label: 'Until a set time…', hours: null },
] as const;
export type EndOption = (typeof END_OPTIONS)[number]['key'];

export const MAX_ACTIVE_DAYS = 30;

/* ── Geometry ───────────────────────────────────────────────────────── */

/** WGS84 semi-major axis, as Leaflet and PostGIS's sphere approximations use. */
const R = 6378137;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function pathLengthM(points: readonly LatLng[], closed = false): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distanceM(points[i - 1]!, points[i]!);
  if (closed && points.length > 2) total += distanceM(points[points.length - 1]!, points[0]!);
  return total;
}

/** Area enclosed by a ring on the sphere, in m² (the formula Leaflet.draw uses). */
export function ringAreaM2(points: readonly LatLng[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i]!;
    const p2 = points[(i + 1) % points.length]!;
    sum += rad(p2.lng - p1.lng) * (2 + Math.sin(rad(p1.lat)) + Math.sin(rad(p2.lat)));
  }
  return Math.abs((sum * R * R) / 2);
}

export const circleAreaM2 = (radiusM: number) => Math.PI * radiusM * radiusM;

/** Whether any two non-neighbouring edges of a closed ring cross. */
export function ringSelfIntersects(points: readonly LatLng[]): boolean {
  const n = points.length;
  if (n < 4) return false;
  const edge = (i: number) => [points[i]!, points[(i + 1) % n]!] as const;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Neighbours share a point; the first and last edges are neighbours too.
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      const [a, b] = edge(i);
      const [c, d] = edge(j);
      if (segmentsCross(a, b, c, d)) return true;
    }
  }
  return false;
}

function orient(a: LatLng, b: LatLng, c: LatLng) {
  const v = (b.lng - a.lng) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lng - a.lng);
  return Math.abs(v) < 1e-14 ? 0 : Math.sign(v);
}

function onSegment(a: LatLng, b: LatLng, p: LatLng) {
  return Math.min(a.lng, b.lng) <= p.lng && p.lng <= Math.max(a.lng, b.lng)
    && Math.min(a.lat, b.lat) <= p.lat && p.lat <= Math.max(a.lat, b.lat);
}

function segmentsCross(a: LatLng, b: LatLng, c: LatLng, d: LatLng) {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  return (o1 === 0 && onSegment(a, b, c)) || (o2 === 0 && onSegment(a, b, d))
    || (o3 === 0 && onSegment(c, d, a)) || (o4 === 0 && onSegment(c, d, b));
}

/** Drop a point that repeats the one before it (a double-click lands twice). */
export function dedupePoints(points: readonly LatLng[], toleranceM = 0.05): LatLng[] {
  const out: LatLng[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || distanceM(last, p) > toleranceM) out.push(p);
  }
  if (out.length > 2 && distanceM(out[0]!, out[out.length - 1]!) <= toleranceM) out.pop();
  return out;
}

/* ── Formatting ─────────────────────────────────────────────────────── */

export function formatDistance(m: number): string {
  if (!Number.isFinite(m)) return '—';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 2 : 1)} km`;
}

export function formatArea(m2: number): string {
  if (!Number.isFinite(m2)) return '—';
  if (m2 < 10_000) return `${Math.round(m2).toLocaleString('en-ZA')} m²`;
  if (m2 < 1_000_000) return `${(m2 / 10_000).toFixed(2)} ha`;
  return `${(m2 / 1_000_000).toFixed(2)} km²`;
}

export const formatCoord = (p: LatLng) => `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;

/* ── A drawn shape ──────────────────────────────────────────────────── */

export type ZoneShapeDraft = {
  shape: MapZoneShape;
  /** Area corners or line points; for a circle or point, its one position. */
  points: LatLng[];
  radiusM: number | null;
};

export function measureShape(d: ZoneShapeDraft): { areaM2: number | null; lengthM: number | null } {
  switch (d.shape) {
    case 'polygon':
      return { areaM2: ringAreaM2(d.points), lengthM: pathLengthM(d.points, true) };
    case 'circle':
      return d.radiusM ? { areaM2: circleAreaM2(d.radiusM), lengthM: 2 * Math.PI * d.radiusM } : { areaM2: null, lengthM: null };
    case 'line':
      return { areaM2: null, lengthM: pathLengthM(d.points) };
    default:
      return { areaM2: null, lengthM: null };
  }
}

/** The measurements in words, as the drawing chip and the cards show them. */
export function describeShape(d: ZoneShapeDraft, measured?: { areaM2: number | null; lengthM: number | null }): string {
  const m = measured ?? measureShape(d);
  switch (d.shape) {
    case 'polygon':
      return `Area ${formatArea(m.areaM2 ?? 0)} · perimeter ${formatDistance(m.lengthM ?? 0)} · ${d.points.length} points`;
    case 'circle':
      return d.radiusM
        ? `Radius ${formatDistance(d.radiusM)} · area ${formatArea(m.areaM2 ?? 0)}`
        : 'Radius not set';
    case 'line':
      return `Length ${formatDistance(m.lengthM ?? 0)} · ${d.points.length} points`;
    default:
      return d.points[0] ? formatCoord(d.points[0]) : 'Not placed';
  }
}

/** Seven decimals is about a centimetre: precise, without floating-point noise in storage. */
const fix = (n: number) => Math.round(n * 1e7) / 1e7;
const pos = (p: LatLng) => [fix(p.lng), fix(p.lat)];

export type ZoneGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'LineString'; coordinates: number[][] }
  | { type: 'Point'; coordinates: number[] };

/** GeoJSON for the database (longitude first), the ring closed. */
export function toGeometry(d: ZoneShapeDraft): ZoneGeometry {
  if (d.shape === 'polygon') {
    const ring = d.points.map(pos);
    return { type: 'Polygon', coordinates: [[...ring, ring[0]!]] };
  }
  if (d.shape === 'line') return { type: 'LineString', coordinates: d.points.map(pos) };
  return { type: 'Point', coordinates: pos(d.points[0]!) };
}

/** A saved zone's GeoJSON back to the points the map draws (the ring left open). */
export function fromGeometry(shape: MapZoneShape, geometry: { type: string; coordinates: unknown }): LatLng[] {
  const toLatLng = (c: unknown): LatLng | null => {
    if (!Array.isArray(c) || c.length < 2) return null;
    const [lng, lat] = c.map(Number);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat: lat!, lng: lng! } : null;
  };
  const keep = (list: unknown[]) => list.map(toLatLng).filter((p): p is LatLng => p !== null);
  if (shape === 'polygon' && geometry.type === 'Polygon' && Array.isArray(geometry.coordinates)) {
    const ring = keep((geometry.coordinates[0] as unknown[]) ?? []);
    if (ring.length > 1 && distanceM(ring[0]!, ring[ring.length - 1]!) < 0.01) ring.pop();
    return ring;
  }
  if (shape === 'line' && geometry.type === 'LineString' && Array.isArray(geometry.coordinates)) {
    return keep(geometry.coordinates);
  }
  const p = geometry.type === 'Point' ? toLatLng(geometry.coordinates) : null;
  return p ? [p] : [];
}

/** The middle of a shape, for its label and for flying to it. */
export function shapeCentre(d: ZoneShapeDraft): LatLng | null {
  if (!d.points.length) return null;
  if (d.shape === 'circle' || d.shape === 'point') return d.points[0]!;
  const lat = d.points.reduce((s, p) => s + p.lat, 0) / d.points.length;
  const lng = d.points.reduce((s, p) => s + p.lng, 0) / d.points.length;
  return { lat, lng };
}

/* ── Checks before saving (mirror save_map_zone) ────────────────────── */

export type ZoneDraft = ZoneShapeDraft & {
  kind: MapZoneKind;
  name: string;
  reason: string;
  incidentId: string | null;
  visibility: MapZoneVisibility;
  sharedSilos: Silo[];
  activeUntil: string | null;
};

const validLatLng = (p: LatLng) =>
  Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

/** What is wrong with the shape alone, or null. */
export function shapeProblem(d: ZoneShapeDraft): string | null {
  if (!d.points.every(validLatLng)) return 'A point is off the map.';
  switch (d.shape) {
    case 'polygon': {
      const pts = dedupePoints(d.points);
      if (pts.length < 3) return 'An area needs at least three points.';
      if (pts.length > 500) return 'An area can have at most 500 points.';
      if (ringSelfIntersects(pts)) return 'The area’s edges cross each other — move the points so they do not.';
      return null;
    }
    case 'line': {
      const pts = dedupePoints(d.points);
      if (pts.length < 2) return 'A line needs at least two points.';
      if (pts.length > 500) return 'A line can have at most 500 points.';
      return null;
    }
    case 'circle':
      if (d.points.length !== 1) return 'Place the circle’s centre.';
      if (d.radiusM == null || !Number.isFinite(d.radiusM) || d.radiusM < 1 || d.radiusM > 50_000) {
        return 'A circle’s radius must be between 1 m and 50 km.';
      }
      return null;
    default:
      return d.points.length === 1 ? null : 'Place the point.';
  }
}

/** What stops this zone being saved, or null. `now` is for the end-time check. */
export function zoneProblem(d: ZoneDraft, now = Date.now()): string | null {
  const shape = shapeProblem(d);
  if (shape) return shape;
  if (!zoneKind(d.kind).shapes.includes(d.shape)) {
    return `A ${zoneKind(d.kind).label.toLowerCase()} cannot be drawn as a ${SHAPE_LABEL[d.shape].toLowerCase()}.`;
  }
  const name = d.name.trim();
  if (!name) return 'Give the zone a name.';
  if (name.length > 120) return 'Keep the name under 120 characters.';
  if (d.visibility !== 'private' && d.reason.trim().length < 3) {
    return 'Say why this zone is being set — the people who receive it will see the reason.';
  }
  if (d.reason.length > 1000) return 'Keep the reason under 1,000 characters.';
  if (d.visibility === 'departments' && d.sharedSilos.length === 0) return 'Tick at least one department to share with.';
  if (d.visibility === 'incident' && !d.incidentId) return 'Choose the call whose crews should see this.';
  if (d.activeUntil) {
    const t = new Date(d.activeUntil).getTime();
    if (!Number.isFinite(t) || t <= now) return 'The end time must be in the future.';
    if (t > now + MAX_ACTIVE_DAYS * 86_400_000) return `The end time must be within ${MAX_ACTIVE_DAYS} days.`;
  }
  return null;
}
