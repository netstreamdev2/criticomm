import { requireAuth, unconfigured, relayJson } from '@/lib/external';

/**
 * CamerasController.GetEmergencyPOIs — TomTom nearby search.
 * Category set 7321,7322,7392 = hospitals / emergency rooms / police stations (V4 values).
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { deny } = await requireAuth('external');
  if (deny) return deny;

  const key = process.env.TOMTOM_API_KEY;
  if (!key) return unconfigured('TomTom POI', 'TOMTOM_API_KEY');

  const sp = new URL(req.url).searchParams;
  const lat = sp.get('lat') ?? '-29.8587';
  const lon = sp.get('lon') ?? '31.0218';
  const radius = sp.get('radius') ?? '10000';

  const url =
    `https://api.tomtom.com/search/2/nearbySearch/.json?key=${key}` +
    `&lat=${lat}&lon=${lon}&radius=${radius}&categorySet=7321,7322,7392&limit=100`;
  return relayJson(url);
}
