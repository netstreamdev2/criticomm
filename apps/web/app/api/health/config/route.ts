import { NextResponse } from 'next/server';
import { ADMIN_ROLES } from '@criticom/db/roles';
import type { UserRole } from '@criticom/db/types';
import { getServerSupabase } from '@/lib/supabase';

/**
 * Deployment diagnostics.
 *
 * Deliberately reachable without a session so uptime monitors and post-deploy
 * smoke tests can hit it — but an anonymous caller gets only a liveness
 * verdict. The detail (project URL, which credentials are set and their shape)
 * is reconnaissance material for anyone probing a critical-services system, so
 * it is reserved for signed-in administrators.
 *
 * Secret values — and any fragment of them — are never returned to anyone.
 */
export const dynamic = 'force-dynamic';

const shape = (v: string | undefined) =>
  !v ? { present: false } : { present: true, length: v.length };

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const problems: string[] = [];
  if (!url) problems.push('NEXT_PUBLIC_SUPABASE_URL is missing (note the required NEXT_PUBLIC_ prefix).');
  else if (!/^https:\/\/.+\.supabase\.(co|in)$/.test(url.trim())) problems.push('NEXT_PUBLIC_SUPABASE_URL looks malformed — expected https://<ref>.supabase.co');
  else if (url !== url.trim()) problems.push('NEXT_PUBLIC_SUPABASE_URL has leading/trailing whitespace.');
  if (!anon) problems.push('NEXT_PUBLIC_SUPABASE_ANON_KEY is missing (note the required NEXT_PUBLIC_ prefix).');
  else if (anon !== anon.trim()) problems.push('NEXT_PUBLIC_SUPABASE_ANON_KEY has leading/trailing whitespace.');
  if (!service) problems.push('SUPABASE_SERVICE_ROLE_KEY is missing (server-only features will fail).');

  const ok = problems.length === 0;

  // Is the caller an administrator? A failure here must never break liveness.
  let isAdmin = false;
  try {
    const supabase = await getServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    const role = (user?.app_metadata?.role ?? '') as UserRole;
    isAdmin = Boolean(user) && ADMIN_ROLES.includes(role);
  } catch { /* treat as anonymous */ }

  if (!isAdmin) {
    // Enough for a monitor to alert on; nothing an attacker can use.
    return NextResponse.json(
      { ok, status: ok ? 'configured' : 'misconfigured' },
      { status: ok ? 200 : 503 },
    );
  }

  return NextResponse.json({
    ok,
    problems,
    vars: {
      NEXT_PUBLIC_SUPABASE_URL: url ? { present: true, value: url } : { present: false },
      NEXT_PUBLIC_SUPABASE_ANON_KEY: shape(anon),
      SUPABASE_SERVICE_ROLE_KEY: shape(service),
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? null,
      XAI_API_KEY: shape(process.env.XAI_API_KEY),
      GROQ_API_KEY: shape(process.env.GROQ_API_KEY),
      GEMINI_API_KEY: shape(process.env.GEMINI_API_KEY),
      ITRAFFIC_API_KEY: shape(process.env.ITRAFFIC_API_KEY),
      HIKVISION_APP_KEY: shape(process.env.HIKVISION_APP_KEY),
    },
    hint:
      'NEXT_PUBLIC_* values are inlined at BUILD time — after adding them you must redeploy ' +
      '(without build cache) for them to take effect.',
  });
}
