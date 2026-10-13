import 'server-only';
// Use undici's own fetch alongside its Agent: Node's built-in global fetch
// rejects a dispatcher created from the npm `undici` package (they are
// separate undici instances → UND_ERR_INVALID_ARG → "fetch failed"), so the
// verify_tls:false path for on-prem self-signed certs only works when both
// come from the same package.
import { Agent, fetch as undiciFetch } from 'undici';
import { getIntegration } from '@criticom/api';
import type { getServerSupabase } from '@/lib/supabase';
import { signedHeaders, toPlatformTime } from '@/lib/hikvision-sign';

/**
 * The Hikvision platform's OpenAPI ("artemis") client — HCM Lite, which runs
 * the bodycams (HikCentral exposes the same calls).
 *
 * Every request is signed with the partner AK/SK pair (lib/hikvision-sign);
 * the secret never leaves the server and never reaches the browser — the UI
 * talks to /api/bodycams/view only, after the database has allowed the view.
 *
 * Config split, deliberately:
 *   env      HIKVISION_APP_KEY / HIKVISION_APP_SECRET   (secrets)
 *   DB       integration_settings['hikvision'].config   (base_url, tree_code,
 *            page_size, stream_type, record_location, transcode, verify_tls,
 *            stream_source, test_stream_url — tunable without a deploy)
 *
 * On-prem platforms almost always ship a self-signed HTTPS certificate;
 * `verify_tls: false` accepts it for the proxy's outbound hop only.
 */

type Supabase = Awaited<ReturnType<typeof getServerSupabase>>;

/** A public sample stream: plays while the platform is not connected (stream_source "test"). */
export const DEFAULT_TEST_STREAM = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';

export type HikConfig = {
  baseUrl: string;
  treeCode: string;
  pageSize: number;
  /** 0 main stream, 1 sub-stream (lighter on the bodycam's mobile data). */
  streamType: 0 | 1;
  /** Where recordings are kept: '0' central storage (bodycam uploads), '1' on the device. */
  recordLocation: '0' | '1';
  /** Ask the platform to turn H.265 into H.264, which browsers can play. */
  transcode: boolean;
  verifyTls: boolean;
  enabled: boolean;
  /** 'test' plays the sample stream instead of asking the platform. */
  streamSource: 'hikvision' | 'test';
  testStreamUrl: string;
  /**
   * Repackage the platform's RTSP into HLS on our own server (ffmpeg) for live
   * view, instead of using the platform's HLS. On by default: this deployment's
   * platform does not serve HLS, and it also avoids the mixed-content block.
   */
  relayLive: boolean;
};

export type HikCamera = {
  indexCode: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  cameraType: number | null;
  regionIndexCode: string | null;
};

type ArtemisEnvelope<T> = { code: string; msg: string; data?: T };

export function hikCredentials() {
  const appKey = process.env.HIKVISION_APP_KEY;
  const appSecret = process.env.HIKVISION_APP_SECRET;
  return appKey && appSecret ? { appKey, appSecret } : null;
}

/** DB-backed knobs with safe fallbacks; `enabled` mirrors the admin toggle. */
export async function hikConfig(supabase: Supabase): Promise<HikConfig> {
  const row = await getIntegration(supabase, 'hikvision').catch(() => null);
  const cfg = (row?.config ?? {}) as Record<string, unknown>;
  const testUrl = String(cfg.test_stream_url ?? '').trim();
  return {
    baseUrl: String(cfg.base_url ?? '').replace(/\/+$/, ''),
    treeCode: String(cfg.tree_code ?? '0') || '0',
    pageSize: Math.min(500, Math.max(10, Number(cfg.page_size) || 100)),
    streamType: Number(cfg.stream_type) === 1 ? 1 : 0,
    recordLocation: String(cfg.record_location ?? '0') === '1' ? '1' : '0',
    transcode: cfg.transcode !== false,
    verifyTls: cfg.verify_tls !== false,
    enabled: Boolean(row?.enabled),
    streamSource: cfg.stream_source === 'test' ? 'test' : 'hikvision',
    testStreamUrl: /^https:\/\//.test(testUrl) ? testUrl : DEFAULT_TEST_STREAM,
    relayLive: cfg.relay_live !== false,
  };
}

