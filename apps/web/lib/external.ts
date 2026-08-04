import 'server-only';
import { NextResponse } from 'next/server';
import { getServerSupabase } from './supabase';
import { enforceRateLimit, type RateLimitName } from './rate-limit';

/**
 * Shared helpers for the external-feed proxy routes
 * (port of CamerasController's TomTom / FlightRadar24 / Kpler proxies).
 * API keys live server-side only; every route requires an authenticated session.
 */

/**
 * Session gate for a proxy route, with an optional per-user request limit.
 *
 * `deny` carries either the 401 or the 429, so a handler stays a two-line
 * preamble and cannot accidentally enforce one check and skip the other:
 *
 *     const { deny } = await requireAuth('external');
 *     if (deny) return deny;
 */
export async function requireAuth(limit?: RateLimitName) {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, supabase, deny: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  if (limit) {
    const limited = await enforceRateLimit(supabase, limit);
    if (limited) return { user, supabase, deny: limited };
  }

  return { user, supabase, deny: null };
}

export function unconfigured(name: string, envVar: string) {
  return NextResponse.json(
    { configured: false, message: `${name} proxy not configured — set ${envVar}.` },
    { status: 200 },
  );
}

/** Fetch upstream JSON and relay it verbatim (V4 returned Content(data, "application/json")). */
export async function relayJson(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers, cache: 'no-store' });
  const body = await res.text();
  if (!res.ok) {
    return NextResponse.json(
      { error: `Upstream ${res.status} ${res.statusText}`, detail: body.slice(0, 500) },
      { status: res.status },
    );
  }
  return new NextResponse(body, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
