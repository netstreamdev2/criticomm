import { NextResponse, type NextRequest } from 'next/server';
import { REPORT_STANDINGS, STANDING_TONE, filterReports, formsOf, logAudit, reportKind, reportStats, reportWindow } from '@criticom/api';
import { saDate } from '@criticom/db';
import { enforceRateLimit } from '@/lib/rate-limit';
import { ReportPdf } from '@/lib/pdf';
import { loadPdfBrand } from '@/lib/pdf-brand';
import { describeFilters, loadReportCentre, readReportQuery } from '@/lib/police-reports';
import { formatSaTime } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * The specialised report as a PDF: what it covers, its totals, each form,
 * the stations and officers, and every report in it, under the police badge
 * and the municipality's crest. Same reports as the page; audited.
 */
export async function GET(request: NextRequest) {
  const { supabase, user, fullName, records } = await loadReportCentre();
  const limited = await enforceRateLimit(supabase, 'pdf');
  if (limited) return limited;

  const query = readReportQuery(Object.fromEntries(
    [...request.nextUrl.searchParams.keys()].map((k) => [k, request.nextUrl.searchParams.getAll(k)]),
  ));
  const rows = filterReports(records, query);
  const { now, days } = reportWindow(query);
  const s = reportStats(rows, now, days);
  const chosen = new Set(query.forms ?? (query.form ? [query.form] : []));

  const pdf = await ReportPdf.create(
    'Police Specialised Report',
    `${describeFilters(query)} · prepared by ${fullName} · ${formatSaTime(new Date())}`,
    await loadPdfBrand(supabase, { police: true }),
  );

  pdf.section('Totals');
  pdf.tiles([
    { label: 'Reports', value: s.total, tone: '#d946ef' },
    ...REPORT_STANDINGS.map((k) => ({ label: k, value: s.byStanding[k], tone: STANDING_TONE[k] })),
    { label: 'Arrests', value: s.arrests, tone: '#ef4444' },
  ]);

  pdf.section('By form');
  pdf.bars(s.byKind
    .filter((k) => (chosen.size ? chosen.has(k.id) : k.count > 0))
    .map((k) => ({ label: `${k.code} ${k.label}`, value: k.count, tone: k.tone })));

  if (s.byStation.length) {
    pdf.section('Stations');
    pdf.bars(s.byStation.map((x) => ({ label: x.name, value: x.count, tone: '#6366f1' })));
  }
  if (s.byOfficer.length) {
    pdf.section('Officers');
    pdf.bars(s.byOfficer.map((x) => ({ label: x.name, value: x.count, tone: '#06b6d4' })));
  }

  pdf.section(`The reports (${rows.length})`);
  pdf.table(
    [
      { label: 'Case number', width: 3 }, { label: 'Forms', width: 2.4 }, { label: 'Officer', width: 3 },
      { label: 'Station', width: 2.4 }, { label: 'Call', width: 3.2 }, { label: 'Filed', width: 2.8 }, { label: 'Status', width: 2.4 },
    ],
    rows.map((r) => ({
      tone: reportKind(formsOf(r)[0]!)?.tone,
      cells: [
        r.caseNumber, formsOf(r).map((id) => reportKind(id)?.code ?? id).join(' + '), r.officer, r.station,
        r.incidentNumber, formatSaTime(r.at), r.standing,
      ],
    })),
  );

  await logAudit(supabase, {
    silo: 'MetroPolice', user_id: user.id, user_name: fullName,
    action_type: 'PoliceReportsExported', entity_type: 'metro_report',
    details: `PDF · ${rows.length} reports${request.nextUrl.search ? ` · ${request.nextUrl.search}` : ''}`,
  }).catch(() => {});

  const bytes = await pdf.bytes();
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="police-specialised-report-${saDate(new Date())}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
