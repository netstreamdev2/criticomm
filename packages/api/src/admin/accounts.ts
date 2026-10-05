import type { CriticomClient, Database, Silo, UserRole } from '@criticom/db';
import { DEPARTMENT_NAMES } from '@criticom/db/onboarding';

/**
 * Account administration (migration 0048). Every change goes through a
 * database function that checks who may make it, takes a reason and a typed
 * confirmation, holds powerful-role changes for a second SystemAdmin, and
 * writes the permanent history. Nothing here writes a profile directly.
 */

type Tables = Database['public']['Tables'];
export type AccountHistoryEntry = Tables['account_history']['Row'];
export type AccountRequest = Tables['account_requests']['Row'];

/** Applied at once, or waiting for a second SystemAdmin. */
export type AccountChangeResult = { status: 'applied' | 'pending'; request_id?: string };

export async function changeAccountRole(
  client: CriticomClient,
  args: { userId: string; role: UserRole; silo?: Silo | null; reason: string; confirm: string },
): Promise<AccountChangeResult> {
  const { data, error } = await client.rpc('change_account_role', {
    p_user: args.userId,
    p_role: args.role,
    p_reason: args.reason,
    p_confirm: args.confirm,
    p_silo: args.silo ?? null,
  });
  if (error) throw error;
  return data as AccountChangeResult;
}

export async function setAccountActive(
  client: CriticomClient,
  args: { userId: string; active: boolean; reason: string; confirm: string },
): Promise<AccountChangeResult> {
  const { data, error } = await client.rpc('set_account_active', {
    p_user: args.userId,
    p_active: args.active,
    p_reason: args.reason,
    p_confirm: args.confirm,
  });
  if (error) throw error;
  return data as AccountChangeResult;
}

export async function decideAccountRequest(
  client: CriticomClient,
  args: { requestId: string; approve: boolean; note?: string | null },
) {
  const { data, error } = await client.rpc('decide_account_request', {
    p_request: args.requestId,
    p_approve: args.approve,
    p_note: args.note ?? null,
  });
  if (error) throw error;
  return data as { status: 'approved' | 'rejected' | 'expired'; invitation_id?: string };
}

export async function cancelAccountRequest(client: CriticomClient, requestId: string) {
  const { data, error } = await client.rpc('cancel_account_request', { p_request: requestId });
  if (error) throw error;
  return data as { status: 'cancelled' };
}

/** One account, with the personnel badge the confirmation may need. */
export async function getAccount(client: CriticomClient, userId: string) {
  const [{ data: profile, error }, { data: personnel }] = await Promise.all([
    client.from('profiles').select('*').eq('id', userId).maybeSingle(),
    client.from('personnel').select('badge_number').eq('user_id', userId).limit(1).maybeSingle(),
  ]);
  if (error) throw error;
  return profile ? { profile, personnelBadge: personnel?.badge_number ?? null } : null;
}

/** An account's permanent history, newest first. */
export async function listAccountHistory(client: CriticomClient, userId: string) {
  const { data, error } = await client
    .from('account_history')
    .select('*')
    .eq('user_id', userId)
    .order('at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return data ?? [];
}

/** Requests in this organisation: the open ones, or the recently decided. */
export async function listAccountRequests(
  client: CriticomClient,
  args: { open: boolean; userId?: string; limit?: number },
) {
  let q = client.from('account_requests').select('*');
  q = args.open ? q.eq('status', 'pending') : q.neq('status', 'pending');
  if (args.userId) q = q.eq('user_id', args.userId);
  const { data, error } = await q
    .order(args.open ? 'requested_at' : 'decided_at', { ascending: !args.open })
    .limit(args.limit ?? 50);
  if (error) throw error;
  return data ?? [];
}

/** Active SystemAdmins in this organisation (the floor is two). */
export async function countActiveSystemAdmins(client: CriticomClient) {
  const { count, error } = await client
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'SystemAdmin')
    .is('deactivated_at', null);
  if (error) throw error;
  return count ?? 0;
}

/** A request waits at most this long for a second SystemAdmin. */
export const ACCOUNT_REQUEST_DAYS = 7;

/** Whether an open request has passed its 7 days (the database expires it on the next decision). */
export function requestExpired(req: Pick<AccountRequest, 'requested_at'>, now = Date.now()) {
  return now - new Date(req.requested_at).getTime() > ACCOUNT_REQUEST_DAYS * 86_400_000;
}

/** A request in one line, as the approver reads it. */
export function describeRequest(req: Pick<AccountRequest, 'action' | 'user_name' | 'from_role' | 'to_role' | 'from_silo' | 'to_silo'>) {
  const who = req.user_name ?? 'this account';
  if (req.action === 'invite') {
    return `Invite ${req.user_name ?? 'someone'} as ${req.to_role} in ${DEPARTMENT_NAMES[req.to_silo as Silo] ?? req.to_silo}`;
  }
  if (req.action === 'deactivate') return `Deactivate ${who}`;
  if (req.action === 'reactivate') return `Reactivate ${who}`;
  if (req.from_role === req.to_role) return `Move ${who} from ${req.from_silo} to ${req.to_silo}`;
  const dept = req.to_silo !== req.from_silo ? ` in ${req.to_silo}` : '';
  return `Change ${who} from ${req.from_role} to ${req.to_role}${dept}`;
}
