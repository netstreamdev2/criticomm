import { NextResponse } from 'next/server';
import { readModelJson } from '@criticom/api';
import { isLang, languageName, placeholders, splitKey } from '@criticom/db/i18n';
import { GLOSSARY } from '@criticom/db/i18n/glossary';
import { SOURCE } from '@criticom/db/i18n/source';
import { complete, configuredProviders, integrationSettings } from '@/lib/criti/llm';
import { critiSession } from '@/lib/criti/server';

/**
 * Criti drafts the next sentences of a language for the translators to check
 * (0078): glossary words first, then the rest, a batch at a time. Only the
 * screen wording is sent, never anything from a call. The drafts are saved as
 * drafts; nothing is shown on the screens until a translator approves it.
 *
 * Request: { lang }   Response: { saved, left, drafts: { key: text } }
 */
export const dynamic = 'force-dynamic';

const BATCH = 60;

export async function POST(req: Request) {
  const session = await critiSession(req, { feature: 'web.assistant', limit: 'translate' });
  if (session instanceof NextResponse) return session;
  const { supabase } = session;

  let body: { lang?: unknown };
  try { body = (await req.json()) as { lang?: unknown }; } catch { body = {}; }
  const lang = body.lang;
  if (!isLang(lang) || lang === 'en') return NextResponse.json({ error: 'Choose a language.' }, { status: 400 });
  const { data: may } = await supabase.rpc('can_edit_translations', { p_lang: lang });
  if (may !== true) return NextResponse.json({ error: 'Only translators and administrators draft translations.' }, { status: 403 });
  if (configuredProviders().length === 0) return NextResponse.json({ error: 'No AI is set up under Admin → Integrations.' }, { status: 400 });

  // What the language already has, so only new sentences are drafted.
  const have = new Map<string, { text: string; status: string }>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('translations').select('key, text, status').eq('lang', lang).range(from, from + 999);
    if (error || !data) break;
    for (const r of data as Array<{ key: string; text: string; status: string }>) have.set(r.key, r);
    if (data.length < 1000) break;
  }
  const glossaryKeys = new Set(GLOSSARY.map((g) => g.text));
  const todo = SOURCE.filter((e) => !have.has(e.key)).sort((a, b) => Number(!glossaryKeys.has(a.key)) - Number(!glossaryKeys.has(b.key)));
  if (todo.length === 0) return NextResponse.json({ saved: 0, left: 0, drafts: {} });
  const batch = todo.slice(0, BATCH);

  const agreed = GLOSSARY.map((g) => have.get(g.text)).map((r, i) => (r?.status === 'approved' ? `${GLOSSARY[i]!.text} = ${r.text}` : null)).filter(Boolean);
  const name = languageName(lang);
  const system = [
    `You translate the wording of an emergency services app used in eThekwini (Durban, South Africa) from English into ${name}.`,
    `Write plain, everyday ${name} that call takers, dispatchers, police officers, firefighters and paramedics understand at once.`,
    'Keep each translation about as short as the English: many are buttons and labels.',
    'Keep every {name} placeholder exactly as written, and keep numbers, codes (10-50 PI, P1) and names of places unchanged.',
    'Where a context is given, it tells you how the words are used.',
    'Answer with one JSON object that maps each id to its translation, and nothing else.',
  ].join('\n');
  const user = [
    agreed.length ? `Agreed words (use them exactly):\n${agreed.join('\n')}` : '',
    'Sentences:',
    ...batch.map((e, i) => {
      const { context } = splitKey(e.key);
      return `s${i + 1}: ${JSON.stringify(e.text)}${context ? ` (context: ${context})` : ''}`;
    }),
  ].filter(Boolean).join('\n');

  let answer: { text: string };
  try {
    answer = await complete(system, user, { maxTokens: 4000, timeoutMs: 45_000, settings: await integrationSettings(supabase) });
  } catch (e) {
    return NextResponse.json({ error: `Criti could not draft just now: ${(e as Error).message}` }, { status: 502 });
  }
  const raw = readModelJson(answer.text) ?? {};
  const rows: Array<{ key: string; text: string }> = [];
  batch.forEach((e, i) => {
    const v = raw[`s${i + 1}`];
    if (typeof v !== 'string' || !v.trim()) return;
    const text = v.replace(/\s+/g, ' ').trim().slice(0, 2000);
    // A draft that lost a {name} would never be approved: leave it for a person.
    if (placeholders(e.text).every((p) => text.includes(`{${p}}`))) rows.push({ key: e.key, text });
  });
  if (rows.length === 0) return NextResponse.json({ error: 'Criti could not draft just now.' }, { status: 502 });

  const { data: saved, error } = await supabase.rpc('save_translation_drafts', { p_lang: lang, p_rows: rows });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({
    saved: typeof saved === 'number' ? saved : rows.length,
    left: Math.max(0, todo.length - batch.length),
    drafts: Object.fromEntries(rows.map((r) => [r.key, r.text])),
  });
}
