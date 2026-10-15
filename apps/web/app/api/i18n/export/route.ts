import { NextResponse } from 'next/server';
import { isLang } from '@criticom/db/i18n';
import { SOURCE } from '@criticom/db/i18n/source';
import { getServerSupabase } from '@/lib/supabase';

/**
 * A language's approved translations as the file the apps carry
 * (packages/db/src/i18n/locales/<lang>.ts), so the phone has them offline.
 * Translators and administrators only. Sentences the apps no longer show are
 * left out.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const lang = new URL(req.url).searchParams.get('lang');
  if (!isLang(lang) || lang === 'en') return NextResponse.json({ error: 'Choose a language.' }, { status: 400 });
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });
  const { data: may } = await supabase.rpc('can_edit_translations', { p_lang: lang });
  if (may !== true) return NextResponse.json({ error: 'Only translators and administrators download translations.' }, { status: 403 });

  const keys = new Set(SOURCE.map((e) => e.key));
  const approved: Record<string, string> = {};
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('translations').select('key, text')
      .eq('lang', lang).eq('status', 'approved').order('key').range(from, from + 999);
    if (error || !data) break;
    for (const r of data as Array<{ key: string; text: string }>) if (keys.has(r.key)) approved[r.key] = r.text;
    if (data.length < 1000) break;
  }
  const body = `/**
 * Approved translations (${lang}). Written by Admin → Translations → Download
 * approved file; only approved sentences belong here. The key is the English.
 */
const dictionary: Record<string, string> = ${JSON.stringify(approved, null, 2)};
export default dictionary;
`;
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${lang}.ts"`,
      'Cache-Control': 'no-store',
    },
  });
}
