import { NextResponse } from 'next/server';
import { listCouncillors, listLiveWarnings } from '@criticom/api';
import { isCatalogueId } from '@/lib/ops-map/catalogue';
import { overlayFeatures, type Collection, type Feature } from '@/lib/maps/sources';
import { getServerSupabase } from '@/lib/supabase';

/**
 * A map overlay's features, coloured and worded (lib/ops-map/catalogue.ts).
 * Outside sources are fetched and kept on the server (lib/maps/sources.ts);
 * the weather warning areas come from our own records, read with the
 * viewer's own sign-in. Ward outlines get their councillor's name for those
 * who may see the councillors' list (the Disaster desk and command).
 * Signed-in users only (the middleware checks every /api path).
 */
export const dynamic = 'force-dynamic';

const answer = (data: Collection, maxAge: number) =>
  NextResponse.json(data, { headers: { 'Cache-Control': `private, max-age=${maxAge}` } });

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isCatalogueId(id)) return NextResponse.json({ error: 'No such layer.' }, { status: 404 });
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });

  if (id === 'saws-areas') {
    const warnings = await listLiveWarnings(supabase);
    const features: Feature[] = warnings.flatMap((w) => (w.area_shapes ?? []).map((ring) => ({
      type: 'Feature' as const,
      // SAWS draws [lat, lng]; GeoJSON wants [lng, lat], closed.
      geometry: { type: 'Polygon', coordinates: [[...ring.map(([lat, lng]) => [lng, lat]), [ring[0]![1], ring[0]![0]]]] },
      properties: {
        title: `${w.colour} Level ${w.level}: ${w.hazard}`,
        colour: w.colour === 'Red' ? '#dc2626' : w.colour === 'Orange' ? '#f97316' : '#facc15',
        lines: [`Until ${new Date(w.valid_until).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', weekday: 'short', hour: '2-digit', minute: '2-digit' })}`],
        url: `/disaster/warnings/${w.id}`,
      },
    })));
    return answer({ type: 'FeatureCollection', features, ...(features.length ? {} : { note: 'No weather warning for eThekwini now.' }) }, 60);
  }

  try {
    const data = await overlayFeatures(id);
    if (!data) return NextResponse.json({ error: 'No such layer.' }, { status: 404 });
    if (id !== 'wards') return answer(data, 300);
    const byWard = new Map((await listCouncillors(supabase)).filter((c) => c.is_active && c.ward != null).map((c) => [c.ward!, c]));
    return answer({
      ...data,
      features: data.features.map((f) => {
        const c = f.properties.ward != null ? byWard.get(f.properties.ward) : undefined;
        return c ? { ...f, properties: { ...f.properties, lines: [`Councillor ${c.name}${c.phone ? `, ${c.phone}` : ''}`] } } : f;
      }),
    }, 300);
  } catch {
    return NextResponse.json({ error: 'The source did not answer. Try again in a few minutes.' }, { status: 502 });
  }
}
