import { NextResponse } from 'next/server';
import { DISPATCH_ROLES, type UserRole } from '@criticom/db';
import { requireAuth, unconfigured } from '@/lib/external';
import { isPttConfigured, sendPttMessage } from '@/lib/realptt';

/** ResponderController.SendPttMessage — text-to-radio via RealPTT. */
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const { user, deny } = await requireAuth('ptt');
  if (deny) return deny;
  const role = (user!.app_metadata?.role ?? 'Viewer') as UserRole;
  if (!DISPATCH_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!isPttConfigured()) return unconfigured('RealPTT', 'REALPTT_ACCOUNT / REALPTT_PASSWORD');

  const { account, text } = (await req.json()) as { account?: string; text?: string };
  if (!account || !text) {
    return NextResponse.json({ error: 'account and text required' }, { status: 400 });
  }

  // V4 sender format: email local-part, capitalised.
  const raw = (user!.user_metadata?.full_name as string | undefined) ?? user!.email ?? 'Dispatch';
  const senderName = (raw.includes('@') ? raw.split('@')[0]! : raw).replace(/^./, (c) => c.toUpperCase());

  try {
    const result = await sendPttMessage(account, senderName, text);
    if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: 200 });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 502 });
  }
}
