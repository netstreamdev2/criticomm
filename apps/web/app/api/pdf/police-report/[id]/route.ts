import { NextResponse } from 'next/server';
import { getMetroReport, getReportForm, getReportType, reportReadout } from '@criticom/api';
import { getServerSupabase } from '@/lib/supabase';
import { enforceRateLimit } from '@/lib/rate-limit';
import { ReportPdf } from '@/lib/pdf';
import { loadPdfBrand } from '@/lib/pdf-brand';
import { formatSaTime } from '@/lib/utils';

/**
 * One police report as a PDF: the case report, then each DMPS form it
 * carries in that form's colour, under the police badge and the
 * municipality's crest. Read with the person's own session: a report they
 * may not read is not found.
 */
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const limited = await enforceRateLimit(supabase, 'pdf');
  if (limited) return limited;

  const r = await getMetroReport(supabase, id).catch(() => null);
  if (!r) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const type = r.report_type ? getReportType(r.report_type) : null;
  const pdf = await ReportPdf.create(
    `Police Report - ${r.case_number}`,
    `${type?.label ?? r.incident_category ?? 'Case report'} · ${r.date_of_offense} ${r.time_of_offense ?? ''} · filed ${formatSaTime(r.created_at)}`,
    await loadPdfBrand(supabase, { police: true }),
  );

  pdf.badges([
    { text: 'Case report', tone: '#3b82f6' },
    ...(type?.forms ?? []).map((f) => ({ text: `${f.code} ${f.label}`, tone: f.tone })),
  ]);

  pdf.section('Report');
  pdf.field('Location', r.location);
  pdf.field('Station', r.station);
  pdf.field('Officer', [r.officer_name, r.badge_number].filter(Boolean).join(' · '));
  pdf.field('Partner', r.partner_name);
  pdf.field('Bodycam', r.bodycam_active);
  pdf.field('Use of force', r.use_of_force);
  pdf.field('Offender', r.offender_name);
  pdf.field('Ticket #', r.ticket_number);
  pdf.field('Total fine', r.fine_amount ? `R${r.fine_amount}` : null);
  pdf.field('Vehicle', [r.vehicle_make, r.license_plate].filter(Boolean).join(' · '));
  pdf.field('VIN', r.vin_number);
  pdf.field('Impounded', r.vehicle_impounded === 'Yes' ? `Yes - ${r.impound_lot ?? 'lot n/a'}` : r.vehicle_impounded);
  pdf.field('Arrest made', r.arrest_made);
  pdf.field('Suspect', r.suspect_name);
  pdf.field('Charges', r.charges);
  pdf.field('Victim', r.victim_name);
  pdf.field('Victim injuries', r.victim_injuries);
  pdf.field('Weapon', r.weapon_type ? `${r.weapon_type} ${r.weapon_size ?? ''}` : null);
  pdf.field('Contraband', r.contraband_seized);
  pdf.field('Evidence', [r.evidence_weapons && 'weapons', r.evidence_drugs && 'drugs', r.evidence_property && 'property']
    .filter(Boolean).join(', ') || null);

  // The DMPS forms' answers, section by section, each in its form's colour.
  const SHARED = new Set(['Response', 'Outcome', 'Evidence']);
  const readout = type
    ? reportReadout(type, r as unknown as Record<string, unknown> & { details?: Record<string, unknown> | null })
    : null;
  for (const s of readout?.sections.filter((x) => !SHARED.has(x.title)) ?? []) {
    pdf.section(s.title);
    const tone = s.form ? getReportForm(s.form)?.tone : undefined;
    if (tone) pdf.subheading(getReportForm(s.form!)?.label ?? s.title, tone);
    for (const i of s.items) pdf.field(i.label, i.value);
  }
  if (readout?.extra.length) {
    pdf.section('Other answers');
    for (const i of readout.extra) pdf.field(i.label, i.value);
  }

  const offenses = (r as { offenses?: Array<{ offense_type: string; fine_amount: number }> }).offenses ?? [];
  if (offenses.length) {
    pdf.section('Itemised offenses');
    pdf.table([{ label: 'Offense', width: 4 }, { label: 'Fine', width: 1 }],
      offenses.map((o) => ({ cells: [o.offense_type, `R${o.fine_amount}`] })));
  }

  if (r.officer_narrative) {
    pdf.section('Narrative');
    pdf.paragraph('Officer narrative', r.officer_narrative);
  }

  const bytes = await pdf.bytes();
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="police-report-${String(r.case_number).replace(/[^\w.-]+/g, '_')}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
