import type { CriticomClient, Database, Silo, AlertAudience, UserRole } from '@criticom/db';
import { subscribeSignedIn } from '../realtime/join';

export * from './audience';

export type Alert = Database['public']['Tables']['alerts']['Row'];
export type PushToken = Database['public']['Tables']['push_tokens']['Row'];

/**
 * Alerts are the "tell a human right now" channel: dispatch, SOS, assignments,
 * broadcasts, and the notifications people send each other. They arrive over
 * Supabase realtime and surface as pop-ups on the web and on the phone.
 *
 * Each one names its audience (migration 0084): one person, a named few, the
 * holders of some roles, a department, or the whole organisation. RLS lets
 * only that audience read it. Nobody writes the table directly: the database
 * raises its own (dispatch, SOS…) and people send through send_notification().
 */

/* ── Sending ────────────────────────────────────────────────────────── */

export type SendNotificationInput =
  | { audience: 'person'; userId: string }
  | { audience: 'people'; userIds: string[]; silo?: Silo }
  | { audience: 'role'; roles: UserRole[]; silo?: Silo; allDepartments?: boolean }
  | { audience: 'department'; silo?: Silo }
  | { audience: 'organisation' };

export type SendNotificationMessage = {
  title: string;
  body?: string | null;
  /** A page inside HikTech, e.g. "/mail". */
  link?: string | null;
  severity?: 'Low' | 'Medium' | 'High';
  kind?: 'info' | 'broadcast' | 'mail' | 'task';
};

/**
 * Send a notification. The database checks who may reach whom (anyone to one
 * person in the organisation; administrators, command and the desks to a
 * group in their department; the organisation's administrators to everyone)
 * and audits it. Never an emergency pop-up.
 */
export async function sendNotification(
  client: CriticomClient,
  to: SendNotificationInput,
  message: SendNotificationMessage,
) {
  const { data, error } = await client.rpc('send_notification', {
    p_audience: to.audience,
    p_title: message.title,
    p_body: message.body ?? null,
    p_link: message.link ?? null,
    p_severity: message.severity ?? 'Low',
    p_user: to.audience === 'person' ? to.userId : null,
    p_users: to.audience === 'people' ? to.userIds : null,
    p_roles: to.audience === 'role' ? to.roles : null,
    p_silo: 'silo' in to ? (to.silo ?? null) : null,
    p_all_departments: to.audience === 'role' ? Boolean(to.allDepartments) : false,
    p_kind: message.kind ?? 'info',
  });
  if (error) throw error;
  return data as unknown as Alert;
}

/** Take back a notification you sent: it disappears for everyone. */
export async function withdrawNotification(client: CriticomClient, id: string) {
  const { error } = await client.rpc('withdraw_notification', { p_id: id });
  if (error) throw error;
}

/** The last 50 notifications you sent. */
export async function listMySentNotifications(client: CriticomClient) {
  const { data, error } = await client.rpc('my_sent_notifications');
  if (error) throw error;
  return (data ?? []) as unknown as Alert[];
}

export type NotificationReach = {
  /** May send to people, a role or a department (else one person at a time). */
  groups: boolean;
  /** May send to another department. */
  anyDepartment: boolean;
  /** May send to everyone, or to a role in every department. */
  organisation: boolean;
  silo: Silo | null;
};

/** Whom the signed-in person may send to. The database enforces it; this only shapes the form. */
export async function getNotificationReach(client: CriticomClient): Promise<NotificationReach> {
  const { data, error } = await client.rpc('notification_reach');
  if (error) throw error;
  const r = (data ?? {}) as Partial<NotificationReach>;
  return { groups: Boolean(r.groups), anyDepartment: Boolean(r.anyDepartment), organisation: Boolean(r.organisation), silo: r.silo ?? null };
}

/** For System Status: notifications raised since a moment (administrators). */
export async function countNotificationActivity(client: CriticomClient, since: string) {
  const { data, error } = await client.rpc('notification_activity', { p_since: since });
  if (error) throw error;
  return typeof data === 'number' ? data : 0;
}

export type { AlertAudience };

/* ── Reading ────────────────────────────────────────────────────────── */

/**
 * Recent notifications meant for the caller (RLS: theirs, their group's,
 * their department's, everyone's), newest first, with read state joined.
 * Expired ones are left out, as the unread count leaves them out.
 */
export async function listMyAlerts(
  client: CriticomClient,
  opts: { limit?: number; unreadOnly?: boolean } = {},
) {
  const { data: { user } } = await client.auth.getUser();
  const { data, error } = await client
    .from('alerts')
    .select('*, alert_reads(user_id, read_at, acknowledged)')
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
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
 * Live stream of the notifications meant for the signed-in person. Postgres
 * RLS decides which rows the socket delivers (0084: the person, the named few,
 * the role, the department or everyone), so there is no silo filter: a
 * notification for "Metro Police admins" or "everyone" carries a silo that
 * is not necessarily the reader's.
 */
export function subscribeAlerts(client: CriticomClient, onAlert: (alert: Alert) => void) {
  const channel = client
    .channel(uniqueTopic('alerts'))
    .on(
      'postgres_changes' as never,
      { event: 'INSERT', schema: 'public', table: 'alerts' },
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
