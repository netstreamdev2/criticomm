import { NextResponse } from 'next/server';
import {
  DEPARTMENT_LABELS, departmentsOf, getFireReportForIncident, getPcrForIncident, getPostMortemForIncident, getIncident, getIncidentReport, getIncidentUpdates,
  getReportForm, getReportType, listAuditLogs, listIncidentAttachments, listIncidentEdits, listIncidentResponders, reportReadout,
} from '@criticom/api';
import { pcrReadout } from '@criticom/db/pcr';
import { callChannelText, patientText, readPatients } from '@criticom/db/call-facts';
import { defaultsFrom } from '@/lib/pcr-record';
import { asLogged, caseStage, catalogueType, detailLines, dispatchEditors, editKindName, editLines, sapsCategories } from '@criticom/db';
import { getServerSupabase } from '@/lib/supabase';
import { enforceRateLimit } from '@/lib/rate-limit';
import { ReportPdf } from '@/lib/pdf';
import { loadPdfBrand } from '@/lib/pdf-brand';
import { formatSaTime } from '@/lib/utils';

/**
 * CaseManagerController.DownloadReport — the official case report PDF: the
 * call, the response, the officer's filed report, how the case was closed,
 * the timeline, the evidence and the audit trail. Times are South African.
 */
export const dynamic = 'force-dynamic';

