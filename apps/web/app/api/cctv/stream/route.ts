import { NextResponse } from 'next/server';
import { logAudit } from '@criticom/api';
import { canAccess } from '@criticom/db/roles';
import type { Silo, UserRole } from '@criticom/db/types';
import { hikConfig, hikPlaybackUrl, hikPreviewUrl } from '@/lib/hikvision';
import { getServerSupabase } from '@/lib/supabase';

/**
 * Stream-URL broker for Hikvision cameras — live preview and recorded
 * playback through one endpoint, so the AK/SK signing stays server-side.
 *
 *   POST { cameraIndexCode }                                → live URL
 *   POST { cameraIndexCode, beginIso, endIso }              → footage URL
 *
 * Every grant is audit-logged: who pulled which camera, live or a window of
 * footage — chain-of-custody groundwork for evidence requests.
 */
export const dynamic = 'force-dynamic';

const PROTOCOLS = ['hls', 'rtsp', 'rtmp', 'ws'] as const;

export async function POST(req: Request) {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = (user.app_metadata?.role ?? 'Viewer') as UserRole;
  const silo = (user.app_metadata?.silo ?? 'Ethekwini') as Silo;
  if (!canAccess('/cameras', role, silo)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = (await req.json()) as {
    cameraIndexCode?: string;
    protocol?: string;
    beginIso?: string;
    endIso?: string;
  };
  if (!body.cameraIndexCode) {
    return NextResponse.json({ error: 'cameraIndexCode is required' }, { status: 400 });
  }

  const cfg = await hikConfig(supabase);
  if (!cfg.enabled) {
    return NextResponse.json(
      { error: 'The Hikvision integration is disabled (Admin → Integrations).' },
      { status: 409 },
    );
  }

  const protocol = PROTOCOLS.includes(body.protocol as (typeof PROTOCOLS)[number])
    ? (body.protocol as (typeof PROTOCOLS)[number])
    : undefined;

  const wantsPlayback = Boolean(body.beginIso && body.endIso);
  if (wantsPlayback) {
    const begin = new Date(body.beginIso!);
    const end = new Date(body.endIso!);
    if (Number.isNaN(begin.getTime()) || Number.isNaN(end.getTime()) || end <= begin) {
      return NextResponse.json({ error: 'Invalid time window.' }, { status: 400 });
    }
    // 24h cap: HikCentral playback URLs are per-window; longer pulls should be
    // exported through the NVR, not streamed through a dispatch screen.
    if (end.getTime() - begin.getTime() > 24 * 3_600_000) {
      return NextResponse.json({ error: 'Footage windows are capped at 24 hours.' }, { status: 400 });
    }
  }

  try {
    const url = wantsPlayback
      ? await hikPlaybackUrl(cfg, {
          cameraIndexCode: body.cameraIndexCode,
          beginIso: body.beginIso!,
          endIso: body.endIso!,
          protocol,
        })
      : await hikPreviewUrl(cfg, body.cameraIndexCode, protocol);

    const userName = (user.user_metadata?.full_name as string | undefined) ?? user.email ?? 'Operator';
    await logAudit(supabase, {
      silo,
      action_type: wantsPlayback ? 'CctvFootageAccessed' : 'CctvLiveViewed',
      entity_type: 'camera',
      entity_id: body.cameraIndexCode,
      user_name: userName,
      details: wantsPlayback
        ? `Footage ${body.beginIso} → ${body.endIso}`
        : 'Live preview URL issued',
    }).catch(() => {});

    return NextResponse.json({ url, protocol: protocol ?? cfg.previewProtocol });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
