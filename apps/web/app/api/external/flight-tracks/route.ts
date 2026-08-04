import { NextResponse } from 'next/server';
import { requireAuth, unconfigured, relayJson } from '@/lib/external';

/** CamerasController.GetFlightTracks — historical track for one flight. */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { deny } = await requireAuth('external');
  if (deny) return deny;

  const key = process.env.FLIGHTRADAR_API_KEY;
  if (!key) return unconfigured('FlightRadar24', 'FLIGHTRADAR_API_KEY');

  const flightId = new URL(req.url).searchParams.get('flightId');
  if (!flightId) return NextResponse.json({ error: 'flightId required' }, { status: 400 });

  return relayJson(
    `https://fr24api.flightradar24.com/api/flight-tracks?flight_id=${encodeURIComponent(flightId)}`,
    { Authorization: `Bearer ${key}`, 'Accept-Version': 'v1', Accept: 'application/json' },
  );
}
