import type { CriticomClient, Database, Silo, UserRole } from '@criticom/db';

/**
 * Account invitations (migration 0049): the only way a person gets an
 * account. Administrators act through their own session; the steps the
 * invited person takes run on the server with the service role, because that
 * person is not signed in yet. Nothing here ever sees a link or a code: the
 * server hashes them first.
 */

type Tables = Database['public']['Tables'];
export type Invitation = Omit<Tables['account_invitations']['Row'], 'secret_hash'>;
export type InvitationStatus = Invitation['status'];
export type InvitationChannel = Invitation['channel'];
/** The channels an invitation is sent by; 'direct' (0055) is never sent. */
export type InviteChannel = Exclude<InvitationChannel, 'direct'>;

/** Every column but the secret's hash, which no screen needs. */
const INVITATION_COLUMNS = [
  'id', 'tenant_id', 'personnel_id', 'full_name', 'badge_number', 'role', 'silo', 'channel', 'email', 'phone',
  'login_email', 'reason', 'needs_approval', 'status', 'expires_at', 'attempts', 'delivery_error', 'send_count',
  'invited_by', 'invited_by_name', 'approved_by', 'approved_by_name', 'created_at', 'sent_at', 'sent_by_name',
  'opened_at', 'accepted_at', 'accepted_user_id', 'policy_version', 'closed_at', 'closed_by', 'closed_by_name',
  'close_note',
].join(', ');

export const OPEN_INVITATION_STATUSES: InvitationStatus[] = ['awaiting_approval', 'ready', 'sent', 'opened'];

// ── Administrators ─────────────────────────────────────────────────────

export async function createInvitation(
  client: CriticomClient,
  args: {
    personnelId: string; role: UserRole; silo: Silo; channel: InviteChannel;
    email?: string | null; phone?: string | null; reason: string;
  },
) {
  const { data, error } = await client.rpc('create_account_invitation', {
    p_personnel: args.personnelId,
    p_role: args.role,
    p_silo: args.silo,
    p_channel: args.channel,
    p_email: args.email ?? null,
    p_phone: args.phone ?? null,
    p_reason: args.reason,
  });
  if (error) throw error;
  return data as { status: 'ready' | 'awaiting_approval'; invitation_id: string; request_id?: string };
}

/** What an issued invitation carries into its email, SMS or printed slip. */
export type IssuedInvitation = Database['public']['Functions']['issue_invitation_secret']['Returns'];

export async function issueInvitationSecret(
  client: CriticomClient,
  args: { invitationId: string; secretHash: string; ttlHours: number },
): Promise<IssuedInvitation> {
  const { data, error } = await client.rpc('issue_invitation_secret', {
    p_invitation: args.invitationId,
    p_secret_hash: args.secretHash,
    p_ttl_hours: args.ttlHours,
  });
  if (error) throw error;
  return data as IssuedInvitation;
}

export async function recordInvitationDeliveryFailure(client: CriticomClient, invitationId: string, reason: string) {
  const { error } = await client.rpc('record_invitation_delivery_failure', { p_invitation: invitationId, p_error: reason });
  if (error) throw error;
}

export async function cancelInvitation(client: CriticomClient, invitationId: string, note?: string | null) {
  const { error } = await client.rpc('cancel_account_invitation', { p_invitation: invitationId, p_note: note ?? null });
  if (error) throw error;
}

export async function getInvitation(client: CriticomClient, invitationId: string) {
  const { data, error } = await client
    .from('account_invitations').select(INVITATION_COLUMNS).eq('id', invitationId).maybeSingle();
  if (error) throw error;
  return data as unknown as Invitation | null;
}

/** Open (not yet accepted or closed), accepted, or closed invitations, newest first. */
export async function listInvitations(client: CriticomClient, view: 'open' | 'accepted' | 'closed') {
  let q = client.from('account_invitations').select(INVITATION_COLUMNS);
  if (view === 'open') q = q.in('status', OPEN_INVITATION_STATUSES);
  else if (view === 'accepted') q = q.eq('status', 'accepted');
  else q = q.in('status', ['rejected', 'expired', 'cancelled', 'locked', 'reported']);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(500);
  if (error) throw error;
  return (data ?? []) as unknown as Invitation[];
}

export async function countOpenInvitations(client: CriticomClient) {
  const { count, error } = await client
    .from('account_invitations').select('id', { count: 'exact', head: true }).in('status', OPEN_INVITATION_STATUSES);
  if (error) throw error;
  return count ?? 0;
}

/** Someone on the staff register, as the invite form offers them. */
export type StaffForInvite = {
  id: string; first_name: string; last_name: string; badge_number: string; rank: string;
  station: string | null; silo: Silo;
  /** From the staff register (0050): used to fill in the invitation. */
  work_email: string | null; work_cellphone: string | null;
  proposed_role: UserRole | null; role_confirmed_at: string | null;
  /** Marked as left (0050): cannot be invited. */
  left_at: string | null;
  /** Already signs in: their role is changed on their account page, not by invitation. */
  hasAccount: boolean;
  openInvitation: InvitationStatus | null;
};

