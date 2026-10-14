import { NextResponse } from 'next/server';
import {
  EMPTY_SUGGESTION, intakeSystemPrompt, intakeUserPrompt, readIntakeSuggestion, readModelJson, type IntakeFacts,
} from '@criticom/api';
import { canAccess } from '@criticom/db';
import { complete, configuredProviders, integrationSettings } from '@/lib/criti/llm';
import { critiSession, loadCodes } from '@/lib/criti/server';

/**
 * Criti on the call-taking form: reads the description as the call taker
 * types it and suggests the type, severity, injuries, how many are hurt, the
 * departments, warnings and the next questions to ask.
 *
 * Only call takers may ask, under the same switch and sign-in as the rest of
 * Criti, with a rate limit of its own (lib/rate-limit). The model is sent the incident type, the injuries ticked,
 * the number hurt and the description, never the caller's name or number.
 * Its answer is kept only where it is on the organisation's own lists, and it
 * changes nothing: the form shows it, and fills only fields still empty.
 *
 * Request:  { incidentType, group, injuries, victims, isCallerPatient, description }
 * Response: { suggestion, configured, provider? }
 */
export const dynamic = 'force-dynamic';

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

export async function POST(req: Request) {
  const session = await critiSession(req, { feature: 'web.assistant', limit: 'intake' });
  if (session instanceof NextResponse) return session;
  const { supabase, me } = session;
  if (!canAccess('/dispatch/log-call', me.role, me.silo)) {
    return NextResponse.json({ error: 'Only call takers use this.' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Send the call so far.' }, { status: 400 });
  }
  const facts: IntakeFacts = {
    incidentType: str(body.incidentType, 100) || null,
    group: str(body.group, 60) || null,
    injuries: (Array.isArray(body.injuries) ? body.injuries : []).map((x) => str(x, 60)).filter(Boolean).slice(0, 12),
    victims: typeof body.victims === 'number' && Number.isInteger(body.victims) && body.victims >= 0 ? body.victims : null,
    isCallerPatient: typeof body.isCallerPatient === 'boolean' ? body.isCallerPatient : null,
    description: str(body.description, 1500).trim(),
  };
  // Nothing to read yet: the instant suggestions on the form already cover it.
  if (facts.description.length < 8) {
    return NextResponse.json({ suggestion: EMPTY_SUGGESTION, configured: configuredProviders().length > 0 });
  }
  if (configuredProviders().length === 0) {
    return NextResponse.json({ suggestion: EMPTY_SUGGESTION, configured: false });
  }

  const codes = await loadCodes(supabase).catch(() => []);
  const types = codes.flatMap((g) => g.codes);
  try {
    const answer = await complete(intakeSystemPrompt(), intakeUserPrompt(facts, types), {
      maxTokens: 400,
      timeoutMs: 8_000,
      settings: await integrationSettings(supabase),
    });
    return NextResponse.json({
      suggestion: readIntakeSuggestion(readModelJson(answer.text), types),
      configured: true,
      provider: answer.provider,
    });
  } catch (e) {
    // The form keeps its instant suggestions; the AI is a help, never a gate.
    return NextResponse.json({ suggestion: EMPTY_SUGGESTION, configured: true, error: (e as Error).message });
  }
}
