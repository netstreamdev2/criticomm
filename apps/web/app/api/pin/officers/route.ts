import { NextResponse } from 'next/server';
import { officersForDevice } from '@/lib/pin/server';

export const dynamic = 'force-dynamic';

/**
 * Phone app, signed out, on a registered device: the officers who may sign in
 * on it with a PIN, for choosing department and name (0109). Only the
 * device's own key gets the list.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { deviceId?: unknown; deviceSecret?: unknown } | null;
  const result = await officersForDevice({
    deviceId: String(body?.deviceId ?? ''),
    deviceSecret: String(body?.deviceSecret ?? ''),
  });
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
}