const STAFF_COLUMNS = 'id, first_name, last_name, badge_number, rank, station, silo, user_id, work_email, work_cellphone, proposed_role, role_confirmed_at, left_at';

type StaffRow = Omit<StaffForInvite, 'hasAccount' | 'openInvitation'> & { user_id: string | null };

/**
 * Search words reduced to what a name or badge number holds, at most three.
 * Everything else is dropped, so what is typed can never change the shape of
 * the query.
 */
export function staffSearchTerms(query: string): string[] {
  return query
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}'\- ]/gu, ' ')
    .split(/\s+/)
    .filter((t) => /[\p{L}\p{N}]/u.test(t))
    .slice(0, 3);
}

async function withInvitationState(client: CriticomClient, rows: StaffRow[]): Promise<StaffForInvite[]> {
  const ids = rows.filter((r) => !r.user_id).map((r) => r.id);
  const open = new Map<string, InvitationStatus>();
  if (ids.length) {
    const { data } = await client
      .from('account_invitations').select('personnel_id, status')
      .in('personnel_id', ids).in('status', OPEN_INVITATION_STATUSES);
    for (const r of data ?? []) if (r.personnel_id) open.set(r.personnel_id, r.status);
  }
  return rows.map(({ user_id, ...p }) => ({ ...p, hasAccount: user_id !== null, openInvitation: open.get(p.id) ?? null }));
}

/** People on the staff register matching every word typed (name or badge number), as this administrator sees it. */
export async function searchStaffForInvite(client: CriticomClient, query: string, limit = 12) {
  const terms = staffSearchTerms(query);
  if (terms.length === 0) return [];
  let q = client.from('personnel').select(STAFF_COLUMNS);
  for (const t of terms) q = q.or(`first_name.ilike.*${t}*,last_name.ilike.*${t}*,badge_number.ilike.*${t}*`);
  const { data, error } = await q.order('last_name').order('first_name').limit(limit);
  if (error) throw error;
  return withInvitationState(client, (data ?? []) as unknown as StaffRow[]);
}

