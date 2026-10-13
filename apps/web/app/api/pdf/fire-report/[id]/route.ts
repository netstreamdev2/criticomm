import { NextResponse } from 'next/server';
import { getFirefighterReport } from '@criticom/api';
import { getServerSupabase } from '@/lib/supabase';
import { enforceRateLimit } from '@/lib/rate-limit';
import { ReportPdf } from '@/lib/pdf';
import { loadPdfBrand } from '@/lib/pdf-brand';

/** FirefightersController.DownloadPdf — fire incident report PDF. */
export const dynamic = 'force-dynamic';

const min = (s: number) => (s > 0 ? `${Math.round(s / 60)} min` : null);
const rand = (v: number) => (v > 0 ? `R ${Number(v).toLocaleString()}` : null);

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Same cost profile as the case report.
  const limited = await enforceRateLimit(supabase, 'pdf');
  if (limited) return limited;

  const r = await getFirefighterReport(supabase, id).catch(() => null);
  if (!r) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const pdf = await ReportPdf.create(
    `Fire Incident Report — ${r.report_number}`,
    `${r.date_of_incident} ${r.time_of_incident} · ${r.type_of_incident ?? ''} · ${r.fire_department_name ?? ''}`,
    await loadPdfBrand(supabase),
  );

  pdf.section('Incident');
  pdf.field('Location', r.location);
  pdf.field('Station', r.station_number);
  pdf.field('Dispatch', min(r.dispatch_time_seconds));
  pdf.field('Arrival', min(r.arrival_time_seconds));
  pdf.field('Clear', min(r.clear_time_seconds));
  pdf.field('Total on scene', min(r.total_time_on_scene_seconds));

  pdf.section('Scene & operations');
  pdf.field('Smoke', r.smoke_conditions);
  pdf.field('Flame spread', r.flame_spread);
  pdf.field('Heat', r.heat_signature);
  pdf.paragraph('Initial observations', r.initial_observations);
  pdf.paragraph('Hazards', r.hazards_identified);
  pdf.paragraph('Suppression', r.fire_suppression_details);
  pdf.field('Search & rescue', r.search_and_rescue_performed ? `Yes — ${r.persons_rescued} rescued` : 'No');
  pdf.field('Ventilation', r.ventilation_conducted ? (r.ventilation_type ?? 'Yes') : 'No');
  pdf.field('Hazmat', r.hazmat_operations ? (r.hazmat_description ?? 'Yes') : 'No');
  pdf.field('Utilities secured', r.utilities_secured ? (r.utility_details ?? 'Yes') : 'No');

  pdf.section('Origin, cause & property');
  pdf.field('Origin', [r.point_of_origin_room, r.point_of_origin_object].filter(Boolean).join(' / '));
  pdf.field('Ignition source', r.ignition_source);
  pdf.field('Cause', r.fire_cause);
  pdf.field('Investigation', r.fire_investigation_conducted ? (r.fire_investigation_reason ?? 'Yes') : 'No');
  pdf.field('Property type', r.property_type);
  pdf.field('Owner', r.property_owner);
  pdf.field('Property value', rand(r.property_value));
  pdf.field('Damage estimate', rand(r.damage_estimate));
  pdf.field('Contents value', rand(r.contents_value));

  pdf.section('Casualties');
  pdf.field('Civilian injuries', r.civilian_injuries);
  pdf.field('Civilian fatalities', r.civilian_fatalities);
  pdf.field('Firefighter injuries', r.firefighter_injuries);
  pdf.field('Firefighter fatalities', r.firefighter_fatalities);
  pdf.paragraph('Injury details', r.civilian_injury_details);

  pdf.section('Review');
  pdf.paragraph('Challenges', r.challenges_faced);
  pdf.paragraph('Successes', r.successes);
  pdf.paragraph('Recommendations', r.recommendations);
  pdf.paragraph('Narrative summary', r.narrative_summary);

  pdf.section('Sign-off');
  pdf.field('Reporting officer', [r.reporting_officer_name, r.reporting_officer_rank].filter(Boolean).join(', '));
  pdf.field('Officer ID', r.reporting_officer_id);
  pdf.field('Submitted', r.report_submission_date);

  const bytes = await pdf.bytes();
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="fire-${r.report_number}.pdf"`,
    },
  });
}
