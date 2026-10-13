import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { findPublicGuide, renderHandbookPage } from '@/lib/handbook';
import { DEFAULT_THEME, THEME_STORAGE_KEY, THEMES } from '@/lib/themes';

/**
 * One public guide (example data only, no sign-in). Only the guides marked
 * public in the handbook register are served here, so an administrators'
 * page can never be reached through this route.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = findPublicGuide(slug);
  if (!page) return new NextResponse('No such guide.', { status: 404 });

  const fragment = await readFile(path.join(process.cwd(), 'handbook', page.file), 'utf8');
  const html = renderHandbookPage(fragment, {
    themeKey: THEME_STORAGE_KEY,
    defaultTheme: DEFAULT_THEME,
    lightThemes: THEMES.filter((t) => t.mode === 'light').map((t) => t.id),
    audience: 'public',
  });
  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  });
}
