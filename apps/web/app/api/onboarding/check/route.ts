import { NextResponse } from 'next/server';
import { confirmBadge } from '@/lib/onboarding/server';

export const dynamic = 'force-dynamic';

/**
 * Phone app, step 1 of activating with a printed code: the code and the badge
 * number. The same checks, limits and lockout as the web page.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { code?: unknown; badge?: unknown } | null;
  const result = await confirmBadge('code', String(body?.code ?? ''), String(body?.badge ?? ''));
  if (!result.ok) return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  const { preview } = result;
  return NextResponse.json({
    ok: true,
    fullName: result.fullName,
    signIn: result.signIn,
    signInAs: result.signInAs,
    role: preview.role,
    silo: preview.silo,
    organisation: preview.organisation,
    invitedBy: preview.invited_by_name,
    expiresAt: preview.expires_at,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