/** Signed POST to an artemis path. */
export async function hikRequest<T>(
  cfg: HikConfig,
  path: string,
  body: Record<string, unknown>,
  timeoutMs = 10_000,
): Promise<T> {
  const creds = hikCredentials();
  if (!creds) throw new Error('HIKVISION_APP_KEY / HIKVISION_APP_SECRET are not set.');
  if (!cfg.baseUrl) throw new Error('Hikvision base_url is not configured (Admin → Integrations).');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await undiciFetch(`${cfg.baseUrl}${path}`, {
      method: 'POST',
      headers: signedHeaders(creds, path),
      body: JSON.stringify(body),
      signal: ctrl.signal,
      // On-prem platforms ship a self-signed cert; this skips verification for
      // this one outbound hop only (the Agent and fetch are from the same
      // undici package, so the dispatcher is accepted).
      ...(cfg.verifyTls
        ? {}
        : { dispatcher: new Agent({ connect: { rejectUnauthorized: false } }) }),
    });
    if (!res.ok) throw new Error(`The Hikvision platform responded ${res.status}`);
    const envelope = (await res.json()) as ArtemisEnvelope<T>;
    if (envelope.code !== '0') {
      throw new Error(`Hikvision error ${envelope.code}: ${envelope.msg}`);
    }
    if (envelope.data === undefined) throw new Error('The Hikvision platform returned no data.');
    return envelope.data;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('The Hikvision platform timed out.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** One page of the camera list (bodycams are cameras to the platform). */
export async function hikListCameras(cfg: HikConfig, pageNo: number) {
  type Page = {
    total: number;
    list: Array<{
      cameraIndexCode: string;
      name?: string;
      cameraName?: string;
      latitude?: string | number | null;
      longitude?: string | number | null;
      cameraType?: number;
      regionIndexCode?: string;
      unitIndexCode?: string;
    }>;
  };
  const page = await hikRequest<Page>(cfg, '/artemis/api/resource/v1/cameras', {
    pageNo,
    pageSize: cfg.pageSize,
    treeCode: cfg.treeCode,
  });
  const toNum = (v: string | number | null | undefined) => {
    const n = Number(v);
    return Number.isFinite(n) && n !== 0 ? n : null;
  };
  return {
    total: page.total,
    cameras: (page.list ?? []).map<HikCamera>((c) => ({
      indexCode: c.cameraIndexCode,
      name: c.name ?? c.cameraName ?? c.cameraIndexCode,
      latitude: toNum(c.latitude),
      longitude: toNum(c.longitude),
      cameraType: c.cameraType ?? null,
      regionIndexCode: c.regionIndexCode ?? c.unitIndexCode ?? null,
    })),
  };
}

/** Browsers play HLS; H.265 has to become H.264 on the way. */
const expandFor = (cfg: HikConfig) => (cfg.transcode ? { expand: 'transcode=1' } : {});

/** Live stream address for a camera, as HLS for the browser. */
export async function hikPreviewUrl(cfg: HikConfig, cameraIndexCode: string) {
  const data = await hikRequest<{ url: string }>(cfg, '/artemis/api/video/v1/cameras/previewURLs', {
    cameraIndexCode,
    streamType: cfg.streamType,
    protocol: 'hls',
    transmode: 1,
    ...expandFor(cfg),
  });
  return data.url;
}

/**
 * Live stream as RTSP (native H.264), for the server to repackage into HLS.
 * Used when the platform's own HLS output is unavailable; no transcode, since
 * ffmpeg copies the stream rather than re-encoding it.
 */
export async function hikRtspUrl(cfg: HikConfig, cameraIndexCode: string) {
  const data = await hikRequest<{ url: string }>(cfg, '/artemis/api/video/v1/cameras/previewURLs', {
    cameraIndexCode,
    streamType: cfg.streamType,
    protocol: 'rtsp',
    transmode: 1,
  });
  return data.url;
}

/** Recorded footage for a camera and time window, as HLS for the browser. */
export async function hikPlaybackUrl(cfg: HikConfig, args: { cameraIndexCode: string; beginIso: string; endIso: string }) {
  const data = await hikRequest<{ url: string }>(cfg, '/artemis/api/video/v1/cameras/playbackURLs', {
    cameraIndexCode: args.cameraIndexCode,
    beginTime: toPlatformTime(args.beginIso),
    endTime: toPlatformTime(args.endIso),
    recordLocation: cfg.recordLocation,
    protocol: 'hls',
    ...expandFor(cfg),
  });
  return data.url;
}
