import { type NextRequest, NextResponse } from 'next/server';
import { verifyInvitation } from '@/lib/invitations/server';
import { INVITATION_COOKIE, RECEIPT_SECONDS } from '@/lib/invitations/receipt';
import { invitationCallback } from '@/lib/invitations/workflow';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token_hash');
  // Next's dev server can normalize 127.0.0.1 to localhost in request.url.
  // Keep the configured origin so the receipt cookie survives the redirect.
  const target = new URL('/accept-invite', invitationCallback(process.env.NEXT_PUBLIC_APP_URL));
  let receipt: string | null = null;
  if (!token || !/^[a-fA-F0-9]{32,128}$/.test(token) || request.nextUrl.searchParams.get('type') !== 'invite') {
    target.searchParams.set('error', 'invalid');
  } else {
    try {
      receipt = await verifyInvitation(token);
      if (!receipt) target.searchParams.set('error', 'expired');
    } catch {
      // Never put Auth tokens or upstream exception details into a URL/log.
      target.searchParams.set('error', 'unavailable');
    }
  }
  const response = NextResponse.redirect(target);
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.cookies.set(INVITATION_COOKIE, receipt ?? '', {
    httpOnly: true, sameSite: 'lax', secure: request.nextUrl.protocol === 'https:',
    path: '/accept-invite', maxAge: receipt ? RECEIPT_SECONDS : 0,
  });
  return response;
}
