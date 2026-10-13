'use server';

import { revalidatePath } from 'next/cache';
import { cancelLeave, createLeaveEntry, decideLeave } from '@criticom/api';
import { getSession } from '@/lib/session';

/**
 * Leave, through the database's own checks (migration 0072): a request is for
 * yourself, in your own department, dated, typed and not overlapping your
 * other leave; it is decided only by someone senior to you in your
 * department, never yourself, with a reason when refused; it is cancelled by
 * you before it starts, or by someone senior with a reason. These actions only
 * carry the form to those checks and bring back what they say.
 */

export type LeaveResult = { ok?: true; error?: string };

const refresh = () => {
  revalidatePath('/leave');
  revalidatePath('/hr');
  revalidatePath('/command');
  revalidatePath('/roster/mine');
};

export async function applyLeaveAction(formData: FormData): Promise<LeaveResult> {
  const { supabase, silo, userId } = await getSession();
  const from = String(formData.get('eff_from') ?? '');
  const to = String(formData.get('eff_to') ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return { error: 'Choose the first and last day.' };
  }
  try {
    await createLeaveEntry(supabase, {
      // The database files it under your own department whatever is sent.
      silo,
      user_id: userId,
      eff_from: from,
      eff_to: to,
      absence: String(formData.get('absence') ?? ''),
      reason: String(formData.get('reason') ?? '').trim() || null,
      status: 'Pending',
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'The request was not saved.' };
  }
  refresh();
  return { ok: true };
}

export async function decideLeaveAction(formData: FormData): Promise<LeaveResult> {
  const { supabase } = await getSession();
  try {
    await decideLeave(supabase, {
      id: String(formData.get('id') ?? ''),
      approve: String(formData.get('decision')) === 'approve',
      comment: String(formData.get('comment') ?? '').trim() || null,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Not decided.' };
  }
  refresh();
  return { ok: true };
}

export async function cancelLeaveAction(formData: FormData): Promise<LeaveResult> {
  const { supabase } = await getSession();
  try {
    await cancelLeave(supabase, {
      id: String(formData.get('id') ?? ''),
      reason: String(formData.get('reason') ?? '').trim() || null,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Not cancelled.' };
  }
  refresh();
  return { ok: true };
}
