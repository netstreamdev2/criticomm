import 'server-only';
import { NextResponse } from 'next/server';
import { getServerSupabase } from './supabase';

/**
 * Shared helpers for the external-feed proxy routes
 * (port of CamerasController's TomTom / FlightRadar24 / Kpler proxies).
 * API keys live server-side only; every route requires an authenticated session.
 */

export async function requireAuth() {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, supabase, deny: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
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
