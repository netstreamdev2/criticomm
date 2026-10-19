import { NextResponse, type NextRequest } from 'next/server';
import { filterReports, logAudit, reportsCsv } from '@criticom/api';
import { saDate } from '@criticom/db';
import { loadReportCentre, readReportQuery } from '@/lib/police-reports';

export const dynamic = 'force-dynamic';

/**
 * The police reports as CSV, filtered exactly as on screen. The database
 * decides which reports are in it; every export goes to the audit trail.
 */
export async function GET(request: NextRequest) {
  const { supabase, user, fullName, records } = await loadReportCentre();
  const query = readReportQuery(Object.fromEntries(
    [...request.nextUrl.searchParams.keys()].map((k) => [k, request.nextUrl.searchParams.getAll(k)]),
  ));
  const rows = filterReports(records, query);

  await logAudit(supabase, {
    silo: 'MetroPolice', user_id: user.id, user_name: fullName,
    action_type: 'PoliceReportsExported', entity_type: 'metro_report',
    details: `CSV · ${rows.length} reports${request.nextUrl.search ? ` · ${request.nextUrl.search}` : ''}`,
  }).catch(() => {});

  return new NextResponse(`﻿${reportsCsv(rows)}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="police-reports-${saDate(new Date())}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
