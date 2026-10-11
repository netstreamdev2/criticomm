import { NextResponse } from 'next/server';
import { computeInsights, insightsApply, loadCritiBoard } from '@criticom/api';
import { critiSession } from '@/lib/criti/server';

/**
 * Criti's suggestion tiles for the signed-in person: what needs attention on
 * the board they may see, with the tasks their role may confirm. Worked out
 * by fixed rules (packages/api/src/criti/insights.ts), so no AI model is
 * called and no key is needed.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await critiSession(req, { feature: 'web.criti_tiles', limit: 'criti' });
  if (session instanceof NextResponse) return session;
  const { supabase, me } = session;
  const now = new Date();
  // Viewers, staff and case managers have no tiles: say so, and read nothing.
  if (!insightsApply(me.role)) return NextResponse.json({ insights: [], applies: false, at: now.toISOString() });
  try {
    const board = await loadCritiBoard(supabase, me);
    const insights = computeInsights({ me, incidents: board.incidents, crews: board.crews, thresholds: board.thresholds }, now);
    return NextResponse.json({ insights, applies: true, at: now.toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ insights: [], applies: true, at: now.toISOString(), error: 'Criti could not read the board just now.' });
  }
}
