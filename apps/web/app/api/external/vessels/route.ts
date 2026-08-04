import { requireAuth, unconfigured, relayJson } from '@/lib/external';

/** CamerasController.GetLiveMarineData — Kpler AIS vessel positions in a bbox. */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { deny } = await requireAuth('external');
  if (deny) return deny;

  const key = process.env.MARINESIA_API_KEY;
  if (!key) return unconfigured('Marine AIS (Kpler)', 'MARINESIA_API_KEY');

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
