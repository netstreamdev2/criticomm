import { NextResponse } from 'next/server';
import {
  casualtyCounts, getCallFacts, getDeskRecord, getIncident, getIncidentUpdates, getPostMortemForIncident, listCallShelters,
  listCasualties, listDisasterSms, listLineReports, listShelters,
} from '@criticom/api';
import { hazardGroup } from '@criticom/db/disaster-plan';
import { lineFunction } from '@criticom/db/disaster-departments';
import { getServerSupabase } from '@/lib/supabase';
import { enforceRateLimit } from '@/lib/rate-limit';
import { ReportPdf } from '@/lib/pdf';
import { loadPdfBrand } from '@/lib/pdf-brand';
import { latestFigures } from '@/lib/disaster-desk';
import { formatSaTime } from '@/lib/utils';

/**
 * The Official After-Action Report for a Disaster incident (0113), as the
 * MDMC keeps it: the incident as the Plan names it, the impact, the command
 * and co-ordination, who was called out and when, each department's part,
 * the reception centres, the casualties, the analysis and the timeline.
 * Read with the person's own sign-in: what they may not see stays out
 * (casualties' personal details only for the Disaster desk and command).
 */
export const dynamic = 'force-dynamic';

const sa = (d: string | null | undefined) => (d ? formatSaTime(d) : '—');
const RELIEF: Record<string, string> = { hot_meals: 'hot meals', blankets: 'blankets', mattresses: 'mattresses', food_parcels: 'food parcels', hygiene_packs: 'hygiene packs', clothing: 'clothing' };

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const limited = await enforceRateLimit(supabase, 'pdf');
  if (limited) return limited;

  const incident = await getIncident(supabase, id).catch(() => null);
  if (!incident) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const [facts, record, pm, reports, openings, halls, people, counts, sms, updates] = await Promise.all([
    getCallFacts(supabase, id), getDeskRecord(supabase, id), getPostMortemForIncident(supabase, id).catch(() => null),
    listLineReports(supabase, id), listCallShelters(supabase, id), listShelters(supabase, true), listCasualties(supabase, id),
    casualtyCounts(supabase, id), listDisasterSms(supabase, id), getIncidentUpdates(supabase, id).catch(() => []),
  ]);
  const figures = latestFigures(record.updates);
  const hall = new Map(halls.map((h) => [h.id, h]));
  const title = facts?.short_title || incident.disaster_type || incident.incident_type;

  const pdf = await ReportPdf.create(
    `Official After-Action Report: ${incident.incident_number}`,
    `${title} · ${facts?.hazard ?? incident.incident_type} · ${pm ? `Filed ${sa(pm.report_filed_at)}` : 'Not filed yet'}`,
    await loadPdfBrand(supabase, {}),
  );

  pdf.section('The incident');
  pdf.field('Title', title);
  pdf.field('Hazard', facts?.hazard ? `${facts.hazard} (${hazardGroup(facts.hazard) ?? ''})` : null);
  pdf.field('Severity', incident.incident_severity);
  pdf.field('Location', [incident.location_address, incident.suburb].filter(Boolean).join(', '));
  pdf.field('Ward', facts?.ward ?? null);
  pdf.field('Municipalities affected', (facts?.municipalities ?? []).join(', ') || null);
  pdf.field('Reported through', facts?.reported_through ?? 'EMACC call');
  pdf.field('Reported', sa(incident.call_timestamp));
  pdf.field('Start time', pm?.start_time ? sa(pm.start_time) : null);
  pdf.field('Resolved time', pm?.end_time ? sa(pm.end_time) : null);
  pdf.field('Duration (hours)', pm?.total_duration_hours ?? null);

  pdf.section('Impact');
  pdf.tiles([
    { label: 'Injured', value: Math.max(pm?.injuries ?? 0, figures.injured ?? 0, counts.injured), tone: '#d97706' },
    { label: 'Fatalities', value: Math.max(pm?.fatalities ?? 0, figures.dead ?? 0, counts.deceased), tone: '#dc2626' },
    { label: 'Missing', value: Math.max(figures.missing ?? 0, counts.missing), tone: '#2563eb' },
    { label: 'Displaced', value: Math.max(pm?.displaced_people ?? 0, figures.people_evacuated ?? 0), tone: '#7c3aed' },
  ]);
  pdf.field('Households affected', pm?.households_affected ?? figures.households_affected ?? null);
  pdf.field('Homes destroyed', pm?.homes_destroyed ?? null);
  pdf.field('Homes damaged', pm?.homes_damaged ?? null);
  pdf.field('People sheltered (most at once)', pm?.people_sheltered ?? openings.reduce((n, o) => n + o.peak_people, 0));
  pdf.field('People helped', figures.people_helped ?? null);

  pdf.section('Command, control and co-ordination');
  pdf.field('Highest level', facts?.highest_level ?? 'Bronze');
  pdf.field('DOC activated', facts?.doc_activated_at ? sa(facts.doc_activated_at) : 'No');
  pdf.field('SCG in session', facts?.scg_convened_at ? sa(facts.scg_convened_at) : 'No');
  pdf.field('Forward Control Point (FCP)', facts?.fcp_location ?? null);
  pdf.field('Emergency Operations Centre (EOC)', facts?.eoc_location ?? null);
  pdf.field('Local state of disaster recommended', pm ? (pm.local_disaster_recommended ? 'Yes' : 'No') : null);

  if (record.callouts.length) {
    pdf.section(`Called out (${record.callouts.length})`);
    pdf.table(
      [{ label: 'Who', width: 150 }, { label: 'How', width: 55 }, { label: 'Called', width: 85 }, { label: 'On scene', width: 85 }, { label: 'Left', width: 85 }],
      record.callouts.map((c) => ({ cells: [c.agency_name, c.how, sa(c.called_at), c.on_scene_at ? sa(c.on_scene_at) : '—', c.left_at ? sa(c.left_at) : '—'] })),
    );
  }

  if (reports.length) {
    pdf.section(`Departments (${reports.length})`);
    for (const r of reports) {
      const d = lineFunction(r.department);
      pdf.subheading(`${d?.name ?? r.department}: ${r.status}`);
      pdf.field('DOC representative', r.representative_name ? `${r.representative_name}${r.representative_post ? `, ${r.representative_post}` : ''}${r.at_doc ? ' (at the DOC)' : ''}` : null);
      for (const [i, role] of (d?.roles ?? []).entries()) {
        const state = r.duties?.[String(i)];
        if (state) pdf.text(`• ${state}: ${role}`);
      }
      for (const fig of d?.figures ?? []) {
        if (r.figures?.[fig.key] != null) pdf.field(fig.label, r.figures[fig.key]);
      }
      if (r.notes) pdf.paragraph('Notes', r.notes);
    }
  }

  if (openings.length) {
    pdf.section(`Reception centres (${openings.length})`);
    for (const o of openings) {
      const h = hall.get(o.shelter_id);
      pdf.subheading(h?.name ?? 'Shelter');
      pdf.field('Opened · closed', `${sa(o.opened_at)} · ${o.closed_at ? sa(o.closed_at) : 'still open'}`);
      pdf.field('Most at once', `${o.peak_people}${h?.capacity ? ` of ${h.capacity}` : ''}`);
      pdf.field('Households · children · elderly · disabled', `${o.households} · ${o.children} · ${o.elderly} · ${o.disabled}`);
      const relief = Object.entries(o.relief ?? {}).map(([k, v]) => `${v} ${RELIEF[k] ?? k}`).join(', ');
      pdf.field('Relief handed out', relief || null);
      pdf.field('Supplies', [o.food ? `food ${o.food.toLowerCase()}` : null, o.water ? `water ${o.water.toLowerCase()}` : null,
        o.toiletries ? `toiletries ${o.toiletries.toLowerCase()}` : null, `${o.toilets ?? 0} toilets`, `${o.temporary_toilets ?? 0} temporary toilets`].filter(Boolean).join(', '));
    }
  }

  pdf.section('Casualties');
  pdf.field('Injured · deceased · missing (recorded)', `${counts.injured} · ${counts.deceased} · ${counts.missing}`);
  if (people && people.length) {
    pdf.text('CONFIDENTIAL: personal information (POPIA). Not for distribution.');
    pdf.table(
      [{ label: 'Kind', width: 60 }, { label: 'Name or description', width: 190 }, { label: 'Condition / taken to', width: 140 }, { label: 'Contact', width: 70 }],
      people.map((p) => ({ cells: [p.kind, p.name || p.description || 'Not identified', [p.condition, p.taken_to].filter(Boolean).join(' · ') || '—', p.phone ?? '—'] })),
    );
  }

  if (pm) {
    pdf.section('Operational analysis');
    pdf.paragraph('Root cause analysis', pm.root_cause);
    pdf.paragraph('Lessons learned / recommendations', pm.lessons_learned);
    pdf.field('Reporting officer', pm.reporting_officer);
  }

  if (sms.length) {
    pdf.section(`SMS sent (${sms.length})`);
    for (const m of sms) pdf.text(`• [${sa(m.sent_at)}] ${m.status} to ${m.to_name ?? m.to_number}: ${m.body}`);
  }

  if (updates.length) {
    pdf.section(`Timeline (${updates.length})`);
    for (const u of [...updates].reverse()) pdf.text(`• [${sa(u.timestamp)}] ${u.message}`);
  }

  const bytes = await pdf.bytes();
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="after-action-${incident.incident_number}.pdf"`,
    },
  });
}
