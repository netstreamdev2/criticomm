import { getHrAnalytics } from '@criticom/api';
import { canAccess } from '@criticom/db/roles';
import type { Silo, UserRole } from '@criticom/db/types';
import { getServerSupabase } from '@/lib/supabase';

/**
 * CSV exports for the performance reports centre.
 *   GET /api/hr/report.csv?kind=member|department|incident&from=&to=
 */
export const dynamic = 'force-dynamic';

const esc = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const line = (cells: unknown[]) => cells.map(esc).join(',');

export async function GET(req: Request) {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });

  const role = (user.app_metadata?.role ?? 'Viewer') as UserRole;
  const silo = (user.app_metadata?.silo ?? 'Ethekwini') as Silo;
  if (!canAccess('/performance/reports', role, silo)) {
    return new Response('Forbidden', { status: 403 });
  }

  const url = new URL(req.url);
  const kind = url.searchParams.get('kind') ?? 'member';
  const today = new Date().toISOString().slice(0, 10);
  const from = url.searchParams.get('from') ?? new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
  const to = url.searchParams.get('to') ?? today;

  const report = await getHrAnalytics(supabase, {
    from, to, silo: silo === 'Ethekwini' ? undefined : silo,
  });

  let rows: string[];
  switch (kind) {
    case 'department':
      rows = [
        line(['Department', 'Incidents', 'Closed', 'ClosureRatePct', 'Critical', 'AvgCloseMins', 'Headcount', 'OnDutyNow', 'LeaveDaysApproved']),
        ...report.departments.map((r) =>
          line([r.silo, r.total, r.closed, r.closureRate, r.critical, r.avgCloseMins ?? '', r.headcount, r.onDutyNow, r.leaveDaysApproved])),
      ];
      break;
    case 'incident':
      rows = [
        line(['IncidentType', 'Total', 'Low', 'Medium', 'High', 'Critical', 'Closed', 'AvgCloseMins']),
        ...report.incidentTypes.map((r) =>
          line([r.type, r.total, r.low, r.medium, r.high, r.critical, r.closed, r.avgCloseMins ?? ''])),
      ];
      break;
    default:
      rows = [
        line(['Member', 'CallsTaken', 'Dispatches', 'Responded', 'Closed', 'AvgCloseMins', 'LeaveDays']),
        ...report.members.map((r) =>
          line([r.name, r.callsTaken, r.dispatches, r.responded, r.closed, r.avgCloseMins ?? '', r.leaveDays])),
      ];
  }

  return new Response(`﻿${rows.join('\r\n')}\r\n`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="criticomm-${kind}-report-${from}-to-${to}.csv"`,
    },
  });
}
