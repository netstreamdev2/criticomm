import { NextResponse, type NextRequest } from 'next/server';
import { PHASE_LABEL, filterBoard, formatBoardDuration, listResponderBoard, logAudit, type BoardPhase } from '@criticom/api';
import { RESPONDER_MONITOR_ACT_ROLES, saDate } from '@criticom/db';
import { enforceRateLimit } from '@/lib/rate-limit';
import { ReportPdf } from '@/lib/pdf';
import { loadPdfBrand } from '@/lib/pdf-brand';
import { getSession } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const SEVERITY_TONE: Record<string, string> = { Low: '#22c55e', Medium: '#f59e0b', High: '#f97316', Critical: '#ef4444' };
const PHASES = new Set<BoardPhase>(['responding', 'on_scene', 'transporting']);

/**
 * The Active Responders log as a PDF (V4's "Export log"), filtered as on
 * screen. The same calls the person sees, from their own session; not the
 * Viewer, who watches only; every export on the audit trail.
 */
export async function GET(request: NextRequest) {
  const { supabase, user, role, silo, fullName } = await getSession();
  if (!RESPONDER_MONITOR_ACT_ROLES.includes(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const limited = await enforceRateLimit(supabase, 'pdf');
  if (limited) return limited;

  const p = request.nextUrl.searchParams;
  const phase = p.get('phase') as BoardPhase | null;
  const filters = {
    q: p.get('q')?.slice(0, 80) ?? null,
    department: p.get('department'),
    severity: p.get('severity'),
    phase: phase && PHASES.has(phase) ? phase : null,
  };
  const rows = filterBoard(await listResponderBoard(supabase), filters);

  const pdf = await ReportPdf.create(
    'Active Responders Log',
    `${rows.length} call${rows.length === 1 ? '' : 's'} with crews out · ${formatSaTime(new Date())} · prepared by ${fullName}`,
    await loadPdfBrand(supabase, { police: silo === 'MetroPolice' }),
  );
  pdf.section('Crews out');
  pdf.tiles([
    { label: 'Calls', value: rows.length, tone: '#6366f1' },
    { label: 'Responding', value: rows.filter((r) => r.phase === 'responding').length, tone: '#f59e0b' },
    { label: 'On scene', value: rows.filter((r) => r.phase === 'on_scene').length, tone: '#22c55e' },
    { label: 'Transporting', value: rows.filter((r) => r.phase === 'transporting').length, tone: '#a855f7' },
    { label: 'Critical', value: rows.filter((r) => r.severity === 'Critical').length, tone: '#ef4444' },
  ]);
  pdf.section('The calls');
  pdf.table(
    [
      { label: 'Call', width: 3.4 }, { label: 'Type', width: 2.8 }, { label: 'Severity', width: 1.6 }, { label: 'Stage', width: 1.8 },
      { label: 'Departments', width: 2.6 }, { label: 'Crew', width: 3.2 }, { label: 'Dispatched', width: 2.6 }, { label: 'On scene', width: 1.6 },
    ],
    rows.map((r) => ({
      tone: SEVERITY_TONE[r.severity],
      cells: [
        r.number, r.type, r.severity, PHASE_LABEL[r.phase], r.departments.map((d) => d.label).join(', '),
        r.crew.map((c) => c.name).join(', ') || r.lead, r.dispatchedAt ? formatSaTime(r.dispatchedAt) : null, formatBoardDuration(r.onSceneS),
      ],
    })),
  );

  await logAudit(supabase, {
    silo, user_id: user.id, user_name: fullName, action_type: 'ResponderLogExported', entity_type: 'incident',
    details: `PDF · ${rows.length} calls${request.nextUrl.search ? ` · ${request.nextUrl.search}` : ''}`,
  }).catch(() => {});

  const bytes = await pdf.bytes();
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="active-responders-${saDate(new Date())}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
