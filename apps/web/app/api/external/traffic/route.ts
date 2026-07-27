import { requireAuth, unconfigured, relayJson } from '@/lib/external';

/** CamerasController.GetTrafficIncidents — TomTom traffic incidents in a bbox. */
export const dynamic = 'force-dynamic';

// Same field projection V4 requested.
const FIELDS = '{incidents{geometry{type,coordinates},properties{iconCategory,events{description}}}}';
// Durban metro default bbox (minLon,minLat,maxLon,maxLat)
const DEFAULT_BBOX = '30.7,-30.1,31.2,-29.6';

export async function GET(req: Request) {
  const { deny } = await requireAuth();
  if (deny) return deny;

  const key = process.env.TOMTOM_API_KEY;
  if (!key) return unconfigured('TomTom traffic', 'TOMTOM_API_KEY');

  const bbox = new URL(req.url).searchParams.get('bbox') ?? DEFAULT_BBOX;
  const url =
    `https://api.tomtom.com/traffic/services/5/incidentDetails?key=${key}&bbox=${bbox}` +
    `&fields=${encodeURIComponent(FIELDS)}&language=en-GB&timeValidityFilter=present`;
  return relayJson(url);
}
