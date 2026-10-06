import { NextResponse } from 'next/server';
import { endBodycamView, startBodycamView, touchBodycamView } from '@criticom/api';
import type { BodycamViewReason } from '@criticom/db';
import { bodycamStream, StreamUnavailable } from '@/lib/bodycams/stream';
import { requireFeatureApi } from '@/lib/features';
import { invitationErrorMessage } from '@/lib/onboarding/errors';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getServerSupabase } from '@/lib/supabase';

/**
 * Opening, keeping and closing a view of a bodycam (migration 0054).
 *
 *   POST { action: 'start', bodycamId, kind, incidentId?, reason?, note?, from?, to? }
 *        → the database says yes or no and writes the record and audit log;
 *          only then is the stream address fetched.
 *   POST { action: 'touch', viewId }   every half minute while it is open
 *   POST { action: 'end', viewId, reason? }   closing it (also sent as a beacon
 *        when the tab goes away, so the body may arrive as text)
 */
export const dynamic = 'force-dynamic';

type Body = {
  action?: 'start' | 'touch' | 'end';
  bodycamId?: string;
  kind?: 'live' | 'footage';
  incidentId?: string | null;
  reason?: BodycamViewReason | null;
  note?: string | null;
  from?: string | null;
  to?: string | null;
  viewId?: string;
  endReason?: 'closed' | 'timeout' | 'failed';
};

function refusal(e: unknown) {
  const err = e as { code?: string; message?: string };
  const status = err?.code === '42501' ? 403 : err?.code === 'P0002' ? 404
    : err?.code === 'PGRST202' || err?.code === 'PGRST205' ? 501 : 400;
  return NextResponse.json({ error: invitationErrorMessage(e, 'The bodycam could not be opened.') }, { status });
}

export async function POST(req: Request) {
  const off = await requireFeatureApi('web.cameras');
  if (off) return off;

  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Body;
  try {
    body = JSON.parse(await req.text()) as Body;
  } catch {
    return NextResponse.json({ error: 'Send a JSON body.' }, { status: 400 });
  }

  if (body.action === 'touch' || body.action === 'end') {
    if (!body.viewId) return NextResponse.json({ error: 'viewId is required' }, { status: 400 });
    try {
      const res = body.action === 'touch'
        ? await touchBodycamView(supabase, body.viewId)
        : await endBodycamView(supabase, body.viewId, body.endReason ?? 'closed');
      return NextResponse.json(res);
    } catch (e) {
      return refusal(e);
    }
  }

  if (body.action !== 'start' || !body.bodycamId || (body.kind !== 'live' && body.kind !== 'footage')) {
    return NextResponse.json({ error: 'Say which bodycam, and live or footage.' }, { status: 400 });
  }
  // Every view is audit-logged for chain of custody; a flood buries the ones that matter.
  const limited = await enforceRateLimit(supabase, 'cctv');
  if (limited) return limited;

  let view: Awaited<ReturnType<typeof startBodycamView>>;
  try {
    view = await startBodycamView(supabase, {
      bodycamId: body.bodycamId, kind: body.kind, incidentId: body.incidentId ?? null,
      reason: body.reason ?? null, note: body.note ?? null, from: body.from ?? null, to: body.to ?? null,
    });
  } catch (e) {
    return refusal(e);
  }

  try {
    const stream = await bodycamStream(supabase, {
      cameraCode: view.hik_camera_code, kind: body.kind, from: body.from, to: body.to,
    });
    return NextResponse.json({
      viewId: view.view_id, serial: view.serial_number, officer: view.officer_name, ...stream,
    });
  } catch (e) {
    // The view was allowed and recorded, but nothing can be shown: close it as failed.
    await endBodycamView(supabase, view.view_id, 'failed').catch(() => {});
    const message = e instanceof StreamUnavailable ? e.message : `The stream could not be fetched: ${(e as Error).message}`;
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
