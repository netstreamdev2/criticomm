import type * as Leaflet from 'leaflet';
import { escapeHtml } from '@/lib/utils';

/**
 * Aircraft (FlightRadar24), ships (marine AIS) and shelters on the
 * operations map (0113), and the rain radar (RainViewer). The feeds are read
 * through the console's own proxies; each answer is checked field by field,
 * so a changed feed shows nothing rather than something wrong.
 */

export type Aircraft = { id: string; lat: number; lng: number; heading: number; callsign: string; altitudeFt: number | null; speedKt: number | null; route: string | null; type: string | null };
export type Vessel = { id: string; lat: number; lng: number; heading: number | null; name: string; kind: string | null; speedKn: number | null; destination: string | null };
export type MapShelter = { id: string; name: string; lat: number; lng: number; capacity: number; people: number };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const placed = (lat: number | null, lng: number | null): lat is number => lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

/** FlightRadar24 live flight positions ("full"): `{ data: [{ fr24_id, callsign, lat, lon, track, alt, gspeed, type, orig_iata, dest_iata }] }`. */
export function parseAircraft(json: unknown): Aircraft[] {
  const rows = (json as { data?: unknown })?.data;
  if (!Array.isArray(rows)) return [];
  const out: Aircraft[] = [];
  for (const r of rows as Array<Record<string, unknown>>) {
    const lat = num(r.lat); const lng = num(r.lon);
    if (!placed(lat, lng)) continue;
    const from = str(r.orig_iata); const to = str(r.dest_iata);
    out.push({
      id: str(r.fr24_id) ?? `${lat},${lng}`, lat, lng: lng!, heading: num(r.track) ?? 0,
      callsign: str(r.callsign) ?? str(r.flight) ?? 'Aircraft', altitudeFt: num(r.alt), speedKt: num(r.gspeed),
      route: from || to ? `${from ?? '?'} to ${to ?? '?'}` : null, type: str(r.type),
    });
  }
  return out;
}

/** Marine AIS latest positions: a list (or `{ data | items | vessels }`) of vessels with a position. */
export function parseVessels(json: unknown): Vessel[] {
  const j = json as Record<string, unknown> | unknown[];
  const rows = Array.isArray(j) ? j : (j?.data ?? j?.items ?? j?.vessels ?? j?.results);
  if (!Array.isArray(rows)) return [];
  const out: Vessel[] = [];
  for (const r of rows as Array<Record<string, unknown>>) {
    const pos = (r.position ?? r.lastPosition ?? r.location ?? {}) as Record<string, unknown>;
    const lat = num(pos.lat ?? pos.latitude ?? r.lat ?? r.latitude);
    const lng = num(pos.lon ?? pos.lng ?? pos.longitude ?? r.lon ?? r.lng ?? r.longitude);
    if (!placed(lat, lng)) continue;
    const id = str(r.mmsi) ?? str(r.imo) ?? (num(r.mmsi) !== null ? String(r.mmsi) : `${lat},${lng}`);
    out.push({
      id, lat, lng: lng!, heading: num(pos.heading ?? pos.course ?? r.heading ?? r.course),
      name: str(r.vesselName) ?? str(r.name) ?? str(r.shipName) ?? `MMSI ${id}`, kind: str(r.vesselType) ?? str(r.type) ?? str(r.shipType),
      speedKn: num(pos.speed ?? pos.sog ?? r.speed ?? r.sog), destination: str(r.destination) ?? str(pos.destination),
    });
  }
  return out;
}

const svgIcon = (L: typeof Leaflet, path: string, colour: string, deg: number, size = 22) => L.divIcon({
  className: '',
  iconSize: [size, size],
  iconAnchor: [size / 2, size / 2],
  html: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" style="transform:rotate(${Math.round(deg)}deg);filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))"><path d="${path}" fill="${colour}" stroke="#0b1220" stroke-width="1"/></svg>`,
});
const PLANE = 'M12 2c.6 0 1 .5 1 1.2V9l8 4.5v2l-8-2.4v5l2.2 1.6V21L12 20.2 8.8 21v-1.3L11 18.1v-5l-8 2.4v-2L11 9V3.2C11 2.5 11.4 2 12 2z';
const SHIP = 'M12 2l4 7v9l-4 4-4-4V9z';

export const aircraftIcon = (L: typeof Leaflet, a: Aircraft) => svgIcon(L, PLANE, '#facc15', a.heading);
export const vesselIcon = (L: typeof Leaflet, v: Vessel) => svgIcon(L, SHIP, '#38bdf8', v.heading ?? 0, 18);
export const shelterIcon = (L: typeof Leaflet, s: MapShelter) => {
  const full = s.capacity > 0 && s.people >= s.capacity;
  return L.divIcon({
    className: '',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    html: `<div style="width:26px;height:26px;border-radius:6px;display:grid;place-items:center;background:${full ? '#dc2626' : '#16a34a'};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5);color:#fff;font:700 11px system-ui">H</div>`,
  });
};

export const aircraftTooltip = (a: Aircraft) => `<strong>${escapeHtml(a.callsign)}</strong>${a.type ? ` · ${escapeHtml(a.type)}` : ''}<br/>`
  + `${a.altitudeFt !== null ? `${Math.round(a.altitudeFt).toLocaleString('en-ZA')} ft` : ''}${a.speedKt !== null ? ` · ${Math.round(a.speedKt)} kt` : ''}`
  + `${a.route ? `<br/>${escapeHtml(a.route)}` : ''}`;
export const vesselTooltip = (v: Vessel) => `<strong>${escapeHtml(v.name)}</strong>${v.kind ? ` · ${escapeHtml(v.kind)}` : ''}`
  + `${v.speedKn !== null ? `<br/>${v.speedKn.toFixed(1)} knots` : ''}${v.destination ? `<br/>To ${escapeHtml(v.destination)}` : ''}`;
export const shelterTooltip = (s: MapShelter) => `<strong>${escapeHtml(s.name)}</strong><br/>`
  + (s.capacity > 0 ? `${s.people} in · ${Math.max(0, s.capacity - s.people)} places free of ${s.capacity}` : `${s.people} in`);

/** The latest RainViewer radar frame, as a tile URL; null when it cannot be read. */
export async function radarTileUrl(): Promise<string | null> {
  try {
    const res = await fetch('https://api.rainviewer.com/public/weather-maps.json', { cache: 'no-store' });
    const j = (await res.json()) as { host?: string; radar?: { past?: Array<{ path?: string }> } };
    const last = j.radar?.past?.at(-1)?.path;
    return j.host && last ? `${j.host}${last}/256/{z}/{x}/{y}/2/1_1.png` : null;
  } catch {
    return null;
  }
}
