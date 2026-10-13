import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { relayFile } from '@/lib/bodycams/hls-relay';

/**
 * Serves the HLS playlist and segments that lib/bodycams/hls-relay produces
 * from the bodycam's RTSP stream — from our own origin, so the browser plays
 * it without a mixed-content block.
 *
 *   GET /api/bodycams/hls/<sessionId>/index.m3u8
 *   GET /api/bodycams/hls/<sessionId>/seg_00001.ts
 *
 * The session id is a random UUID handed only to the viewer whose view the
 * database already authorised (start_bodycam_view), and the file is reaped
 * seconds after the tab closes.
 */
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  if (!path || path.length !== 2) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const [sessionId, file] = path;
  if (!sessionId || !file) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const resolved = relayFile(sessionId, file);
  if (!resolved) {
    return NextResponse.json({ error: 'This live view has ended.' }, { status: 404 });
  }

  let size: number;
  try {
    size = (await stat(resolved.path)).size;
  } catch {
    // The playlist exists but the segment ffmpeg is still writing may not yet;
    // tell hls.js to retry rather than fail the stream.
    return NextResponse.json({ error: 'Segment not ready.' }, { status: 404 });
  }

  const body = Readable.toWeb(createReadStream(resolved.path)) as unknown as ReadableStream;
  return new NextResponse(body, {
    headers: {
      'Content-Type': resolved.contentType,
      'Content-Length': String(size),
      // The playlist changes every couple of seconds; segments are immutable.
      'Cache-Control': file.endsWith('.m3u8') ? 'no-store' : 'public, max-age=10',
    },
  });
}
