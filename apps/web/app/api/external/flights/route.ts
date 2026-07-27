import { requireAuth, unconfigured, relayJson } from '@/lib/external';

/** CamerasController.GetLiveFlightData — FlightRadar24 live positions in bounds. */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { deny } = await requireAuth();
  if (deny) return deny;

  const key = process.env.FLIGHTRADAR_API_KEY;
  if (!key) return unconfigured('FlightRadar24', 'FLIGHTRADAR_API_KEY');

  const sp = new URL(req.url).searchParams;
  // Durban approach corridor defaults
  const lamin = sp.get('lamin') ?? '-30.2';
  const lomin = sp.get('lomin') ?? '30.5';
  const lamax = sp.get('lamax') ?? '-29.4';
  const lomax = sp.get('lomax') ?? '31.5';
  // FR24 bounds order: North,South,West,East (as in V4)
  const bounds = `${lamax},${lamin},${lomin},${lomax}`;

  return relayJson(
    `https://fr24api.flightradar24.com/api/live/flight-positions/full?bounds=${bounds}`,
    { Authorization: `Bearer ${key}`, 'Accept-Version': 'v1', Accept: 'application/json' },
  );
}