/** One person on the staff register, for "Invite again" and links from elsewhere. */
export async function getStaffForInvite(client: CriticomClient, personnelId: string) {
  const { data, error } = await client.from('personnel').select(STAFF_COLUMNS).eq('id', personnelId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const [person] = await withInvitationState(client, [data as unknown as StaffRow]);
  return person ?? null;
}

// ── The invited person (service role, on the server only) ──────────────

export type InvitationState = 'ok' | 'unknown' | 'expired' | 'used' | 'locked' | 'closed' | 'wrong';

export type InvitationPreview = {
  state: InvitationState;
  first_name?: string; role?: UserRole; silo?: Silo; organisation?: string | null;
  invited_by_name?: string | null; expires_at?: string; channel?: InvitationChannel;
  email?: string | null; sign_in?: 'email' | 'badge'; tries_left?: number;
};

export async function previewInvitation(service: CriticomClient, secretHash: string) {
  const { data, error } = await service.rpc('preview_invitation', { p_secret_hash: secretHash });
  if (error) throw error;
  return data as InvitationPreview;
}

export async function checkInvitationBadge(service: CriticomClient, secretHash: string, badge: string) {
  const { data, error } = await service.rpc('check_invitation_badge', { p_secret_hash: secretHash, p_badge: badge });
  if (error) throw error;
  return data as {
    ok: boolean; state: InvitationState; tries_left?: number;
    full_name?: string; login_email?: string; sign_in?: 'email' | 'badge';
  };
}

export async function completeAccountInvitation(
  service: CriticomClient,
  args: { secretHash: string; badge: string; userId: string; policyVersion: string },
) {
  const { data, error } = await service.rpc('complete_account_invitation', {
    p_secret_hash: args.secretHash, p_badge: args.badge, p_user: args.userId, p_policy_version: args.policyVersion,
  });
  if (error) throw error;
  return data as { ok: true; full_name: string; role: UserRole; silo: Silo; login_email: string; sign_in: 'email' | 'badge' };
}

// ── Created directly (migration 0055) ─────────────────────────────────

/** Open a ten-minute 'direct' invitation, as the administrator. Only a SystemAdmin or the SuperAdmin may. */
export async function createDirectAccount(
  client: CriticomClient,
  args: { personnelId: string; role: UserRole; silo: Silo; email: string; reason: string },
) {
  const { data, error } = await client.rpc('create_direct_account', {
    p_personnel: args.personnelId, p_role: args.role, p_silo: args.silo, p_email: args.email, p_reason: args.reason,
  });
  if (error) throw error;
  return data as { invitation_id: string; login_email: string; full_name: string; badge_number: string };
}

/** Make the profile for a sign-in the server just created. Service role. */
export async function completeDirectAccount(service: CriticomClient, invitationId: string, userId: string) {
  const { data, error } = await service.rpc('complete_direct_account', { p_invitation: invitationId, p_user: userId });
  if (error) throw error;
  return data as { ok: true; full_name: string; role: UserRole; silo: Silo; login_email: string };
}

/** Close a direct creation whose sign-in could not be made. Service role. */
export async function abandonDirectAccount(service: CriticomClient, invitationId: string, note: string) {
  const { error } = await service.rpc('abandon_direct_account', { p_invitation: invitationId, p_note: note });
  if (error) throw error;
}

export async function reportInvitation(service: CriticomClient, secretHash: string, note?: string | null) {
  const { data, error } = await service.rpc('report_invitation', { p_secret_hash: secretHash, p_note: note ?? null });
  if (error) throw error;
  return data as { ok: boolean; state?: InvitationState };
}

/** Count one attempt from a signed-out caller against a named key; false once over the limit. */
export async function hitKeyedRateLimit(service: CriticomClient, key: string, limit: number, windowSeconds: number) {
  const { data, error } = await service.rpc('rate_limit_hit_key', { p_key: key, p_limit: limit, p_window_seconds: windowSeconds });
  if (error) throw error;
  const row = (data as Array<{ allowed: boolean }> | null)?.[0];
  return row?.allowed ?? false;
}

// ── Words for screens ──────────────────────────────────────────────────

export type StatusTone = 'ok' | 'info' | 'warn' | 'crit' | 'dim';

function inDays(ms: number) {
  const hours = Math.round(ms / 3_600_000);
  if (hours < 1) return 'in under an hour';
  if (hours < 24) return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

/** An invitation's state as the invitations list shows it: a chip and a line underneath. */
export function describeInvitation(
  inv: Pick<Invitation, 'status' | 'channel' | 'expires_at' | 'delivery_error' | 'invited_by_name' | 'closed_at' | 'close_note' | 'accepted_at' | 'opened_at'>,
  now = Date.now(),
): { label: string; tone: StatusTone; detail: string } {
  const expiresIn = inv.expires_at ? new Date(inv.expires_at).getTime() - now : null;
  const lapsed = expiresIn !== null && expiresIn <= 0;
  switch (inv.status) {
    case 'awaiting_approval':
      return { label: 'Waiting for approval', tone: 'warn', detail: `asked by ${inv.invited_by_name ?? 'an administrator'}` };
    case 'ready':
      return inv.delivery_error
        ? { label: 'Not delivered', tone: 'crit', detail: inv.delivery_error }
        : { label: inv.channel === 'code' ? 'Ready to print' : 'Ready to send', tone: 'warn', detail: 'nothing sent yet' };
    case 'sent':
      if (lapsed) return { label: 'Expired', tone: 'dim', detail: 'not accepted in time' };
      return {
        label: inv.channel === 'code' ? 'Code issued' : 'Sent', tone: 'info',
        detail: `expires ${inDays(expiresIn ?? 0)}`,
      };
    case 'opened':
      if (lapsed) return { label: 'Expired', tone: 'dim', detail: 'opened but not finished in time' };
      return { label: 'Opened', tone: 'info', detail: `badge confirmed, not finished · expires ${inDays(expiresIn ?? 0)}` };
    case 'accepted':
      return { label: 'Accepted', tone: 'ok', detail: 'account active' };
    case 'rejected':
      return { label: 'Rejected', tone: 'dim', detail: inv.close_note ?? 'approval refused' };
    case 'expired':
      return { label: 'Expired', tone: 'dim', detail: inv.close_note ?? 'not accepted in time' };
    case 'cancelled':
      return { label: 'Cancelled', tone: 'dim', detail: inv.close_note ?? '' };
    case 'locked':
      return { label: 'Locked', tone: 'crit', detail: '5 wrong badge numbers' };
    case 'reported':
      return { label: 'Reported: not me', tone: 'crit', detail: inv.close_note ?? 'the recipient flagged it' };
  }
}

/** What an administrator can still do with an invitation. */
export function invitationActions(status: InvitationStatus, channel: InvitationChannel) {
  return {
    // A direct account (0055) is never sent: it is made at once or cancelled.
    send: channel !== 'direct' && ['ready', 'sent', 'opened', 'expired', 'locked'].includes(status),
    sendLabel: status === 'ready'
      ? (channel === 'code' ? 'Print slip' : 'Send')
      : (channel === 'code' ? 'New slip' : 'Resend'),
    cancel: ['awaiting_approval', 'ready', 'sent', 'opened', 'expired', 'locked'].includes(status),
  };
}
