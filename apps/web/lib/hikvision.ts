import 'server-only';
import { createHmac } from 'node:crypto';
import { Agent } from 'undici';
import { getIntegration } from '@criticom/api';
import type { getServerSupabase } from '@/lib/supabase';

/**
 * HikCentral Professional OpenAPI ("artemis") client.
 *
 * Every request is signed with the partner AK/SK pair using the platform's
 * HMAC-SHA256 scheme; the secret never leaves this module and never reaches
 * the browser — the UI talks to our /api/cctv/* proxies only.
 *
 * Config split, deliberately:
 *   env      HIKVISION_APP_KEY / HIKVISION_APP_SECRET   (secrets)
 *   DB       integration_settings['hikvision'].config   (base_url, page_size,
 *            preview_protocol, verify_tls — tunable without a deploy)
 *
 * On-prem HikCentral almost always ships a self-signed HTTPS certificate;
 * `verify_tls: false` accepts it for the proxy's outbound hop only.
 */

type Supabase = Awaited<ReturnType<typeof getServerSupabase>>;

export type HikConfig = {
  baseUrl: string;
  pageSize: number;
  previewProtocol: 'hls' | 'rtsp' | 'rtmp' | 'ws';
  verifyTls: boolean;
  enabled: boolean;
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
  const protocol = String(cfg.preview_protocol ?? 'hls');
  return {
    baseUrl: String(cfg.base_url ?? '').replace(/\/+$/, ''),
    pageSize: Math.min(500, Math.max(10, Number(cfg.page_size) || 100)),
    previewProtocol: (['hls', 'rtsp', 'rtmp', 'ws'].includes(protocol) ? protocol : 'hls') as HikConfig['previewProtocol'],
    verifyTls: cfg.verify_tls !== false,
    enabled: Boolean(row?.enabled),
  };
}

/**
 * Signed POST to an artemis path. The string-to-sign is the platform's
 * standard: METHOD, Accept and Content-Type lines, the x-ca-key header, then
 * the request path — HMAC-SHA256'd with the app secret, base64-encoded.
 */
export async function hikRequest<T>(
  cfg: HikConfig,
  path: string,
  body: Record<string, unknown>,
  timeoutMs = 10_000,
): Promise<T> {
  const creds = hikCredentials();
  if (!creds) throw new Error('HIKVISION_APP_KEY / HIKVISION_APP_SECRET are not set.');
  if (!cfg.baseUrl) throw new Error('Hikvision base_url is not configured (Admin → Integrations).');

  const accept = '*/*';
  const contentType = 'application/json';
  const stringToSign = `POST\n${accept}\n${contentType}\nx-ca-key:${creds.appKey}\n${path}`;
  const signature = createHmac('sha256', creds.appSecret).update(stringToSign, 'utf8').digest('base64');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Accept: accept,
        'Content-Type': contentType,
        'x-ca-key': creds.appKey,
        'x-ca-signature': signature,
        'x-ca-signature-headers': 'x-ca-key',
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      cache: 'no-store',
      // Node's fetch (undici) accepts a dispatcher; typed loosely because the
      // RequestInit type doesn't know about it.
      ...(cfg.verifyTls
        ? {}
        : { dispatcher: new Agent({ connect: { rejectUnauthorized: false } }) } as object),
    });
    if (!res.ok) throw new Error(`HikCentral responded ${res.status}`);
    const envelope = (await res.json()) as ArtemisEnvelope<T>;
    if (envelope.code !== '0') {
      throw new Error(`HikCentral error ${envelope.code}: ${envelope.msg}`);
    }
    if (envelope.data === undefined) throw new Error('HikCentral returned no data.');
    return envelope.data;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('HikCentral timed out.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** One page of the camera resource list. */
export async function hikListCameras(cfg: HikConfig, pageNo: number) {
  type Page = {
    total: number;
    list: Array<{
      cameraIndexCode: string;
      cameraName: string;
      latitude?: string | number | null;
      longitude?: string | number | null;
      cameraType?: number;
      regionIndexCode?: string;
    }>;
  };
  const page = await hikRequest<Page>(cfg, '/artemis/api/resource/v1/cameras', {
    pageNo,
    pageSize: cfg.pageSize,
  });
  const toNum = (v: string | number | null | undefined) => {
    const n = Number(v);
    return Number.isFinite(n) && n !== 0 ? n : null;
  };
  return {
    total: page.total,
    cameras: (page.list ?? []).map<HikCamera>((c) => ({
      indexCode: c.cameraIndexCode,
      name: c.cameraName,
      latitude: toNum(c.latitude),
      longitude: toNum(c.longitude),
      cameraType: c.cameraType ?? null,
      regionIndexCode: c.regionIndexCode ?? null,
    })),
  };
}

/** Live stream URL for a camera (protocol from config unless overridden). */
export async function hikPreviewUrl(
  cfg: HikConfig,
  cameraIndexCode: string,
  protocol?: HikConfig['previewProtocol'],
) {
  const data = await hikRequest<{ url: string }>(cfg, '/artemis/api/video/v2/cameras/previewURLs', {
    cameraIndexCode,
    streamType: 0,
    protocol: protocol ?? cfg.previewProtocol,
    transmode: 1,
  });
  return data.url;
}

/** Recorded-footage URL for a camera and time window (central storage). */
export async function hikPlaybackUrl(
  cfg: HikConfig,
  args: { cameraIndexCode: string; beginIso: string; endIso: string; protocol?: HikConfig['previewProtocol'] },
) {
  const data = await hikRequest<{ url: string }>(cfg, '/artemis/api/video/v2/cameras/playbackURLs', {
    cameraIndexCode: args.cameraIndexCode,
    recordLocation: '1',
    protocol: args.protocol ?? cfg.previewProtocol,
    transmode: 1,
    beginTime: args.beginIso,
    endTime: args.endIso,
  });
  return data.url;
}
