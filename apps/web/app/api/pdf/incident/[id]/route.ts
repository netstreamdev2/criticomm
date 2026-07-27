import { NextResponse } from 'next/server';
import { getIncident, getIncidentUpdates, listIncidentAttachments, listAuditLogs } from '@criticom/api';
import { getServerSupabase } from '@/lib/supabase';
import { ReportPdf } from '@/lib/pdf';

/** CaseManagerController.DownloadReport — official case report PDF. */
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const incident = await getIncident(supabase, id).catch(() => null);
  if (!incident) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const [updates, attachments, audit] = await Promise.all([
    getIncidentUpdates(supabase, id),
    listIncidentAttachments(supabase, id),
    listAuditLogs(supabase, { entityType: 'incident', entityId: id, limit: 100 }),
  ]);

  const pdf = await ReportPdf.create(
    `Case Report — ${incident.incident_number}`,
    `${incident.silo} · ${incident.incident_type} · ${incident.incident_severity} · Status: ${incident.status}`,
  );

  pdf.section('Call details');
  pdf.field('Caller', `${incident.caller_name} (${incident.caller_number})`);
  pdf.field('Received', incident.call_timestamp);
  pdf.field('Location', incident.location_address);
  pdf.field('Suburb / city', [incident.suburb, incident.city].filter(Boolean).join(', '));
  pdf.field('Coordinates', `${incident.location_lat}, ${incident.location_lng}`);
  pdf.field('Victims', incident.number_of_victims);
  pdf.paragraph('Description', incident.call_description);
  pdf.paragraph('Notes', incident.notes);

  pdf.section('Response');
  pdf.field('Dispatched', incident.dispatch_time);
  pdf.field('Arrived', incident.arrived_timestamp);
  pdf.field('Closed', incident.closed_at);
  pdf.field('Unit type', incident.unit_type);
  pdf.field('Responding officer', incident.responding_officer);
  pdf.field('Broadcast silos', incident.dispatched_silos.join(', ') || null);

  pdf.section(`Update log (${updates.length})`);
  for (const u of [...updates].reverse()) {
    pdf.text(`• [${u.timestamp.slice(0, 16).replace('T', ' ')}] ${u.created_by_name ?? 'System'}: ${u.message}`);
  }

  if (attachments.length > 0) {
    pdf.section(`Evidence (${attachments.length})`);
    for (const a of attachments) {
      const label = `${a.kind} — ${a.storage_path.split('/').pop()} (${a.uploaded_by_name ?? 'unknown'})${a.caption ? ` — ${a.caption}` : ''}`;
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
      pdf.text(`• [${l.timestamp.slice(0, 16).replace('T', ' ')}] ${l.action_type} — ${l.user_name ?? 'system'}${l.details ? `: ${l.details}` : ''}`);
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
