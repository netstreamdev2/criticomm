'use server';

import { revalidatePath } from 'next/cache';
import {
  acknowledgeAllocation, assignToPost, copyDayForward,
  publishDay, setDutyPostActive, unassign, upsertDutyPost,
} from '@criticom/api';
import { canManageRoster, type Silo } from '@criticom/db';
import { getSession } from '@/lib/session';

/**
 * Duty allocation actions.
 *
 * Building the board is for those who roster the department; acknowledging
 * your own duty is not. The database checks both again (migration 0072) —
 * this only turns a stranger away before the round trip.
 */

async function requireDutyOfficer(target?: string | null) {
  const session = await getSession();
  const silo = (target || session.silo) as Silo;
  if (!canManageRoster(session.role, session.silo, silo)) throw new Error('Forbidden');
  return { ...session, target: silo };
}

const day = (fd: FormData) => String(fd.get('date') ?? '').slice(0, 10);
const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export async function assignAction(formData: FormData) {
  const { supabase } = await requireDutyOfficer(String(formData.get('silo') ?? ''));
  const date = day(formData);
  const userId = String(formData.get('userId') ?? '');
  const postId = String(formData.get('postId') ?? '');
  if (!date || !userId || !postId) return { error: 'Pick a member, a post and a date.' };

  try {
    await assignToPost(supabase, {
      postId,
      date,
      userId,
      templateId: String(formData.get('templateId') ?? '') || null,
    });
  } catch (e) {
    return { error: message(e, 'Could not allocate.') };
  }
  revalidatePath('/roster/allocation');
  return { ok: true };
}

export async function unassignAction(formData: FormData) {
  const { supabase } = await requireDutyOfficer(String(formData.get('silo') ?? ''));
  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Nothing to remove.' };
  try {
    await unassign(supabase, id);
  } catch (e) {
    return { error: message(e, 'Could not remove.') };
  }
  revalidatePath('/roster/allocation');
  return { ok: true };
}

export async function publishDayAction(formData: FormData) {
  const { supabase, target } = await requireDutyOfficer(String(formData.get('silo') ?? ''));
  const date = day(formData);
  if (!date) return { error: 'No date.' };
  try {
    // publish_roster tells each person and writes the audit trail.
    const count = await publishDay(supabase, { silo: target, date });
    revalidatePath('/roster/allocation');
    return { ok: true, count };
  } catch (e) {
    return { error: message(e, 'Could not publish.') };
  }
}

export async function copyForwardAction(formData: FormData) {
  const { supabase, target } = await requireDutyOfficer(String(formData.get('silo') ?? ''));
  const from = String(formData.get('from') ?? '').slice(0, 10);
  const to = String(formData.get('to') ?? '').slice(0, 10);
  if (!from || !to || from === to) return { error: 'Choose two different dates.' };

  try {
    const res = await copyDayForward(supabase, { silo: target, from, to });
    revalidatePath('/roster/allocation');
    return { ok: true, ...res };
  } catch (e) {
    return { error: message(e, 'Could not copy the day.') };
  }
}

export async function savePostAction(formData: FormData) {
  const { supabase, target } = await requireDutyOfficer(String(formData.get('silo') ?? ''));
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { error: 'The post needs a name.' };

  const minStaff = Number(formData.get('minStaff') ?? 1);
  if (!Number.isFinite(minStaff) || minStaff < 1 || minStaff > 50) {
    return { error: 'Crew requirement must be between 1 and 50.' };
  }

  const id = String(formData.get('id') ?? '').trim();
  try {
    await upsertDutyPost(supabase, {
      ...(id ? { id } : {}),
      silo: target,
      name,
      station: String(formData.get('station') ?? '') || null,
      sector: String(formData.get('sector') ?? '') || null,
      vehicle: String(formData.get('vehicle') ?? '') || null,
      call_sign: String(formData.get('callSign') ?? '') || null,
      activity_type: String(formData.get('activity') ?? '') || null,
      min_staff: minStaff,
      sort_order: Number(formData.get('sortOrder') ?? 0) || 0,
    });
  } catch (e) {
    return { error: message(e, 'Could not save the post.') };
  }
  revalidatePath('/roster/allocation');
  return { ok: true };
}

export async function retirePostAction(formData: FormData) {
  const { supabase } = await requireDutyOfficer(String(formData.get('silo') ?? ''));
  const id = String(formData.get('id') ?? '');
  // Retire rather than delete: allocation history must keep pointing somewhere.
  if (id) await setDutyPostActive(supabase, id, false).catch(() => {});
  revalidatePath('/roster/allocation');
}

/** A member confirming their own duty — not a supervisory act. */
export async function acknowledgeAction(formData: FormData) {
  const { supabase } = await getSession();
  const id = String(formData.get('id') ?? '');
  // The database lets the person change only this, on their own issued duty.
  if (id) await acknowledgeAllocation(supabase, id).catch(() => {});
  revalidatePath('/roster/allocation');
  revalidatePath('/roster/mine');
}
