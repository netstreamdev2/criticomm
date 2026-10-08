import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database, Silo } from '@criticom/db/types';
import { getServerSupabase } from '@/lib/supabase';

/**
 * Fan a dispatch out to the responder app via Expo push.
 *
 * Realtime already covers every phone with the app open — this exists for the
 * crew whose screen is locked in a cab. It runs with the service-role key
 * because reading other users' device tokens is deliberately impossible under
 * RLS; the caller's own session is still checked first, so only a signed-in
 * operator can trigger a send.
 *
 * Best-effort by design: a push failure must never surface as a dispatch
 * failure. The console fires this and moves on.
 *
 * Recipients are always resolved here, never taken from the browser:
 *   - `{ incidentId, crew: true }` — the on-duty crew of the unit the incident
 *     is dispatched to (unit dispatch).
 *   - `{ incidentId, silos }` — every on-duty responder in those departments
 *     (send to all, migrations 0040/0042 — officers may hold several calls).
 *   - `{ incidentId, userId }` — the one officer the call is assigned to,
 *     and only if the incident really is assigned to them (0042).
 * Only officers on duty, and only in the caller's own tenant, are reached.
 */
export const dynamic = 'force-dynamic';

const EXPO_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

type PushMessage = {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  priority: 'high';
  channelId: string;
  /** The phone's Open / Navigate / Acknowledge buttons (apps/mobile/lib/push.ts). */
  categoryId: string;
  data: Record<string, unknown>;
};

export async function POST(req: Request) {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json()) as { incidentId?: string; silos?: Silo[]; crew?: boolean; userId?: string };
  const incidentId = body.incidentId;
  const silos = body.silos ?? [];
  const crew = body.crew === true;
  const assignee = typeof body.userId === 'string' ? body.userId : null;
  if (!incidentId || (!crew && !assignee && silos.length === 0)) {
    return NextResponse.json({ error: 'incidentId and one of crew, userId or silos are required' }, { status: 400 });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceKey || !url) {
    return NextResponse.json({ sent: 0, reason: 'Push not configured on this deployment.' });
  }

  const admin = createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // The caller can only push for an incident they can themselves read.
  const { data: incident } = await supabase
    .from('incidents')
    .select('incident_number, incident_type, incident_severity, location_address')
    .eq('id', incidentId)
    .maybeSingle();
  if (!incident) return NextResponse.json({ error: 'Incident not found' }, { status: 404 });

  // Tenant and unit come from the record itself, not the request.
  const { data: scope } = await admin.from('incidents').select('*').eq('id', incidentId).maybeSingle();
  const { tenant_id: tenantId, unit_id: unitId, assigned_to: assignedTo, source, created_by: createdBy } = (scope ?? {}) as {
    tenant_id?: string; unit_id?: string | null; assigned_to?: string | null; source?: string | null; created_by?: string | null;
  };
  // The officer who raised an SOS is the one in trouble: never pushed their own SOS (0044).
  const raiser = source === 'Responder-Panic' ? createdBy ?? null : null;
  if (!tenantId) return NextResponse.json({ sent: 0 });
  if (crew && !unitId) return NextResponse.json({ sent: 0, reason: 'No unit dispatched yet.' });
  // The browser cannot point a push at anyone the call is not assigned to.
  if (assignee && assignedTo !== assignee) return NextResponse.json({ sent: 0, reason: 'Not assigned to that officer.' });

  let onDuty = admin
    .from('personnel')
    .select('user_id')
    .eq('is_on_duty', true)
    .eq('tenant_id', tenantId)
    .not('user_id', 'is', null);
  onDuty = crew
    ? onDuty.eq('assigned_apparatus_id', unitId!)
    : assignee ? onDuty.eq('user_id', assignee) : onDuty.in('silo', silos);
  const { data: people } = await onDuty;
  const userIds = (people ?? []).map((p) => p.user_id).filter((u): u is string => Boolean(u) && u !== raiser);
  if (userIds.length === 0) return NextResponse.json({ sent: 0 });

  const { data: tokens } = await admin
    .from('push_tokens')
    .select('token')
    .in('user_id', userIds);

  const recipients = (tokens ?? [])
    .map((t) => t.token)
    .filter((t): t is string => typeof t === 'string' && t.startsWith('ExponentPushToken'));

  if (recipients.length === 0) return NextResponse.json({ sent: 0 });

  const messages: PushMessage[] = recipients.map((to) => ({
    to,
    title: crew
      ? `${incident.incident_number} assigned to your unit`
      : assignee
        ? `${incident.incident_number} assigned to you · ${incident.incident_severity}`
        : `New incident ${incident.incident_number} · ${incident.incident_severity}`,
    body: `${incident.incident_type} · ${incident.location_address}`,
    sound: 'default',
    priority: 'high',
    channelId: 'dispatch',
    categoryId: 'incident',
    data: { incidentId, severity: incident.incident_severity },
  }));

  // Expo accepts at most 100 messages per request.
  let sent = 0;
  try {
    for (let i = 0; i < messages.length; i += 100) {
      const res = await fetch(EXPO_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(messages.slice(i, i + 100)),
      });
      if (res.ok) sent += Math.min(100, messages.length - i);
    }
  } catch {
    return NextResponse.json({ sent, error: 'Expo push unreachable' });
  }

  return NextResponse.json({ sent });
}
