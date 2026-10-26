import { NextResponse } from 'next/server';
import { readModelJson, saveDisasterBrief } from '@criticom/api';
import {
  EMPTY_BRIEF, deskChecks, disasterSystemPrompt, disasterUserPrompt, postMortemSystemPrompt, postMortemUserPrompt,
  readDisasterBrief, readMarker, readPostMortemDraft, type DisasterBrief,
} from '@criticom/api/criti/disaster';
import { canAccess } from '@criticom/db';
import { complete, configuredProviders, integrationSettings } from '@/lib/criti/llm';
import { critiSession } from '@/lib/criti/server';
import { loadDesk } from '@/lib/disaster-desk';

/**
 * Criti on the Disaster desk.
 *
 *   mode "read" (the default): Criti's reading of the call: what is
 *   happening, who to call out next (from the partner list only), what is
 *   being missed and what to ask. Asked by the desk after every change on a
 *   call and every few minutes while it is open. A reading already made for
 *   the same updates and call-outs in the last three minutes is returned
 *   as it is, so every dispatcher on the desk sees the same one.
 *   mode "post-mortem": a draft of the after-action report from the timeline,
 *   for the dispatcher to check before filing.
 *
 * Read with the dispatcher's own sign-in; saved only through
 * save_disaster_ai_brief() (0111), which checks they work the Disaster desk.
 * The model is never sent the caller's name or number, and its answer
 * changes nothing: the dispatcher calls out and files.
 *
 * Request:  { incidentId, mode?, force? }
 * Response: read → { brief, checks, at, provider?, configured, error? }
 *           post-mortem → { draft, configured, provider?, error? }
 */
export const dynamic = 'force-dynamic';

const FRESH_MS = 3 * 60_000;

export async function POST(req: Request) {
  const session = await critiSession(req, { feature: 'web.assistant', limit: 'disaster' });
  if (session instanceof NextResponse) return session;
  const { supabase, me } = session;
  if (!canAccess('/disaster', me.role, me.silo)) {
    return NextResponse.json({ error: 'Only the Disaster desk uses this.' }, { status: 403 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Say which call.' }, { status: 400 });
  }
  const incidentId = typeof body.incidentId === 'string' ? body.incidentId : '';
  const desk = incidentId ? await loadDesk(supabase, incidentId) : null;
  if (!desk) return NextResponse.json({ error: 'That call could not be found.' }, { status: 404 });

  const now = new Date();
  const configured = configuredProviders().length > 0;
  const settings = configured ? await integrationSettings(supabase) : undefined;

  if (body.mode === 'post-mortem') {
    if (!configured) return NextResponse.json({ draft: null, configured: false });
    try {
      const answer = await complete(postMortemSystemPrompt(), postMortemUserPrompt(desk.ctx, now), { maxTokens: 900, timeoutMs: 25_000, settings });
      return NextResponse.json({ draft: readPostMortemDraft(readModelJson(answer.text)), configured: true, provider: answer.provider });
    } catch (e) {
      return NextResponse.json({ draft: null, configured: true, error: (e as Error).message });
    }
  }

  const checks = deskChecks(desk.ctx, now);
  const marker = readMarker(desk.ctx);
  const last = desk.record.brief;
  const saved = last ? { ...EMPTY_BRIEF, ...(last.brief as Partial<DisasterBrief>) } : null;
  // Checked against today's lists again: a partner called out since is not suggested.
  const lastBrief = saved ? readDisasterBrief(briefJson(saved), desk.ctx) : null;
  // The same reading, made a moment ago: everyone on the desk sees that one.
  if (last && lastBrief && last.read_marker === marker && body.force !== true
      && now.getTime() - new Date(last.created_at).getTime() < FRESH_MS) {
    return NextResponse.json({ brief: lastBrief, checks, at: last.created_at, provider: last.provider, configured });
  }
  if (!configured || desk.incident.status === 'Resolved' || desk.incident.status === 'Closed') {
    return NextResponse.json({ brief: lastBrief, checks, at: last?.created_at ?? null, provider: last?.provider ?? null, configured });
  }

  try {
    const answer = await complete(disasterSystemPrompt(), disasterUserPrompt(desk.ctx, now), { maxTokens: 1200, timeoutMs: 25_000, settings });
    const brief = readDisasterBrief(readModelJson(answer.text), desk.ctx);
    if (!brief.summary && brief.callouts.length === 0) throw new Error('Criti gave no reading');
    const stored = await saveDisasterBrief(supabase, { incidentId: desk.incident.id, provider: answer.provider, readMarker: marker, brief })
      .catch(() => null);
    return NextResponse.json({ brief, checks, at: stored?.created_at ?? now.toISOString(), provider: answer.provider, configured: true });
  } catch (e) {
    // The desk keeps its rules and the last reading; the AI is a help, never a gate.
    return NextResponse.json({ brief: lastBrief, checks, at: last?.created_at ?? null, provider: last?.provider ?? null, configured: true, error: (e as Error).message });
  }
}

/** A saved reading back into the shape the model replies in, so it is checked against today's lists again. */
function briefJson(b: DisasterBrief): Record<string, unknown> {
  return {
    summary: b.summary, severity: b.severity, watch: b.watch, ask: b.ask,
    callouts: b.callouts.map((c) => ({ partner_id: c.partnerId, why: c.why, urgency: c.urgency })),
    figures: { homes_affected: b.figures.homesAffected, people_displaced: b.figures.peopleDisplaced, injured: b.figures.injured, deaths: b.figures.deaths },
  };
}
