import { NextResponse } from 'next/server';

/**
 * Rain radar tiles for the live map (0113): RainViewer's latest radar frame
 * (measured rain, not a forecast), served through the console so the page
 * needs no outside address. Signed-in users only (the middleware checks every
 * /api path). The latest frame is looked up at most every five minutes.
 */
export const dynamic = 'force-dynamic';

const BLANK = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const png = (body: ArrayBuffer | Buffer, maxAge: number) => new NextResponse(new Uint8Array(body), {
  status: 200, headers: { 'Content-Type': 'image/png', 'Cache-Control': `private, max-age=${maxAge}` },
});

let frame: { url: string; at: number } | null = null;

async function latestFrame(): Promise<string | null> {
  if (frame && Date.now() - frame.at < 5 * 60_000) return frame.url;
  try {
    const res = await fetch('https://api.rainviewer.com/public/weather-maps.json', { cache: 'no-store', signal: AbortSignal.timeout(6000) });
    const j = (await res.json()) as { host?: string; radar?: { past?: Array<{ path?: string }> } };
    const path = j.radar?.past?.at(-1)?.path;
    if (!j.host || !path) return frame?.url ?? null;
    frame = { url: `${j.host}${path}`, at: Date.now() };
    return frame.url;
  } catch {
    return frame?.url ?? null;
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  const { z, x, y } = await params;
  if (![z, x, y].every((v) => /^\d{1,7}$/.test(v)) || Number(z) > 12) return png(BLANK, 3600);
  const base = await latestFrame();
  if (!base) return png(BLANK, 60);
  try {
    const res = await fetch(`${base}/256/${z}/${x}/${y}/2/1_1.png`, { next: { revalidate: 300 }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return png(BLANK, 60);
    return png(await res.arrayBuffer(), 300);
  } catch {
    return png(BLANK, 60);
  }
}
