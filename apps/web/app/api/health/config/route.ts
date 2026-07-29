import { NextResponse } from 'next/server';

/**
 * Deployment diagnostics: reports WHICH env vars this build can see.
 * Never returns secret values — only booleans, lengths, and a short masked
 * prefix so a wrong/truncated value is obvious.
 */
export const dynamic = 'force-dynamic';

const mask = (v: string | undefined) =>
  !v ? null : { present: true, length: v.length, startsWith: v.slice(0, 12), endsWith: v.slice(-4) };

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

  return NextResponse.json({
    ok: problems.length === 0,
    problems,
    vars: {
      NEXT_PUBLIC_SUPABASE_URL: url ? { present: true, value: url } : { present: false },
      NEXT_PUBLIC_SUPABASE_ANON_KEY: mask(anon) ?? { present: false },
      SUPABASE_SERVICE_ROLE_KEY: mask(service) ?? { present: false },
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? null,
    },
    hint:
      'NEXT_PUBLIC_* values are inlined at BUILD time — after adding them you must redeploy ' +
      '(without build cache) for them to take effect.',
  });
}
