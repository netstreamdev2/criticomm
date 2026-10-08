import { NextResponse, type NextRequest } from 'next/server';
import { getFine, listNoticeCharges } from '@criticom/api';
import { buildFineSlipHtml, slipFromFines } from '@criticom/db';
import { requireFeatureApi } from '@/lib/features';
import { getServerSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/** Above the slip on screen only: print, and back to the notice. */
const TOOLBAR = `
<style>
  .bar { max-width: 186mm; margin: 12px auto; display: flex; gap: 8px; justify-content: flex-end; font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; }
  .bar button, .bar a { font: inherit; font-size: 13px; font-weight: 700; padding: 8px 14px; border-radius: 6px; border: 1px solid #0f172a; background: #0f172a; color: #fff; cursor: pointer; text-decoration: none; }
  .bar a { background: #fff; color: #0f172a; }
  @media print { .bar { display: none; } }
</style>`;

/**
 * The slip as the infringer holds it, for printing from the console. The
 * same builder as the phone's, so the paper never differs. RLS decides
 * whether this fine is visible; the middleware has already checked the route.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const refused = await requireFeatureApi('web.enforcement');
  if (refused) return refused;

  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL(`/login?next=/police/fines/${encodeURIComponent(id)}/slip`, request.url));
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse('Not found.', { status: 404 });

  const fine = await getFine(supabase, id).catch(() => null);
  if (!fine) return new NextResponse('Fine not found, or not yours to see.', { status: 404 });
  const charges = await listNoticeCharges(supabase, fine);

  const html = buildFineSlipHtml(slipFromFines(charges)).replace(
    '<body>',
    `<body>${TOOLBAR}<div class="bar"><a href="/police/fines/${fine.id}">Back to the notice</a><button type="button" onclick="window.print()">Print</button></div>`,
  );
  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
