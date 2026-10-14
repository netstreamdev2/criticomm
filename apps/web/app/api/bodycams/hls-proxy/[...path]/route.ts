import { NextResponse } from 'next/server';
import { hikConfig } from '@/lib/hikvision';
import { getServerSupabase } from '@/lib/supabase';

/**
 * Passes the Hikvision platform's HLS through our own origin, so the browser
 * plays a same-origin (HTTPS on a deployed console) stream instead of the
 * platform's http:// address, which it would block as mixed content. Unlike
 * the ffmpeg relay this is just forwarding bytes, so it runs on serverless.
 *
 *   GET /api/bodycams/hls-proxy/<token>/live.m3u8      (token = base64url of
 *   GET /api/bodycams/hls-proxy/<token>/seghik-3.ts     the platform session URL)
 *
 * The playlist lists its segments by relative name, so the browser requests
 * them back through this same path. The request is already behind the app's
 * auth (middleware), and the token is checked to point at the configured
 * platform host before anything is fetched, so this can't be used to reach
 * other hosts.
 */
export const dynamic = 'force-dynamic';

const FILE_RE = /^[A-Za-z0-9._-]+\.(m3u8|ts)$/;

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  if (!path || path.length !== 2) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const [token, file] = path;
  if (!FILE_RE.test(file)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let base: string;
  try {
    base = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    return NextResponse.json({ error: 'Bad stream token' }, { status: 400 });
  }

  // SSRF guard: the decoded base must be an http(s) URL on the configured
  // platform host, so this endpoint can only ever fetch the bodycam platform.
  let target: URL;
  try {
    target = new URL(`${base}/${file}`);
  } catch {
    return NextResponse.json({ error: 'Bad stream token' }, { status: 400 });
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return NextResponse.json({ error: 'Bad stream token' }, { status: 400 });
  }
  const supabase = await getServerSupabase();
  const cfg = await hikConfig(supabase);
  let platformHost: string;
  try {
    platformHost = new URL(cfg.baseUrl).hostname;
  } catch {
    return NextResponse.json({ error: 'The Hikvision platform is not configured.' }, { status: 502 });
  }
  if (target.hostname !== platformHost) {
    return NextResponse.json({ error: 'Stream host not allowed' }, { status: 403 });
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const upstream = await fetch(target, { signal: ctrl.signal, cache: 'no-store' });
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: `The stream returned ${upstream.status}.` }, { status: 502 });
    }
    const isPlaylist = file.endsWith('.m3u8');
    return new NextResponse(upstream.body, {
      headers: {
        'Content-Type': isPlaylist ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
        // The playlist changes every few seconds; segments don't.
        'Cache-Control': isPlaylist ? 'no-store' : 'public, max-age=30',
      },
    });
  } catch (e) {
    const msg = (e as Error).name === 'AbortError' ? 'The stream timed out.' : 'The stream could not be reached.';
    return NextResponse.json({ error: msg }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
