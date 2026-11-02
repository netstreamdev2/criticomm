import { NextResponse } from 'next/server';
import { requireAuth, relayJson } from '@/lib/external';

/**
 * Aircraft for the operations map. FlightRadar24 (FLIGHTRADAR_API_KEY, paid)
 * when it is set, as V4's CamerasController.GetLiveFlightData. Otherwise the
 * free open data of adsb.lol (ODbL: shared freely, named on the map), which
 * sees only what volunteers' receivers pick up: thin around Durban until one
 * is put up there.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { deny } = await requireAuth('external');
  if (deny) return deny;

  const sp = new URL(req.url).searchParams;
  // Durban approach corridor defaults
  const lamin = sp.get('lamin') ?? '-30.2';
  const lomin = sp.get('lomin') ?? '30.5';
  const lamax = sp.get('lamax') ?? '-29.4';
  const lomax = sp.get('lomax') ?? '31.5';

  const key = process.env.FLIGHTRADAR_API_KEY;
  if (key) {
    // FR24 bounds order: North,South,West,East (as in V4)
    const bounds = `${lamax},${lamin},${lomin},${lomax}`;
    return relayJson(
      `https://fr24api.flightradar24.com/api/live/flight-positions/full?bounds=${bounds}`,
      { Authorization: `Bearer ${key}`, 'Accept-Version': 'v1', Accept: 'application/json' },
    );
  }

  // adsb.lol: aircraft within a radius (nautical miles) of the middle of the box, put in FR24's shape.
  const lat = (Number(lamin) + Number(lamax)) / 2;
  const lng = (Number(lomin) + Number(lomax)) / 2;
  if (![lat, lng].every(Number.isFinite)) return NextResponse.json({ error: 'Bad box' }, { status: 400 });
  try {
    const res = await fetch(`https://api.adsb.lol/v2/point/${lat.toFixed(3)}/${lng.toFixed(3)}/60`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
      // Say who is asking: open feeds may turn away nameless calls from cloud hosts.
      headers: { 'User-Agent': 'Criticomm operations map (eThekwini)', Accept: 'application/json' },
    });
    if (!res.ok) {
      console.error(`[flights] adsb.lol answered ${res.status}`);
      return NextResponse.json({ error: `Upstream ${res.status}` }, { status: 502 });
    }
    const j = (await res.json()) as { ac?: Array<Record<string, unknown>> };
    const data = (j.ac ?? []).map((a) => ({
      fr24_id: a.hex, callsign: typeof a.flight === 'string' ? a.flight.trim() : null, lat: a.lat, lon: a.lon, track: a.track ?? a.true_heading,
      alt: typeof a.alt_baro === 'number' ? a.alt_baro : 0, gspeed: a.gs, type: a.t,
    }));
    return NextResponse.json({ data, source: 'adsb.lol (ODbL)' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[flights] adsb.lol could not be reached:', (e as Error).message);
    return NextResponse.json({ error: 'The aircraft feed could not be reached.' }, { status: 502 });
  }
}
