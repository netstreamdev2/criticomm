import { NextResponse } from 'next/server';
import {
  EMPTY_SUGGESTION, intakeSystemPrompt, intakeUserPrompt, readIntakeSuggestion, readModelJson, readWriteup,
  writeupSystemPrompt, writeupUserPrompt, type IntakeFacts,
} from '@criticom/api';
import { canAccess, cleanDetails } from '@criticom/db';
import { complete, configuredProviders, integrationSettings } from '@/lib/criti/llm';
import { critiSession, loadCodes } from '@/lib/criti/server';

/**
 * Criti on the call-taking form.
 *
 *   mode "read" (the default): reads the description as the call taker types
 *   it and suggests the type, severity, injuries, how many are hurt, the
 *   type's details, the departments, warnings and the next questions to ask.
 *   mode "writeup": writes the description from the details and the caller's
 *   words, for the call taker to check.
 *
 * Only call takers may ask, under the same switch and sign-in as the rest of
 * Criti, with a rate limit of its own (lib/rate-limit). The model is sent the
 * incident type, the details and injuries filled in, the number hurt and the
 * description, never the caller's name or number. Its answer is kept only
 * where it is on the organisation's own lists, and it changes nothing: the
 * form shows it, and fills only fields still empty.
 *
 * Request:  { mode?, incidentType, group, injuries, victims, isCallerPatient, description, details }
 * Response: read → { suggestion, configured, provider? }; writeup → { text, configured, provider? }
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
  const writeup = body.mode === 'writeup';
  const facts: IntakeFacts = {
    incidentType: str(body.incidentType, 100) || null,
    group: str(body.group, 60) || null,
    injuries: (Array.isArray(body.injuries) ? body.injuries : []).map((x) => str(x, 60)).filter(Boolean).slice(0, 12),
    victims: typeof body.victims === 'number' && Number.isInteger(body.victims) && body.victims >= 0 ? body.victims : null,
    isCallerPatient: typeof body.isCallerPatient === 'boolean' ? body.isCallerPatient : null,
    description: str(body.description, 1500).trim(),
    details: cleanDetails(body.details),
  };
  const configured = configuredProviders().length > 0;

  if (writeup) {
    // Something to write from: the type, and either details or the caller's words.
    if (!facts.incidentType || (Object.keys(facts.details ?? {}).length === 0 && facts.description.length < 8 && !facts.injuries.length)) {
      return NextResponse.json({ text: '', configured });
    }
    if (!configured) return NextResponse.json({ text: '', configured: false });
    try {
      const answer = await complete(writeupSystemPrompt(), writeupUserPrompt(facts), {
        maxTokens: 400,
        timeoutMs: 10_000,
        settings: await integrationSettings(supabase),
      });
      return NextResponse.json({ text: readWriteup(answer.text), configured: true, provider: answer.provider });
    } catch (e) {
      return NextResponse.json({ text: '', configured: true, error: (e as Error).message });
    }
  }

  // Nothing to read yet: the instant suggestions on the form already cover it.
  if (facts.description.length < 8) {
    return NextResponse.json({ suggestion: EMPTY_SUGGESTION, configured });
  }
  if (!configured) {
    return NextResponse.json({ suggestion: EMPTY_SUGGESTION, configured: false });
  }

  const codes = await loadCodes(supabase).catch(() => []);
  const types = codes.flatMap((g) => g.codes);
  try {
    const answer = await complete(intakeSystemPrompt(), intakeUserPrompt(facts, types), {
      maxTokens: 500,
      timeoutMs: 8_000,
      settings: await integrationSettings(supabase),
    });
    return NextResponse.json({
      suggestion: readIntakeSuggestion(readModelJson(answer.text), types, facts.incidentType),
      configured: true,
      provider: answer.provider,
    });
  } catch (e) {
    // The form keeps its instant suggestions; the AI is a help, never a gate.
    return NextResponse.json({ suggestion: EMPTY_SUGGESTION, configured: true, error: (e as Error).message });
  }
}
