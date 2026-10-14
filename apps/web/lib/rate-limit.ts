import 'server-only';
import { NextResponse } from 'next/server';
import type { CriticomClient } from '@criticom/db';

/**
 * Per-user request limits for the API routes that cost money or third-party
 * quota (migration 0028).
 *
 * The counter lives in Postgres, not in the process: this app deploys
 * serverless, so an in-memory counter is per-instance and ten concurrent
 * lambdas would mean ten times the intended limit. The identity comes from
 * `auth.uid()` inside the database function, so a route handler cannot get it
 * wrong and a caller cannot spend someone else's budget.
 *
 * Limits are deliberately generous. This is a backstop against a runaway retry
 * loop or a borrowed console, not a metering product — an operator working a
 * major incident must never be told to slow down.
 */

export type RateLimitRule = {
  /** Namespace for the counter. Stable: renaming it resets everyone's window. */
  bucket: string;
  limit: number;
  windowSeconds: number;
};

/**
 * Every limited route, in one place, so the budget across the deployment can be
 * read at a glance rather than reconstructed from ten handlers.
 */
export const RATE_LIMITS = {
  /** Each turn is a model call. A person types maybe 6/min; a loop types 600. */
  chat: { bucket: 'chat', limit: 40, windowSeconds: 60 },
  /** Criti reading the call form's description as it is typed: one call per pause, never per keystroke. */
  intake: { bucket: 'intake', limit: 30, windowSeconds: 60 },
  /** Criti's tiles: a refresh on every live change and a 30-second tick, per open screen. No model call. */
  criti: { bucket: 'criti', limit: 150, windowSeconds: 60 },
  /** A task confirmed through Criti. Each is a person pressing Confirm. */
  criti_act: { bucket: 'criti_act', limit: 30, windowSeconds: 60 },
  /** Fires per keystroke-batch on the address field, so it needs headroom. */
  geocode: { bucket: 'geocode', limit: 120, windowSeconds: 60 },
  /** Metered upstreams: TomTom, FR24, Kpler. Panels poll on a timer. */
  external: { bucket: 'external', limit: 90, windowSeconds: 60 },
  /** Rendering a PDF with embedded photos is the most expensive thing we do. */
  pdf: { bucket: 'pdf', limit: 20, windowSeconds: 60 },
  /** Radio traffic: bursty by nature, so the window is short and the cap high. */
  ptt: { bucket: 'ptt', limit: 60, windowSeconds: 60 },
  /** Each grant is audit-logged for chain of custody; a flood pollutes that. */
  cctv: { bucket: 'cctv', limit: 60, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

/**
 * Count this request and return a 429 if it is over the limit, or null to
 * continue. Call it as the first thing after establishing the session:
 *
 *     const limited = await enforceRateLimit(supabase, 'chat');
 *     if (limited) return limited;
 *
 * **Fails open.** If the limiter itself errors — the table is unreachable, the
 * migration has not been applied to this environment — the request proceeds.
 * A rate limiter that takes down dispatch when the database hiccups has caused
 * far more harm than the runaway loop it was protecting against.
 */
export async function enforceRateLimit(
  client: CriticomClient,
  name: RateLimitName,
): Promise<NextResponse | null> {
  const rule = RATE_LIMITS[name];

  try {
    const { data, error } = await client.rpc('rate_limit_hit', {
      p_bucket: rule.bucket,
      p_limit: rule.limit,
      p_window_seconds: rule.windowSeconds,
    });
    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    if (!row || row.allowed) return null;

    const resetAt = new Date(row.reset_at);
    const retryAfter = Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000));

    return NextResponse.json(
      {
        error:
          `Too many requests. This limit exists to stop a stuck screen burning through the `
          + `service's quota — if you are seeing it during normal work, tell an administrator, `
          + `because the limit is wrong rather than you.`,
        retryAfter,
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfter),
          'RateLimit-Limit': String(rule.limit),
          'RateLimit-Remaining': '0',
          'RateLimit-Reset': String(retryAfter),
        },
      },
    );
  } catch (e) {
    console.warn(`[criticom] rate limiter unavailable for ${name}`, e);
    return null;
  }
}
