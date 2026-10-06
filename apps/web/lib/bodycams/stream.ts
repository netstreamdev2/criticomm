import 'server-only';
import type { getServerSupabase } from '@/lib/supabase';
import { hikConfig, hikCredentials, hikPlaybackUrl, hikPreviewUrl } from '@/lib/hikvision';

type Supabase = Awaited<ReturnType<typeof getServerSupabase>>;

/** Why there is no stream, in words the person watching can act on. */
export class StreamUnavailable extends Error {}

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
  const url = args.kind === 'live'
    ? await hikPreviewUrl(cfg, args.cameraCode)
    : await hikPlaybackUrl(cfg, { cameraIndexCode: args.cameraCode, beginIso: args.from!, endIso: args.to! });
  if (!url) throw new StreamUnavailable('The Hikvision platform returned no stream address.');
  return { url, test: false, insecure: url.startsWith('http://') };
}