const sa = (d: string | null | undefined) => (d ? formatSaTime(d) : null);

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Rendering a case PDF downloads and embeds every scene photo — the most
  // expensive request this service serves.
  const limited = await enforceRateLimit(supabase, 'pdf');
  if (limited) return limited;

  const incident = await getIncident(supabase, id).catch(() => null);
  if (!incident) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const [updates, attachments, audit, report, fireReport, responders, pcr, postMortem, edits] = await Promise.all([
    getIncidentUpdates(supabase, id),
    listIncidentAttachments(supabase, id),
    // Console actions audit as 'incident', database functions as 'incidents':
    // the id alone finds both.
    listAuditLogs(supabase, { entityTypes: ['incident', 'incidents'], entityId: id, limit: 300 }).catch(() => []),
    getIncidentReport(supabase, id).catch(() => null),
    getFireReportForIncident(supabase, id).catch(() => null),
    listIncidentResponders(supabase, id).catch(() => []),
    getPcrForIncident(supabase, id).catch(() => null),
    getPostMortemForIncident(supabase, id).catch(() => null),
    // Each change since the call was logged, before and after (0079).
    listIncidentEdits(supabase, id),
  ]);

  const stage = caseStage(incident.status);
  const caseState = stage === 'closed'
    ? (incident.close_kind === 'Cancelled' ? 'Closed without a report' : incident.close_kind === 'Reviewed' ? 'Closed after review' : 'Closed')
    : stage === 'review' ? 'Awaiting review' : 'Live';
  const departments = departmentsOf(incident).map((d) => DEPARTMENT_LABELS[d] ?? d).join(', ');

  const pdf = await ReportPdf.create(
    `Case Report — ${incident.incident_number}`,
    `${departments} · ${incident.incident_type} · ${incident.incident_severity} · Status: ${incident.status} · Case: ${caseState}`,
    await loadPdfBrand(supabase),
  );

  pdf.section('Call details');
  pdf.field('Caller', `${incident.caller_name} (${incident.caller_number})`);
  pdf.field('Received', sa(incident.call_timestamp));
  pdf.field('Taken by', incident.call_taken_by);
  pdf.field('How the call came in', callChannelText(incident.call_channel, incident.call_channel_other));
  pdf.field('Category', [incident.incident_category, incident.incident_type].filter(Boolean).join(' · '));
  // The type's code and SAPS category, and the details the call taker filled in (0077).
  pdf.field('Incident code', incident.incident_code ?? null);
  pdf.field('SAPS category', sapsCategories(incident.incident_type, incident.details ?? {}).join(' or ') || null);
  pdf.field('Injuries', incident.injuries?.length ? incident.injuries.join(', ') : null);
  for (const line of detailLines(incident.details ?? {}, catalogueType(incident.incident_type)?.details ?? [])) {
    pdf.field(line.label, line.value);
  }
  pdf.field('Location', incident.location_address);
  pdf.field('Suburb / city', [incident.suburb, incident.city].filter(Boolean).join(', '));
  pdf.field('Region', incident.region);
  pdf.field('Coordinates', `${incident.location_lat}, ${incident.location_lng}`);
  pdf.field('Victims', incident.number_of_victims);
  // Each patient's own severity, apart from the incident's (0080).
  readPatients(incident.patients).forEach((p, i) => pdf.field(`Patient ${i + 1}`, patientText(p)));
  pdf.paragraph('Description', incident.call_description);
  pdf.paragraph('Notes', incident.notes);

  // Who logged the call and who changed it before dispatch, with both versions (0079).
  // The call details above are the call as it stands; here is what it said before.
  if (edits.length) {
    const editors = dispatchEditors(edits);
    pdf.section('Changes since it was logged');
    pdf.field('Logged by', incident.call_taken_by ?? 'the call taker');
    pdf.field('Edited before dispatch by', editors.length ? editors.join(', ') : 'No one');
    pdf.subheading('As logged');
    for (const line of asLogged(edits)) pdf.field(line.label, line.value);
    for (const e of edits) {
      pdf.subheading(`${editKindName(e.kind)} · ${e.edited_by_name ?? 'Unknown'}${e.edited_by_role ? ` (${e.edited_by_role})` : ''} · ${sa(e.edited_at)}`);
      pdf.field('Why', e.reason);
      for (const line of editLines(e.changes)) {
        pdf.field(`${line.label}: before`, line.before);
        pdf.field(`${line.label}: after`, line.after);
      }
    }
  }

  pdf.section('Dispatch and response');
  pdf.field('Dispatched', sa(incident.dispatch_time));
  pdf.field('Dispatched by', incident.dispatched_by);
  pdf.field('Sent to', departments);
  pdf.field('Assigned to', incident.assigned_to_name);
  pdf.field('Lead officer', incident.responding_officer);
  pdf.field('En route', sa(incident.accepted_at));
  pdf.field('On scene', sa(incident.arrived_timestamp));
  pdf.field('Report filed', sa(incident.report_filed_at));
  pdf.field('Resolved', sa(incident.resolved_at ?? incident.report_filed_at));
  // Filed from the desk for a crew on the radio (0075), and closed on scene.
  for (const part of incident.departments ?? []) {
    const dept = DEPARTMENT_LABELS[part.silo as keyof typeof DEPARTMENT_LABELS] ?? part.silo;
    if (part.radio_filed_by_name) {
      pdf.field(`${dept} filed by radio`, `from the desk by ${part.radio_filed_by_name}${part.radioed_by_name ? `, as radioed in by ${part.radioed_by_name}` : ''}`);
    }
    if (part.closed_at) pdf.field(`${dept} closed on scene`, `${sa(part.closed_at)}${part.closed_by_name ? ` by ${part.closed_by_name}` : ''}`);
  }
  for (const r of responders) {
    pdf.field(r.role === 'lead' ? 'Responder (lead)' : 'Responder (backup)', `${r.name ?? 'Officer'} · ${r.status} · joined ${sa(r.joined_at) ?? '—'}`);
  }

  if (report) {
    const type = getReportType(report.report_type);
    const { sections, extra } = reportReadout(type, report as unknown as Record<string, unknown>);
    pdf.section(`Police case report · ${type.label}`);
    pdf.field('Case number', report.case_number);
    pdf.field('Filed by', [report.officer_name, report.badge_number ? `#${report.badge_number}` : null].filter(Boolean).join(' '));
    pdf.field('Station', report.station);
    pdf.field('Filed', sa(report.filed_at));
    pdf.field('Times', [
      report.dispatch_time ? `dispatched ${report.dispatch_time}` : null,
      report.arrival_time ? `on scene ${report.arrival_time}` : null,
      report.clear_time ? `cleared ${report.clear_time}` : null,
      report.total_time ? `total ${report.total_time}` : null,
    ].filter(Boolean).join(' · '));
    // The forms on this report, each in its own colour, as the officer ticked them on the phone.
    pdf.badges([
      { text: 'Case report', tone: '#3b82f6' },
      ...(type.forms ?? []).map((f) => ({ text: `${f.code} · ${f.label}`, tone: f.tone })),
    ]);
    for (const s of sections) {
      pdf.subheading(s.title, s.form ? getReportForm(s.form)?.tone : undefined);
      for (const item of s.items) pdf.field(item.label, item.value);
    }
    for (const item of extra) pdf.field(item.label, item.value);
    pdf.paragraph('Officer narrative', report.officer_narrative);
  }

  if (fireReport) {
    pdf.section(`Fire report · ${fireReport.report_number}`);
    pdf.field('Filed by', fireReport.reporting_officer_name);
    pdf.field('Submitted', sa(fireReport.report_submission_date));
    pdf.text('The full fire report has its own PDF, from the case file.', 8);
  }

  if (pcr) {
    pdf.section(`Patient care report · ${pcr.report_number ?? ''}`);
    pdf.field('Crew', pcr.paramedic_names);
    pdf.field('Filed', sa(pcr.filed_at ?? pcr.created_at));
    pdf.field('Time on scene', sa(pcr.time_of_arrival));
    for (const s of pcrReadout(defaultsFrom(pcr as unknown as Parameters<typeof defaultsFrom>[0]))) {
      pdf.text(s.title, 9);
      for (const item of s.items) pdf.field(item.label, item.value);
    }
    const casualties = Array.isArray(pcr.secondary_patients_json) ? pcr.secondary_patients_json as Array<Record<string, string>> : [];
    for (const [n, c] of casualties.entries()) {
      pdf.field(`Patient ${n + 2}`, [c.name, c.age && `${c.age} yrs`, c.gender, c.triage, c.injuries].filter(Boolean).join(' · '));
    }
    pdf.field('Vehicle requires cleaning', pcr.requires_cleaning ? 'Yes' : 'No');
  }

  if (postMortem) {
    pdf.section(`Post-mortem · ${postMortem.report_number ?? ''}`);
    pdf.field('Type', postMortem.incident_type);
    pdf.field('Start Time', sa(postMortem.start_time));
    pdf.field('Resolved Time', sa(postMortem.end_time));
    pdf.field('Duration (hours)', postMortem.total_duration_hours == null ? null : String(postMortem.total_duration_hours));
    pdf.field('Confirmed Injuries', String(postMortem.injuries));
    pdf.field('Confirmed Fatalities', String(postMortem.fatalities));
    pdf.field('Displaced Persons', String(postMortem.displaced_people));
    pdf.paragraph('Root Cause Analysis', postMortem.root_cause);
    pdf.paragraph('Lessons Learned / Recommendations', postMortem.lessons_learned);
    pdf.field('Reporting Officer', postMortem.reporting_officer);
  }

  if (stage === 'closed') {
    pdf.section('Case closure');
    pdf.field('Outcome', caseState);
    pdf.field('Closed by', incident.closed_by_name);
    pdf.field('Closed', sa(incident.closed_at));
    pdf.paragraph(incident.close_kind === 'Cancelled' ? 'Reason' : 'Review note', incident.close_reason);
  }

  pdf.section(`Timeline (${updates.length})`);
  for (const u of [...updates].reverse()) {
    pdf.text(`• [${sa(u.timestamp)}] ${u.created_by_name ?? 'System'}: ${u.message}`);
  }

  if (attachments.length > 0) {
    pdf.section(`Evidence (${attachments.length})`);
    for (const a of attachments) {
      const label = `${a.kind} — ${a.storage_path.split('/').pop()} (${a.uploaded_by_name ?? 'unknown'}, ${sa(a.created_at) ?? ''})${a.caption ? ` — ${a.caption}` : ''}`;
      // Embed images inline (V4 CaseManager PDFs shipped the photos); other kinds are listed.
      const isImage = a.kind === 'image' || (a.content_type?.startsWith('image/') ?? false);
      if (isImage) {
        const { data: blob } = await supabase.storage.from('incident-media').download(a.storage_path);
        if (blob) {
          await pdf.image(
            new Uint8Array(await blob.arrayBuffer()),
            a.content_type ?? 'image/jpeg',
            label,
          );
          continue;
        }
      }
      pdf.text(`• ${label}`);
    }
  }

  if (audit.length > 0) {
    pdf.section(`Audit trail (${audit.length})`);
    for (const l of [...audit].reverse()) {
      pdf.text(`• [${sa(l.timestamp)}] ${l.action_type} — ${l.user_name ?? 'system'}${l.details ? `: ${l.details}` : ''}`);
    }
  }

  const bytes = await pdf.bytes();
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="case-${incident.incident_number}.pdf"`,
    },
  });
}
