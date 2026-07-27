import { NextResponse } from 'next/server';
import { listAllIncidents } from '@criticom/api';
import type { IncidentStatus, Silo } from '@criticom/db';
import { getServerSupabase } from '@/lib/supabase';

/** ReportHubController export=csv — the filtered incident set. */
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
  const rows = await listAllIncidents(supabase, {
    silo: (sp.get('silo') as Silo) || undefined,
    status: (sp.get('status') as IncidentStatus) || undefined,
    search: sp.get('q') || undefined,
    limit: 100000,
  });

  const category = sp.get('category');
  const region = sp.get('region');
  const from = sp.get('from');
  const to = sp.get('to');
  const filtered = rows.filter((r) => {
    if (category && r.incident_category !== category) return false;
    if (region && r.region !== region) return false;
    if (from && r.incident_created_at < from) return false;
    if (to && r.incident_created_at > `${to}T23:59:59`) return false;
    return true;
  });

  const headers = [
    'Incident #', 'Created', 'Silo', 'Category', 'Type', 'Region', 'Severity', 'Status',
    'Caller', 'Caller number', 'Location', 'Suburb', 'Operator', 'Dispatcher', 'Responding officer',
    'Dispatched at', 'Closed at',
  ];
  const lines = [headers.join(',')];
  for (const i of filtered) {
    lines.push([
      i.incident_number, i.incident_created_at, i.silo, i.incident_category ?? '', i.incident_type,
      i.region ?? '', i.incident_severity, i.status, i.caller_name, i.caller_number,
      i.location_address, i.suburb ?? '', i.call_taken_by ?? '', i.dispatched_by ?? '',
      i.responding_officer ?? '', i.dispatch_time ?? '', i.closed_at ?? '',
    ].map(csvCell).join(','));
  }

  return new NextResponse(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="report-hub-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
