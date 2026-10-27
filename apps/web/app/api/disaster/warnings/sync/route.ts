import { NextResponse } from 'next/server';
import { currentTenant } from '@criticom/api';
import { getServerSupabase } from '@/lib/supabase';
import { syncSawsWarnings } from '@/lib/saws-sync';

/**
 * The desk's open screens ask every five minutes for any new SA Weather
 * Service warning (0116). Only someone who works the Disaster desk sets the
 * reader going; it reads the feed at most once every five minutes however
 * many ask. Answers { forUs }: new warning files for eThekwini, so the
 * screen knows to refresh.
 */
export const dynamic = 'force-dynamic';

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;

export async function POST() {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });
  const { data: desk } = await (supabase.rpc as unknown as Rpc)('works_disaster_desk', {});
  if (desk !== true) return NextResponse.json({ forUs: 0 });
  const tenant = await currentTenant(supabase);
  if (!tenant) return NextResponse.json({ forUs: 0 });
  const res = await syncSawsWarnings(tenant);
  return NextResponse.json({ forUs: res.forUs, ok: res.ok });
}
