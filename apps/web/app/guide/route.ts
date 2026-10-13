import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { PUBLIC_GUIDES, guideIndexFragment, renderHandbookPage } from '@/lib/handbook';
import { DEFAULT_THEME, THEME_STORAGE_KEY, THEMES } from '@/lib/themes';

export const dynamic = 'force-static';

/**
 * The public guides: how a call travels through HikTech, one guide per
 * department. Example data only, so no sign-in; the administrators'
 * handbook stays at /admin/handbook.
 */
export async function GET() {
  const first = PUBLIC_GUIDES[0];
  const style = first ? await readFile(path.join(process.cwd(), 'handbook', first.file), 'utf8') : '';
  const html = renderHandbookPage(guideIndexFragment(style, PUBLIC_GUIDES), {
    themeKey: THEME_STORAGE_KEY,
    defaultTheme: DEFAULT_THEME,
    lightThemes: THEMES.filter((t) => t.mode === 'light').map((t) => t.id),
    audience: 'public',
  });
  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  });
}
