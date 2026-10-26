import { NextResponse } from 'next/server';
import { requireAuth, unconfigured, relayJson } from '@/lib/external';
import { aisShips } from '@/lib/ais';

/**
 * Ships for the operations map. aisstream.io (AISSTREAM_API_KEY, free) when it
 * is set: the ships' own AIS reports around Durban, kept by the console
 * (lib/ais). Otherwise V4's Kpler AIS positions in a box (MARINESIA_API_KEY).
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { deny } = await requireAuth('external');
  if (deny) return deny;

  const stream = process.env.AISSTREAM_API_KEY;
  if (stream) {
    const { ships, error, warming } = await aisShips(stream);
    if (error && ships.length === 0) return NextResponse.json({ error }, { status: 502 });
    return NextResponse.json({ vessels: ships, warming }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const key = process.env.MARINESIA_API_KEY;
  if (!key) return unconfigured('Marine AIS', 'AISSTREAM_API_KEY');

  const sp = new URL(req.url).searchParams;
  // Durban port + anchorage defaults
  const lamin = sp.get('lamin') ?? '-30.05';
  const lomin = sp.get('lomin') ?? '30.9';
  const lamax = sp.get('lamax') ?? '-29.7';
  const lomax = sp.get('lomax') ?? '31.3';

  // Kpler bbox filter order: (position, lomin, lamin, lomax, lamax) — as in V4
  return relayJson(
    `https://api.kpler.com/v2/maritime/ais-latest?filter=bbox(position,${lomin},${lamin},${lomax},${lamax})`,
    { Authorization: `Bearer ${key}`, Accept: 'application/json' },
  );
}
