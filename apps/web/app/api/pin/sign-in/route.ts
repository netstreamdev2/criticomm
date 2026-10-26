import { NextResponse } from 'next/server';
import { signInWithPin } from '@/lib/pin/server';

export const dynamic = 'force-dynamic';

/**
 * Phone app, signed out: an officer signs in with their PIN on a registered
 * device (0108). Only the device's key, who, and the PIN travel, over HTTPS;
 * the answer is a one-time sign-in the phone exchanges at once.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as
    { deviceId?: unknown; deviceSecret?: unknown; userId?: unknown; badge?: unknown; pin?: unknown } | null;
  const result = await signInWithPin({
    deviceId: String(body?.deviceId ?? ''),
    deviceSecret: String(body?.deviceSecret ?? ''),
    userId: typeof body?.userId === 'string' && body.userId ? body.userId : null,
    badge: typeof body?.badge === 'string' ? body.badge : null,
    pin: String(body?.pin ?? ''),
  });
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
}
