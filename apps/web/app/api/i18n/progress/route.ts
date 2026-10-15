import { NextResponse } from 'next/server';
import { TARGET_LANGS } from '@criticom/db/i18n';
import { SOURCE } from '@criticom/db/i18n/source';
import { getServerSupabase } from '@/lib/supabase';

/**
 * How much of each language is approved, for the language menu:
 * { total, approved: { zu: 120, … } }. Signed in only.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });
  const keys = new Set(SOURCE.map((e) => e.key));
  const approved: Record<string, number> = {};
  await Promise.all(TARGET_LANGS.map(async (lang) => {
    const { count } = await supabase.from('translations').select('key', { count: 'exact', head: true })
      .eq('lang', lang).eq('status', 'approved');
    approved[lang] = Math.min(count ?? 0, keys.size);
  }));
  return NextResponse.json({ total: keys.size, approved });
}
