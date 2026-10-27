import { NextResponse } from 'next/server';
import { isCatalogueId } from '@/lib/ops-map/catalogue';
import { overlayTileUrl } from '@/lib/maps/sources';

/**
 * A map overlay's picture for one tile (flooding from space, fires, clouds,
 * river forecasts, risk), fetched from its source on the server so the page
 * needs no outside address. A tile that does not load comes back see-through:
 * the map never shows a broken square. Signed-in users only (the middleware
 * checks every /api path).
 */
export const dynamic = 'force-dynamic';

const BLANK = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const png = (body: ArrayBuffer | Buffer, maxAge: number, type = 'image/png') => new NextResponse(new Uint8Array(body), {
  status: 200, headers: { 'Content-Type': type, 'Cache-Control': `private, max-age=${maxAge}` },
});

/** PNG or JPEG by its first bytes (some sources say octet-stream); null for an error page. */
function pictureType(head: Uint8Array): string | null {
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8) return 'image/jpeg';
  return null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; z: string; x: string; y: string }> }) {
  const { id, z, x, y } = await params;
  if (!isCatalogueId(id) || ![z, x, y].every((v) => /^\d{1,7}$/.test(v))) return png(BLANK, 3600);
  const zi = Number(z);
  const n = 2 ** zi;
  if (zi > 18 || Number(x) >= n || Number(y) >= n) return png(BLANK, 3600);
  const src = overlayTileUrl(id, zi, Number(x), Number(y));
  if (!src) return png(BLANK, 3600);
  try {
    const res = await fetch(src.url, { next: { revalidate: src.minutes * 60 }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return png(BLANK, 60);
    const body = await res.arrayBuffer();
    const type = pictureType(new Uint8Array(body, 0, Math.min(4, body.byteLength)));
    if (!type) return png(BLANK, 60);
    return png(body, Math.min(src.minutes * 60, 3600), type);
  } catch {
    return png(BLANK, 60);
  }
}
