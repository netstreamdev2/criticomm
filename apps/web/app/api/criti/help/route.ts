import { NextResponse } from 'next/server';
import { disasterHelpSystemPrompt, disasterHelpUserPrompt } from '@criticom/api/criti/disaster-help';
import { canAccess } from '@criticom/db';
import { complete, configuredProviders, integrationSettings } from '@/lib/criti/llm';
import { critiSession } from '@/lib/criti/server';

/**
 * "Ask Criti how to…" on the Disaster screens (0121). Criti answers from its
 * guide to the screens and the process (criti/disaster-help.ts); it is sent
 * the question and the page's name only, never an incident or a person.
 *
 * Request:  { question, page? }
 * Response: { answer, configured, error? }
 */
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const session = await critiSession(req, { feature: 'web.assistant', limit: 'disaster' });
  if (session instanceof NextResponse) return session;
  const { supabase, me } = session;
  if (!canAccess('/disaster', me.role, me.silo)) return NextResponse.json({ error: 'Only the Disaster desk uses this.' }, { status: 403 });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Ask a question.' }, { status: 400 });
  }
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (question.length < 3) return NextResponse.json({ error: 'Ask a question.' }, { status: 400 });
  const page = typeof body.page === 'string' ? body.page : null;
  if (configuredProviders().length === 0) return NextResponse.json({ answer: null, configured: false });
  try {
    const settings = await integrationSettings(supabase);
    const answer = await complete(disasterHelpSystemPrompt(), disasterHelpUserPrompt(question, page), { maxTokens: 350, timeoutMs: 20_000, settings });
    return NextResponse.json({ answer: answer.text.trim().slice(0, 1500), configured: true, provider: answer.provider });
  } catch (e) {
    return NextResponse.json({ answer: null, configured: true, error: (e as Error).message });
  }
}
