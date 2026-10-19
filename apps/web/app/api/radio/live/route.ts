import { NextResponse } from 'next/server';
import { canAccess, type Silo, type UserRole } from '@criticom/db';
import { requireFeatureApi } from '@/lib/features';
import { loadRadioDesk } from '@/lib/radio';
import { getServerSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/** The radio desk's live picture, refreshed by the page every 15 seconds. Same people as the desk itself. */
export async function GET() {
  const off = await requireFeatureApi('web.ptt');
  if (off) return off;
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = (user.app_metadata?.role ?? 'Viewer') as UserRole;
  const silo = (user.app_metadata?.silo ?? 'Ethekwini') as Silo;
  if (!canAccess('/dispatch/ptt', role, silo)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(await loadRadioDesk(supabase), { headers: { 'Cache-Control': 'private, no-store' } });
}
