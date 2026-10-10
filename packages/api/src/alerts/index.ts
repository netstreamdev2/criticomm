import type { CriticomClient, Database, Silo, AlertKind, AlertPresentation } from '@criticom/db';
import { subscribeSignedIn } from '../realtime/join';

export type Alert = Database['public']['Tables']['alerts']['Row'];
export type PushToken = Database['public']['Tables']['push_tokens']['Row'];

/**
 * Alerts are the "tell a human right now" channel: department dispatch
 * assignments, escalations, broadcasts. They arrive over Supabase realtime and
 * surface as toasts on the web and as push/full-screen alerts on mobile.
 *
 * Read scope is enforced by RLS (see migration 0010): you receive alerts
 * addressed to you personally, alerts broadcast to your silo, and — if you hold
 * a global role — everything.
 */

/* ── Raising alerts ─────────────────────────────────────────────────── */

export type RaiseAlertInput = {
  silo: Silo;
  title: string;
  body?: string | null;
  /** Omit to broadcast to the whole silo. */
  targetUserId?: string | null;
  kind?: AlertKind;
  severity?: Alert['severity'];
  incidentId?: string | null;
  link?: string | null;
  presentation?: AlertPresentation;
  requiresAck?: boolean;
  createdByName?: string | null;
  /** Auto-hide after this many minutes; omit to keep until read. */
  expiresInMinutes?: number;
};

