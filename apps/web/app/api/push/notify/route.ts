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
  data: Record<string, unknown>;
};

export async function POST(req: Request) {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json()) as { incidentId?: string; silos?: Silo[] };
  const incidentId = body.incidentId;
  const silos = body.silos ?? [];
  if (!incidentId || silos.length === 0) {
    return NextResponse.json({ error: 'incidentId and silos are required' }, { status: 400 });
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

  const { data: tokens } = await admin
    .from('push_tokens')
    .select('token')
    .in('silo', silos);

  const recipients = (tokens ?? [])
    .map((t) => t.token)
    .filter((t): t is string => typeof t === 'string' && t.startsWith('ExponentPushToken'));

  if (recipients.length === 0) return NextResponse.json({ sent: 0 });

  const messages: PushMessage[] = recipients.map((to) => ({
    to,
    title: `${incident.incident_severity} — ${incident.incident_number}`,
    body: `${incident.incident_type} · ${incident.location_address}`,
    sound: 'default',
    priority: 'high',
    channelId: 'dispatch',
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
