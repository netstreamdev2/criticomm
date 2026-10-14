import 'server-only';
import type { getServerSupabase } from '@/lib/supabase';
import { hikConfig, hikCredentials, hikPlaybackUrl, hikPreviewUrl, hikRtspUrl } from '@/lib/hikvision';
import { startRelay } from '@/lib/bodycams/hls-relay';

type Supabase = Awaited<ReturnType<typeof getServerSupabase>>;

/** Why there is no stream, in words the person watching can act on. */
export class StreamUnavailable extends Error {}

/**
 * Turn the platform's HLS address into one on our own origin. The browser then
 * fetches the playlist and segments from us and we pass them through to the
 * platform — so an http:// platform stream plays on an HTTPS console without a
 * mixed-content block, and it needs no ffmpeg, so it works on serverless too.
 * The platform's session URL (with its short-lived token) is carried in the
 * path; the proxy checks it points at the configured platform before fetching.
 */
function proxyUrlFor(platformUrl: string): string {
  const i = platformUrl.lastIndexOf('/');
  const token = Buffer.from(platformUrl.slice(0, i), 'utf8').toString('base64url');
  return `/api/bodycams/hls-proxy/${token}/${platformUrl.slice(i + 1)}`;
}

export type BodycamStream = {
  url: string;
  /** The sample video, not the bodycam: the platform is not connected yet. */
  test: boolean;
  /** An http:// address, which a browser on an HTTPS console refuses to play. */
  insecure: boolean;
};

/**
 * The stream address for a view the database has already allowed: the sample
 * video while the test stream is switched on, otherwise the Hikvision
 * platform's own HLS address for the bodycam's camera code.
 */
export async function bodycamStream(
  supabase: Supabase,
  args: { cameraCode: string | null; kind: 'live' | 'footage'; from?: string | null; to?: string | null },
): Promise<BodycamStream> {
  const cfg = await hikConfig(supabase);
  if (cfg.streamSource === 'test') {
    return { url: cfg.testStreamUrl, test: true, insecure: false };
  }
  if (!cfg.enabled) {
    throw new StreamUnavailable('The Hikvision platform is not switched on yet (Admin → Integrations). To demonstrate, switch on the test video there.');
  }
  if (!hikCredentials()) {
    throw new StreamUnavailable('The Hikvision API key and secret are not set on this server yet.');
  }
  if (!args.cameraCode) {
    throw new StreamUnavailable('This bodycam has no Hikvision camera code on the register yet. Add it on the bodycam register.');
  }

  // Opt-in fallback: on a host whose platform HLS does not work, repackage the
  // RTSP into HLS with ffmpeg (needs a long-lived Node server, not serverless).
  if (args.kind === 'live' && cfg.relayLive) {
    const rtsp = await hikRtspUrl(cfg, args.cameraCode);
    if (!rtsp) throw new StreamUnavailable('The Hikvision platform returned no stream address.');
    const { playlistUrl } = await startRelay(args.cameraCode, rtsp);
    return { url: playlistUrl, test: false, insecure: false };
  }

  // Default: the platform's own HLS, served through our origin (see proxyUrlFor).
  const platformUrl = args.kind === 'live'
    ? await hikPreviewUrl(cfg, args.cameraCode)
    : await hikPlaybackUrl(cfg, { cameraIndexCode: args.cameraCode, beginIso: args.from!, endIso: args.to! });
  if (!platformUrl) throw new StreamUnavailable('The Hikvision platform returned no stream address.');
  return { url: proxyUrlFor(platformUrl), test: false, insecure: false };
}
