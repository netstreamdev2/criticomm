import { NextResponse } from 'next/server';
import { DISPATCH_ROLES, type UserRole } from '@criticom/db';
import { requireAuth, unconfigured } from '@/lib/external';
import { getPttAudioLog, isPttConfigured } from '@/lib/realptt';

/** ResponderController.GetUnitAudio — recent PTT voice recordings for a unit. */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { user, deny } = await requireAuth();
  if (deny) return deny;
  const role = (user!.app_metadata?.role ?? 'Viewer') as UserRole;
  if (!DISPATCH_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!isPttConfigured()) return unconfigured('RealPTT', 'REALPTT_ACCOUNT / REALPTT_PASSWORD');

  const account = new URL(req.url).searchParams.get('account');
  if (!account) return NextResponse.json({ error: 'account required' }, { status: 400 });

  try {
    const result = await getPttAudioLog(account);
    if (!result.ok) return NextResponse.json({ success: false, error: result.error });
    return NextResponse.json({ success: true, audios: result.audios });
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 502 });
  }
}
