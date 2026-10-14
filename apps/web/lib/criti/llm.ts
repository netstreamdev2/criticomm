import 'server-only';
import type { CriticomClient } from '@criticom/db';

/**
 * The AI providers behind Criti. Each is asked for the same JSON reply, so
 * the answer and the tasks it prepares behave the same whichever answers.
 *
 *   grok    xAI Grok           XAI_API_KEY     (XAI_MODEL, default grok-4.7)
 *   groq    Groq               GROQ_API_KEY    (GROQ_MODEL, default openai/gpt-oss-120b)
 *   gemini  Google Gemini      GEMINI_API_KEY  (GEMINI_MODEL, default gemini-3.5-flash-lite)
 *
 * They are tried in that order (CRITI_PROVIDERS changes it, e.g.
 * "gemini,grok"), skipping any without a key or switched off under Admin →
 * Integrations, so an outage or a rate limit on one never silences Criti.
 * The keys stay on the server.
 */

export type ProviderId = 'grok' | 'groq' | 'gemini';

const LABEL: Record<ProviderId, string> = { grok: 'Grok', groq: 'Groq', gemini: 'Gemini' };
const KEY_ENV: Record<ProviderId, string> = { grok: 'XAI_API_KEY', groq: 'GROQ_API_KEY', gemini: 'GEMINI_API_KEY' };
const DEFAULT_MODEL: Record<ProviderId, string> = {
  grok: 'grok-4.7',
  groq: 'openai/gpt-oss-120b',
  gemini: 'gemini-3.5-flash-lite',
};
const MODEL_ENV: Record<ProviderId, string> = { grok: 'XAI_MODEL', groq: 'GROQ_MODEL', gemini: 'GEMINI_MODEL' };
const DEFAULT_ORDER: ProviderId[] = ['grok', 'groq', 'gemini'];

/** Each attempt waits at most this long: a dispatcher is waiting on the answer. */
const TIMEOUT_MS = 25_000;

function order(): ProviderId[] {
  const asked = (process.env.CRITI_PROVIDERS ?? '')
    .split(',').map((s) => s.trim().toLowerCase()).filter((s): s is ProviderId => s in LABEL);
  return asked.length ? [...new Set(asked)] : DEFAULT_ORDER;
}

/** Providers this deployment holds a key for, in the order they are tried. */
export function configuredProviders(): ProviderId[] {
  return order().filter((p) => Boolean(process.env[KEY_ENV[p]]));
}

export function providerLabel(p: ProviderId): string {
  return LABEL[p];
}

type Integration = { enabled: boolean; model?: string; temperature?: number };

/** Admin → Integrations: a provider switched off there is skipped; its model is used when no env var sets one. */
export async function integrationSettings(client: CriticomClient): Promise<Partial<Record<ProviderId, Integration>>> {
  try {
    const { data, error } = await client.from('integration_settings').select('key, enabled, config').in('key', ['grok', 'groq', 'gemini']);
    if (error) throw error;
    const out: Partial<Record<ProviderId, Integration>> = {};
    for (const row of (data ?? []) as Array<{ key: ProviderId; enabled: boolean; config: Record<string, unknown> | null }>) {
      const model = typeof row.config?.model === 'string' && row.config.model.trim() ? row.config.model.trim() : undefined;
      const temperature = typeof row.config?.temperature === 'number' ? row.config.temperature : undefined;
      out[row.key] = { enabled: row.enabled !== false, model, temperature };
    }
    return out;
  } catch {
    return {};
  }
}

async function timed(url: string, init: RequestInit, ms = TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timer);
  }
}

/** Groq and xAI share the OpenAI chat-completions shape. */
async function chatCompletions(
  p: 'grok' | 'groq', key: string, model: string, system: string, prompt: string, maxTokens: number, temperature: number,
  ms = TIMEOUT_MS,
): Promise<string> {
  const url = p === 'grok' ? 'https://api.x.ai/v1/chat/completions' : 'https://api.groq.com/openai/v1/chat/completions';
  const send = (json: boolean) => timed(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      temperature,
      max_tokens: maxTokens,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
  }, ms);
  let res = await send(true);
  // A model that cannot keep to JSON mode is refused with a 400; ask once
  // more without it and read the JSON out of the text.
  if (res.status === 400) res = await send(false);
  if (!res.ok) throw new Error(`${LABEL[p]} ${res.status}`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error(`${LABEL[p]} gave an empty answer`);
  return text;
}

async function gemini(key: string, model: string, system: string, prompt: string, maxTokens: number, temperature: number, ms = TIMEOUT_MS): Promise<string> {
  const res = await timed(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    // The key in a header, not the URL, so it never lands in a request log.
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature, maxOutputTokens: maxTokens, responseMimeType: 'application/json' },
    }),
  }, ms);
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim();
  if (!text) throw new Error('Gemini gave an empty answer');
  return text;
}

export type Completion = { text: string; provider: ProviderId };

/** Ask the first provider that answers. Throws only when every one failed. */
export async function complete(
  system: string,
  prompt: string,
  opts: {
    maxTokens?: number;
    settings?: Partial<Record<ProviderId, Integration>>;
    /** Each attempt waits at most this long (the call-taking form asks for less than the chat). */
    timeoutMs?: number;
  } = {},
): Promise<Completion> {
  const errors: string[] = [];
  const maxTokens = opts.maxTokens ?? 1400;
  for (const p of configuredProviders()) {
    const admin = opts.settings?.[p];
    if (admin && !admin.enabled) continue;
    const key = process.env[KEY_ENV[p]]!;
    const model = process.env[MODEL_ENV[p]]?.trim() || admin?.model || DEFAULT_MODEL[p];
    const temperature = Math.min(1, Math.max(0, admin?.temperature ?? 0.2));
    try {
      const text = p === 'gemini'
        ? await gemini(key, model, system, prompt, maxTokens, temperature, opts.timeoutMs)
        : await chatCompletions(p, key, model, system, prompt, maxTokens, temperature, opts.timeoutMs);
      return { text, provider: p };
    } catch (e) {
      errors.push((e as Error).name === 'AbortError' ? `${LABEL[p]} took too long` : (e as Error).message);
    }
  }
  throw new Error(errors.length ? errors.join('; ') : 'No AI provider is switched on');
}
