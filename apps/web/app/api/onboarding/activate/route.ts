import { NextResponse } from 'next/server';
import { activateAccount } from '@/lib/onboarding/server';

export const dynamic = 'force-dynamic';

/**
 * Phone app, last step of activating with a printed code. Creates the account
 * exactly as the web page does; the app then signs in with the password the
 * person chose, which never leaves their phone except to create the account.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as
    { code?: unknown; badge?: unknown; password?: unknown; accepted?: unknown } | null;
  const result = await activateAccount({
    kind: 'code',
    secret: String(body?.code ?? ''),
    badge: String(body?.badge ?? ''),
    password: String(body?.password ?? ''),
    accepted: body?.accepted === true,
  });
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
}
