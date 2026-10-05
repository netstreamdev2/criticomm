import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse, type NextRequest } from 'next/server';
import { ADMIN_ROLES, type UserRole } from '@criticom/db';
import { findHandbookPage, renderHandbookPage } from '@/lib/handbook';
import { getServerSupabase } from '@/lib/supabase';
import { DEFAULT_THEME, THEME_STORAGE_KEY, THEMES } from '@/lib/themes';

export const dynamic = 'force-dynamic';

/**
 * One handbook page, for administrators only (SuperAdmin, SystemAdmin,
 * Admin). The middleware already refuses everyone else; this checks again so
 * the page never depends on a single gate.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const login = new URL('/login', request.url);
    login.searchParams.set('next', `/admin/handbook/${slug}`);
    return NextResponse.redirect(login);
  }
  const role = (user.app_metadata?.role ?? 'Viewer') as UserRole;
  if (!ADMIN_ROLES.includes(role) || user.app_metadata?.deactivated === true) {
    return NextResponse.redirect(new URL('/403', request.url));
  }

  const page = findHandbookPage(slug);
  if (!page) return new NextResponse('No such handbook page.', { status: 404 });

  const fragment = await readFile(path.join(process.cwd(), 'handbook', page.file), 'utf8');
  const html = renderHandbookPage(fragment, {
    themeKey: THEME_STORAGE_KEY,
    defaultTheme: DEFAULT_THEME,
    lightThemes: THEMES.filter((t) => t.mode === 'light').map((t) => t.id),
  });

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
