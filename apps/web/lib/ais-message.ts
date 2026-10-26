/** Reading aisstream.io's messages into ships (lib/ais). No server needed, so it can be tested. */

export type AisShip = {
  mmsi: string; name: string | null; lat: number; lon: number; heading: number | null; speed: number | null;
  destination: string | null; type: string | null; seen: number;
};

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().replace(/@+$/, '').trim() || null : null);

/** AIS ship types (ITU-R M.1371) in words. */
export function shipKind(code: number | null): string | null {
  if (code === null) return null;
  if (code === 30) return 'Fishing';
  if (code === 31 || code === 32 || code === 52) return 'Tug';
  if (code === 33) return 'Dredger';
  if (code === 35) return 'Military';
  if (code === 36) return 'Sailing';
  if (code === 37) return 'Pleasure craft';
  if (code === 50) return 'Pilot';
  if (code === 51) return 'Search and rescue';
  if (code === 53) return 'Port tender';
  if (code === 55) return 'Law enforcement';
  if (code === 58) return 'Medical transport';
  if (code >= 60 && code <= 69) return 'Passenger';
  if (code >= 70 && code <= 79) return 'Cargo';
  if (code >= 80 && code <= 89) return 'Tanker';
  return null;
}

/** One message from the stream into the ship it is about. */
export function takeAisMessage(m: Record<string, unknown>, ships: Map<string, AisShip>, now = Date.now()) {
  const meta = (m.MetaData ?? {}) as Record<string, unknown>;
  const mmsi = meta.MMSI != null ? String(meta.MMSI) : null;
  if (!mmsi) return;
  const body = ((m.Message ?? {}) as Record<string, Record<string, unknown>>)[String(m.MessageType)] ?? {};
  const was = ships.get(mmsi);
  // A position report says where exactly; any other message keeps the last known place.
  const lat = num(body.Latitude) ?? was?.lat ?? num(meta.latitude) ?? null;
  const lon = num(body.Longitude) ?? was?.lon ?? num(meta.longitude) ?? null;
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
  const heading = num(body.TrueHeading);
  const cog = num(body.Cog);
  ships.set(mmsi, {
    mmsi, lat, lon,
    name: text(body.Name) ?? text(meta.ShipName) ?? was?.name ?? null,
    // 511 is "not available"; then the course over the ground.
    heading: heading !== null && heading < 360 ? heading : cog !== null && cog < 360 ? cog : was?.heading ?? null,
    speed: num(body.Sog) !== null && num(body.Sog)! < 102.3 ? num(body.Sog) : was?.speed ?? null,
    destination: text(body.Destination) ?? was?.destination ?? null,
    type: shipKind(num(body.Type)) ?? was?.type ?? null,
    seen: m.MessageType === 'ShipStaticData' && was ? was.seen : now,
  });
}
