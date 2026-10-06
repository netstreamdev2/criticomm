'use server';

import { revalidatePath } from 'next/cache';
import {
  cancelInvitation, createInvitation, getRegisterPeople, searchStaffForInvite, type InviteChannel, type StaffForInvite,
} from '@criticom/api';
import { inviteChannelFor, type Silo, type UserRole } from '@criticom/db';
import { invitationErrorMessage } from '@/lib/onboarding/errors';
import {
  createAccountDirectly, deliverInvitation, deliveryOptions, type DeliveryOutcome, type DirectAccount,
} from '@/lib/onboarding/server';
import { getSession } from '@/lib/session';

/**
 * Invitations, for administrators. Each step runs with the administrator's
 * own session, so the database decides who may invite whom, and approval of
 * powerful roles cannot be skipped. These actions carry the form across,
 * deliver the invitation and report back in plain words.
 */

export type InviteResult =
  | { ok: true; outcome: DeliveryOutcome | { status: 'awaiting_approval' } }
  | { ok: false; error: string };

const messageOf = (e: unknown) => invitationErrorMessage(e);

function refresh() {
  revalidatePath('/admin/invitations');
  revalidatePath('/admin/approvals');
  revalidatePath('/admin');
}

/** The staff register, searched as this administrator may see it. */
export async function searchStaffAction(
  query: string,
): Promise<{ ok: true; people: StaffForInvite[] } | { ok: false; error: string }> {
  const { supabase } = await getSession();
  try {
    return { ok: true, people: await searchStaffForInvite(supabase, String(query).slice(0, 80)) };
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
}

export async function createInvitationAction(input: {
  personnelId: string; role: UserRole; silo: Silo; channel: InviteChannel;
  email: string; phone: string; reason: string; checkedWithPerson: boolean;
}): Promise<InviteResult> {
  const { supabase } = await getSession();
  if (input.channel !== 'code' && !input.checkedWithPerson) {
    return { ok: false, error: 'Confirm you have checked the address or number with the person.' };
  }
  try {
    const created = await createInvitation(supabase, {
      personnelId: input.personnelId,
      role: input.role,
      silo: input.silo,
      channel: input.channel,
      email: input.channel === 'email' ? input.email : null,
      phone: input.channel === 'sms' ? input.phone : null,
      reason: input.reason,
    });
    refresh();
    if (created.status === 'awaiting_approval') return { ok: true, outcome: { status: 'awaiting_approval' } };
    // The invitation exists from here on: a failure to deliver is reported as
    // such, so the administrator sends it again from the list rather than
    // re-inviting and meeting "already open".
    const outcome = await deliverInvitation(supabase, created.invitation_id)
      .catch((e): DeliveryOutcome => ({ status: 'failed', error: messageOf(e) }));
    refresh();
    return { ok: true, outcome };
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
}

/**
 * The fourth way in (migration 0055): a SystemAdmin or the SuperAdmin sets the
 * password and the account is active at once. The database refuses anyone
 * else, and any role that needs a second SystemAdmin.
 */
export async function createAccountDirectlyAction(input: {
  personnelId: string; role: UserRole; silo: Silo; email: string;
  password: string; confirmPassword: string; reason: string; handOverAgreed: boolean;
}): Promise<DirectAccount> {
  const { supabase, role } = await getSession();
  if (role !== 'SystemAdmin' && role !== 'SuperAdmin') {
    return { ok: false, message: 'Only a SystemAdmin or the SuperAdmin can create an account directly.' };
  }
  if (String(input.password) !== String(input.confirmPassword)) return { ok: false, message: 'The two passwords do not match.' };
  if (!input.handOverAgreed) return { ok: false, message: 'Confirm you will give the password to the person yourself.' };
  try {
    const result = await createAccountDirectly(supabase, {
      personnelId: String(input.personnelId), role: input.role, silo: input.silo,
      email: String(input.email).trim(), password: String(input.password), reason: String(input.reason).trim(),
    });
    refresh();
    revalidatePath('/admin/personnel');
    revalidatePath('/admin/rollout');
    return result;
  } catch (e) {
    return { ok: false, message: messageOf(e) };
  }
}

/** Send, resend, or print a new slip. Any earlier link or code stops working. */
export async function sendInvitationAction(invitationId: string): Promise<InviteResult> {
  const { supabase } = await getSession();
  try {
    const outcome = await deliverInvitation(supabase, String(invitationId));
    refresh();
    return { ok: true, outcome };
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
}

export async function cancelInvitationAction(invitationId: string, note: string): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await getSession();
  try {
    await cancelInvitation(supabase, String(invitationId), note || null);
    refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
}

// ── Many at once ───────────────────────────────────────────────────────

/** What happened for one person in a bulk run. */
export type BulkItemResult = {
  key: string;
  name: string;
  /** sent / link / slip / failed come from delivery; skipped means nothing was created. */
  status: DeliveryOutcome['status'] | 'skipped' | 'awaiting_approval';
  message?: string;
  outcome?: DeliveryOutcome;
};

const BULK_LIMIT = 10;

/**
 * Invite people from the staff register, a few at a time (the screen calls
 * this repeatedly and shows progress). Only their IDs and the reason come
 * from the browser: the role, department, address and route are read from
 * the register here, and each invitation goes through the same database
 * rules as one made by hand.
 */
export async function inviteFromRegisterAction(
  personnelIds: string[], reason: string, contactsFromHr: boolean,
): Promise<{ ok: true; results: BulkItemResult[] } | { ok: false; error: string }> {
  const { supabase } = await getSession();
  if (!contactsFromHr) return { ok: false, error: 'Confirm the addresses and numbers come from HR’s staff list.' };
  const ids = personnelIds.map(String).slice(0, BULK_LIMIT);
  let people: Awaited<ReturnType<typeof getRegisterPeople>>;
  try {
    people = await getRegisterPeople(supabase, ids);
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
  const available = deliveryOptions();
  const results: BulkItemResult[] = [];
  for (const id of ids) {
    const p = people.find((x) => x.id === id);
    if (!p) { results.push({ key: id, name: 'Unknown person', status: 'skipped', message: 'Not in your staff register' }); continue; }
    const name = `${p.first_name} ${p.last_name}`.trim();
    const skip = (message: string) => results.push({ key: id, name, status: 'skipped', message });
    if (p.left_at) { skip('Has left'); continue; }
    if (p.user_id) { skip('Already has an account'); continue; }
    if (!p.proposed_role || !p.role_confirmed_at) { skip('Role not confirmed'); continue; }
    const channel = inviteChannelFor(p, available);
    try {
      const created = await createInvitation(supabase, {
        personnelId: p.id, role: p.proposed_role, silo: p.silo, channel,
        email: channel === 'email' ? p.work_email : null,
        phone: channel === 'sms' ? p.work_cellphone : null,
        reason,
      });
      if (created.status === 'awaiting_approval') {
        results.push({ key: id, name, status: 'awaiting_approval', message: 'Waiting for a second SystemAdmin' });
        continue;
      }
      const outcome = await deliverInvitation(supabase, created.invitation_id)
        .catch((e): DeliveryOutcome => ({ status: 'failed', error: messageOf(e) }));
      results.push({ key: id, name, status: outcome.status, outcome, message: outcome.status === 'failed' ? outcome.error : undefined });
    } catch (e) {
      const message = messageOf(e);
      // Someone already invited is skipped, not failed: their invitation stands.
      results.push({ key: id, name, status: /already open|already has an account/i.test(message) ? 'skipped' : 'failed', message });
    }
  }
  refresh();
  revalidatePath('/admin/personnel');
  revalidatePath('/admin/rollout');
  return { ok: true, results };
}

/** Send fresh links or codes for open invitations, a few at a time: the old ones stop working. */
export async function resendManyAction(
  invitations: Array<{ id: string; name: string }>,
): Promise<{ ok: true; results: BulkItemResult[] }> {
  const { supabase } = await getSession();
  const results: BulkItemResult[] = [];
  for (const inv of invitations.slice(0, BULK_LIMIT)) {
    const outcome = await deliverInvitation(supabase, String(inv.id))
      .catch((e): DeliveryOutcome => ({ status: 'failed', error: messageOf(e) }));
    results.push({ key: inv.id, name: inv.name, status: outcome.status, outcome, message: outcome.status === 'failed' ? outcome.error : undefined });
  }
  refresh();
  revalidatePath('/admin/rollout');
  return { ok: true, results };
}