export async function raiseAlert(client: CriticomClient, input: RaiseAlertInput) {
  const { data, error } = await client
    .from('alerts')
    .insert({
      silo: input.silo,
      target_user_id: input.targetUserId ?? null,
      kind: input.kind ?? 'info',
      severity: input.severity ?? 'Medium',
      title: input.title,
      body: input.body ?? null,
      incident_id: input.incidentId ?? null,
      link: input.link ?? null,
      presentation: input.presentation ?? 'toast',
      requires_ack: input.requiresAck ?? false,
      created_by_name: input.createdByName ?? null,
      expires_at: input.expiresInMinutes
        ? new Date(Date.now() + input.expiresInMinutes * 60_000).toISOString()
        : null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Fan an incident out to every department it was routed to — one silo-wide
 * alert each. High and Critical calls are raised as blocking modals so a crew
 * cannot scroll past them. Runs server-side in Postgres so the whole fanout is
 * one round trip and cannot half-succeed.
 */
export async function raiseDispatchAlerts(
  client: CriticomClient,
  args: { incidentId: string; silos: Silo[]; byName?: string | null },
) {
  if (args.silos.length === 0) return 0;
  const { data, error } = await client.rpc('raise_dispatch_alerts', {
    p_incident_id: args.incidentId,
    p_silos: args.silos,
    p_by_name: args.byName ?? null,
  });
  if (error) throw error;
  return data ?? 0;
}

/* ── Reading ────────────────────────────────────────────────────────── */

/** Recent alerts visible to the caller, newest first, with read state joined. */
export async function listMyAlerts(
  client: CriticomClient,
  opts: { limit?: number; unreadOnly?: boolean } = {},
) {
  const { data: { user } } = await client.auth.getUser();
  const { data, error } = await client
    .from('alerts')
    .select('*, alert_reads(user_id, read_at, acknowledged)')
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 50);
  if (error) throw error;

  const rows = (data ?? []).map((row) => {
    const reads = (row as unknown as { alert_reads?: Array<{ user_id: string; acknowledged: boolean }> })
      .alert_reads ?? [];
    const mine = user ? reads.find((r) => r.user_id === user.id) : undefined;
    return { ...(row as Alert), read: Boolean(mine), acknowledged: Boolean(mine?.acknowledged) };
  });

  return opts.unreadOnly ? rows.filter((r) => !r.read) : rows;
}

/**
 * Authoritative unread count.
 *
 * Uses the `count_unread_alerts()` function (migration 0022) rather than
 * fetching rows and counting them client-side — the old approach capped at the
 * fetch limit, so a busy shift would show "100" and stop, and it pulled every
 * alert body over the wire just to discard them.
 */
export async function countUnreadAlerts(client: CriticomClient) {
  const { data, error } = await client.rpc('count_unread_alerts');
  if (error) throw error;
  return typeof data === 'number' ? data : 0;
}

/* ── Read receipts ──────────────────────────────────────────────────── */

export async function markAlertRead(
  client: CriticomClient,
  alertId: string,
  opts: { acknowledged?: boolean } = {},
) {
  const { data: { user } } = await client.auth.getUser();
  if (!user) return;
  const { error } = await client
    .from('alert_reads')
    .upsert(
      {
        alert_id: alertId,
        user_id: user.id,
        read_at: new Date().toISOString(),
        acknowledged: opts.acknowledged ?? false,
      },
      { onConflict: 'alert_id,user_id' },
    );
  if (error) throw error;
}

export async function markAllAlertsRead(client: CriticomClient) {
  const { data: { user } } = await client.auth.getUser();
  if (!user) return 0;
  const unread = await listMyAlerts(client, { limit: 100, unreadOnly: true });
  if (unread.length === 0) return 0;
  const now = new Date().toISOString();
  const { error } = await client.from('alert_reads').upsert(
    unread.map((a) => ({ alert_id: a.id, user_id: user.id, read_at: now, acknowledged: false })),
    { onConflict: 'alert_id,user_id' },
  );
  if (error) throw error;
  return unread.length;
}

/* ── Realtime ───────────────────────────────────────────────────────── */

// Supabase reuses a channel per topic and rejects listeners added after
// subscribe(), so every subscription gets its own topic (same reasoning as
// realtime/index.ts).
let seq = 0;
const uniqueTopic = (base: string) => `${base}:${++seq}:${Math.random().toString(36).slice(2, 8)}`;

/**
 * Live alert stream. Postgres RLS already limits which rows the socket may
 * deliver, so no client-side filtering is needed for security — but we still
 * pass a silo filter when we can, to cut needless traffic.
 */
export function subscribeAlerts(
  client: CriticomClient,
  args: { silo: Silo | 'all' },
  onAlert: (alert: Alert) => void,
) {
  const filter = args.silo === 'all' ? undefined : `silo=eq.${args.silo}`;
  const channel = client
    .channel(uniqueTopic(`alerts:${args.silo}`))
    .on(
      'postgres_changes' as never,
      { event: 'INSERT', schema: 'public', table: 'alerts', filter },
      (payload: { new: Alert }) => onAlert(payload.new),
    );
  subscribeSignedIn(client, channel);
  return () => {
    void client.removeChannel(channel);
  };
}

export type AlertRead = Database['public']['Tables']['alert_reads']['Row'];

/**
 * Live stream of this user's own read receipts, so an unread badge can go
 * *down* as well as up — including when the alert was read somewhere else
 * (another tab, the phone, the wall display).
 *
 * `alert_reads` RLS is `user_id = auth.uid()`, so this delivers only the
 * caller's receipts; the filter is belt-and-braces to cut traffic, not the
 * security boundary.
 *
 * `onChange` fires for inserts (read) and deletes (marked unread again).
 * `onStatus` reports socket state — callers use it to re-seed an authoritative
 * count after a reconnect, so a dropped connection cannot leave the badge
 * permanently drifted.
 */
export function subscribeMyAlertReads(
  client: CriticomClient,
  args: { userId: string },
  handlers: {
    onChange: (change: { type: 'read' | 'unread'; alertId: string }) => void;
    onStatus?: (status: string) => void;
  },
) {
  const filter = `user_id=eq.${args.userId}`;
  const channel = client
    .channel(uniqueTopic(`alert_reads:${args.userId}`))
    .on(
      'postgres_changes' as never,
      { event: 'INSERT', schema: 'public', table: 'alert_reads', filter },
      (payload: { new: AlertRead }) =>
        handlers.onChange({ type: 'read', alertId: payload.new.alert_id }),
    )
    .on(
      'postgres_changes' as never,
      { event: 'DELETE', schema: 'public', table: 'alert_reads', filter },
      (payload: { old: AlertRead }) =>
        handlers.onChange({ type: 'unread', alertId: payload.old?.alert_id }),
    );
  subscribeSignedIn(client, channel, (status: string) => handlers.onStatus?.(status));
  return () => {
    void client.removeChannel(channel);
  };
}

/* ── Push tokens (mobile) ───────────────────────────────────────────── */

/**
 * Register (or re-register) this device's Expo push token. Tokens are unique
 * per install; re-registering under a different user reassigns the device,
 * which is what you want when a phone is handed over between shifts.
 */
export async function registerPushToken(
  client: CriticomClient,
  args: { token: string; platform?: string; deviceName?: string; silo?: Silo },
) {
  const { data: { user } } = await client.auth.getUser();
  if (!user) return;
  const { error } = await client.from('push_tokens').upsert(
    {
      user_id: user.id,
      token: args.token,
      platform: args.platform ?? null,
      device_name: args.deviceName ?? null,
      silo: args.silo ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'token' },
  );
  if (error) throw error;
}

export async function unregisterPushToken(client: CriticomClient, token: string) {
  await client.from('push_tokens').delete().eq('token', token);
}
