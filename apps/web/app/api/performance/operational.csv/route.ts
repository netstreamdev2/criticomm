import { NextResponse } from 'next/server';
import { getOperationalKpis } from '@criticom/api';
import { getServerSupabase } from '@/lib/supabase';

/** PerformanceController.ExportOperational — full call-detail CSV. */
export const dynamic = 'force-dynamic';

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: Request) {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp = new URL(req.url).searchParams;
  const from = sp.get('from') ?? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to = sp.get('to') ?? new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  const kpi = await getOperationalKpis(supabase, {
    from, to,
    department: sp.get('dept') ?? undefined,
    region: sp.get('region') ?? undefined,
    detailLimit: 100000, // full set for export
  });

  const headers = [
    'Incident #', 'Date', 'Category', 'Sub-category', 'Caller', 'Region',
    'Operator', 'Dispatcher', 'Responding officer', 'Status', 'Dispatch (min)', 'Resolution (min)',
  ];
  const lines = [headers.join(',')];
  for (const r of kpi.callDetail) {
    lines.push([
      r.incidentNumber, r.incidentDate, r.category, r.subCategory, r.callerName, r.region,
      r.operator, r.dispatcher, r.respondingOfficer, r.status,
      r.dispatchMinutes ?? '', r.resolutionMinutes ?? '',
    ].map(csvCell).join(','));
  }

  return new NextResponse(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="operational-kpis-${from}_${to}.csv"`,
    },
  });
}
