import { NextResponse, type NextRequest } from 'next/server';
import { listFines, logAudit, paidByFine } from '@criticom/api';
import { canViewAllFines, saDate, type Silo, type UserRole } from '@criticom/db';
import { requireFeatureApi } from '@/lib/features';
import { byOfficer, finesCsv, readFineQuery, toFineFilters } from '@/lib/fines';
import { getServerSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * The register as CSV, filtered exactly as on screen. RLS decides which rows
 * are in it; ID numbers are masked except for command staff, and every
 * export is written to the audit trail — it carries personal information.
 */
export async function GET(request: NextRequest) {
  const refused = await requireFeatureApi('web.enforcement');
  if (refused) return refused;

  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login?next=/police/fines', request.url));
  const role = (user.app_metadata?.role ?? 'Viewer') as UserRole;
  const silo = (user.app_metadata?.silo ?? 'Ethekwini') as Silo;

  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const query = readFineQuery(params);
  try {
    const rows = byOfficer(await listFines(supabase, toFineFilters(query, user.id, 5000)), query.officer);
    const paid = await paidByFine(supabase, rows.map((r) => r.id)).catch(() => new Map<string, number>());
    const command = canViewAllFines({ role, silo });
    const csv = finesCsv(rows, paid, { fullIds: command });

    await logAudit(supabase, {
      silo: 'MetroPolice', user_id: user.id, user_name: (user.user_metadata?.full_name as string | undefined) ?? user.email ?? null,
      action_type: 'FinesExported', entity_type: 'fine',
      details: `${rows.length} rows${request.nextUrl.search ? ` · ${request.nextUrl.search}` : ''}`,
    }).catch(() => {});

    return new NextResponse(`﻿${csv}`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="fines-${saDate(new Date())}.csv"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    return new NextResponse((e as Error).message ?? 'The export failed.', { status: 500 });
  }
}
