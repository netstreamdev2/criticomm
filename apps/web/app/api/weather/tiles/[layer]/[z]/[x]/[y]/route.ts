import { NextResponse } from 'next/server';
import { isWeatherLayer, OWM_TILE_LAYER } from '@/lib/ops-map/layers';
import { weatherPassKey, weatherPassValid } from '@/lib/weather-pass';

/**
 * OpenWeather map tiles for the live map's weather layers (rain, cloud,
 * temperature, wind). V4 put the key in the page; here it stays server-side.
 *
 * Authentication is the middleware's: it runs getUser() on every /api path
 * and answers 401 without a session. The officer app's map cannot send its
 * sign-in with an image, so it adds a signed `?pass=` (app/api/weather/pass);
 * the middleware lets such requests through and this route checks the pass. The URL deliberately has no ".png" —
 * the middleware matcher skips static extensions, which would let tiles out
 * unauthenticated. No per-user rate limit either: a single pan asks for
 * dozens of tiles, and the data cache below collapses repeats across users.
 */
export const dynamic = 'force-dynamic';

/** 1×1 transparent PNG: an unconfigured or failed tile shows nothing, never a broken image. */
const BLANK = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

function png(body: ArrayBuffer | Buffer, maxAge: number) {
  return new NextResponse(new Uint8Array(body), {
    status: 200,
    headers: { 'Content-Type': 'image/png', 'Cache-Control': `private, max-age=${maxAge}` },
  });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ layer: string; z: string; x: string; y: string }> },
) {
  const pass = new URL(req.url).searchParams.get('pass');
  if (pass !== null && !weatherPassValid(pass, weatherPassKey())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { layer, z, x, y } = await params;
  if (!isWeatherLayer(layer)) return NextResponse.json({ error: 'Unknown layer' }, { status: 404 });

  const int = (v: string) => (/^\d{1,7}$/.test(v) ? Number(v) : -1);
  const [zi, xi, yi] = [int(z), int(x), int(y)];
  if (zi < 0 || zi > 18 || xi < 0 || yi < 0 || xi >= 2 ** zi || yi >= 2 ** zi) {
    return NextResponse.json({ error: 'Bad tile' }, { status: 400 });
  }

  const key = process.env.OPENWEATHER_API_KEY;
  if (!key) return png(BLANK, 60);

  try {
    const res = await fetch(
      `https://tile.openweathermap.org/map/${OWM_TILE_LAYER[layer]}/${zi}/${xi}/${yi}.png?appid=${key}`,
      // Weather moves slowly; ten minutes of reuse keeps a wall display inside the free quota.
      { next: { revalidate: 600 } },
    );
    if (!res.ok) return png(BLANK, 60);
    return png(await res.arrayBuffer(), 600);
  } catch {
    return png(BLANK, 30);
  }
}
