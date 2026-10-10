'use server';

import { revalidatePath } from 'next/cache';
import {
  cancelAccountRequest, changeAccountRole, decideAccountRequest, getInvitation, setAccountActive,
} from '@criticom/api';
import { roleDepartmentProblem, type Silo, type UserRole } from '@criticom/db';
import { deliverInvitation } from '@/lib/onboarding/server';
import { getSession } from '@/lib/session';

/**
 * Account changes. Each one is a single database function (migration 0048)
 * that decides who may do it, checks the reason and the typed confirmation,
 * holds powerful-role changes for a second SystemAdmin, and writes the
 * permanent history. These actions only carry the form across and report back.
 */

export type AccountActionResult =
  | { ok: true; status: 'applied' | 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled'; message?: string }
  | { ok: false; error: string };

const S = (fd: FormData, key: string) => String(fd.get(key) ?? '').trim();

function failed(e: unknown): AccountActionResult {
  return { ok: false, error: (e as { message?: string })?.message ?? 'The change could not be made.' };
}

function refresh(userId?: string) {
  revalidatePath('/admin');
  revalidatePath('/admin/approvals');
  if (userId) revalidatePath(`/admin/users/${userId}`);
}

export async function changeRoleAction(fd: FormData): Promise<AccountActionResult> {
  const { supabase } = await getSession();
  const userId = S(fd, 'user_id');
  const role = S(fd, 'role') as UserRole;
  const silo = (S(fd, 'silo') || null) as Silo | null;
  try {
    // A field role belongs to one department: checked against the department
    // the person will be in, before anything is sent (the database also refuses it, 0067).
    const { data: target } = await supabase.from('profiles').select('silo').eq('id', userId).maybeSingle();
    const department = silo ?? (target?.silo as Silo | undefined);
    const mismatch = department ? roleDepartmentProblem(role, department) : null;
    if (mismatch) return { ok: false, error: mismatch };
    const res = await changeAccountRole(supabase, {
      userId,
      role,
      silo,
      reason: S(fd, 'reason'),
      confirm: S(fd, 'confirm'),
    });
    refresh(userId);
    return { ok: true, status: res.status };
  } catch (e) {
    return failed(e);
  }
}

export async function setActiveAction(fd: FormData): Promise<AccountActionResult> {
  const { supabase } = await getSession();
  const userId = S(fd, 'user_id');
  try {
    const res = await setAccountActive(supabase, {
      userId,
      active: S(fd, 'active') === 'true',
      reason: S(fd, 'reason'),
      confirm: S(fd, 'confirm'),
    });
    refresh(userId);
    return { ok: true, status: res.status };
  } catch (e) {
    return failed(e);
  }
}

export async function decideRequestAction(fd: FormData): Promise<AccountActionResult> {
  const { supabase } = await getSession();
  try {
    const res = await decideAccountRequest(supabase, {
      requestId: S(fd, 'request_id'),
      approve: S(fd, 'approve') === 'true',
      note: S(fd, 'note') || null,
    });
    refresh(S(fd, 'user_id') || undefined);
    revalidatePath('/admin/invitations');
    // An approved invitation goes out from this same click. A printed code waits
    // on the Invitations page, where whoever prints it actually sees it.
    if (res.status === 'approved' && res.invitation_id) {
      const invitation = await getInvitation(supabase, res.invitation_id);
      if (invitation?.channel === 'code') {
        return { ok: true, status: res.status, message: 'Approved. The activation slip is ready to print on the Invitations page.' };
      }
      const out = await deliverInvitation(supabase, res.invitation_id);
      const message = out.status === 'sent'
        ? `Approved and sent by ${out.channel === 'sms' ? 'SMS' : 'email'} to ${out.to}.`
        : out.status === 'link'
          ? 'Approved. Email is not set up on this development server: use Resend on the Invitations page to see the link.'
          : out.status === 'failed'
            ? `Approved, but it was not delivered (${out.error}). Send it again from the Invitations page.`
            : 'Approved.';
      return { ok: true, status: res.status, message };
    }
    return { ok: true, status: res.status };
  } catch (e) {
    return failed(e);
  }
}

export async function cancelRequestAction(fd: FormData): Promise<AccountActionResult> {
  const { supabase } = await getSession();
  try {
    const res = await cancelAccountRequest(supabase, S(fd, 'request_id'));
    refresh(S(fd, 'user_id') || undefined);
    return { ok: true, status: res.status };
  } catch (e) {
    return failed(e);
  }
}
