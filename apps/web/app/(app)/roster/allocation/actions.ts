'use server';

import { revalidatePath } from 'next/cache';
import {
  acknowledgeAllocation, assignToPost, copyDayForward, logAudit,
  publishDay, setDutyPostActive, unassign, upsertDutyPost,
} from '@criticom/api';
import { SUPERVISORY_ROLES, type Silo } from '@criticom/db';
import { getSession } from '@/lib/session';

/**
 * Duty allocation actions.
 *
 * Building the board is supervisory; acknowledging your own duty is not. Both
 * checks live here rather than relying on the route matrix, because Server
 * Actions post to the page the caller is already on.
 */

async function requireDutyOfficer() {
  const session = await getSession();
  if (!SUPERVISORY_ROLES.includes(session.role)) throw new Error('Forbidden');
  return session;
}

const day = (fd: FormData) => String(fd.get('date') ?? '').slice(0, 10);

export async function assignAction(formData: FormData) {
  const { supabase, silo, fullName } = await requireDutyOfficer();
  const date = day(formData);
  const userId = String(formData.get('userId') ?? '');
  const userName = String(formData.get('userName') ?? '');
  if (!date || !userId || !userName) return { error: 'Pick a member and a date.' };

  try {
    await assignToPost(supabase, {
      silo: (String(formData.get('silo') ?? silo) as Silo),
      date,
      postId: String(formData.get('postId') ?? '') || null,
      userId,
      userName,
      badgeNumber: String(formData.get('badge') ?? '') || null,
      station: String(formData.get('station') ?? '') || null,
      activityType: String(formData.get('activity') ?? '') || null,
      vehicle: String(formData.get('vehicle') ?? '') || null,
      sector: String(formData.get('sector') ?? '') || null,
      callSign: String(formData.get('callSign') ?? '') || null,
      specialInstructions: String(formData.get('instructions') ?? '') || null,
      bySupervisorName: fullName,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not allocate.' };
  }
  revalidatePath('/roster/allocation');
  return { ok: true };
}

export async function unassignAction(formData: FormData) {
  const { supabase } = await requireDutyOfficer();
  const id = String(formData.get('id') ?? '');
  if (id) await unassign(supabase, id).catch(() => {});
  revalidatePath('/roster/allocation');
}

export async function publishDayAction(formData: FormData) {
  const { supabase, silo, fullName } = await requireDutyOfficer();
  const date = day(formData);
  if (!date) return { error: 'No date.' };

  const targetSilo = (String(formData.get('silo') ?? silo) as Silo);
  const count = await publishDay(supabase, { silo: targetSilo, date });

  // Issuing a duty board is the moment it becomes an instruction to staff, so
  // it belongs in the audit trail alongside dispatch decisions.
  await logAudit(supabase, {
    silo: targetSilo,
    action_type: 'DutyBoardPublished',
    entity_type: 'roster',
    entity_id: date,
    user_name: fullName,
    details: `Published ${count} allocation(s) for ${date}`,
  }).catch(() => {});

  revalidatePath('/roster/allocation');
  return { ok: true, count };
}

export async function copyForwardAction(formData: FormData) {
  const { supabase, silo, fullName } = await requireDutyOfficer();
  const from = String(formData.get('from') ?? '').slice(0, 10);
  const to = String(formData.get('to') ?? '').slice(0, 10);
  if (!from || !to || from === to) return { error: 'Choose two different dates.' };

  try {
    const res = await copyDayForward(supabase, {
      silo: (String(formData.get('silo') ?? silo) as Silo),
      from, to, bySupervisorName: fullName,
    });
    revalidatePath('/roster/allocation');
    return { ok: true, ...res };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not copy the day.' };
  }
}

export async function savePostAction(formData: FormData) {
  const { supabase, silo } = await requireDutyOfficer();
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
      silo: (String(formData.get('silo') ?? silo) as Silo),
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
    return { error: e instanceof Error ? e.message : 'Could not save the post.' };
  }
  revalidatePath('/roster/allocation');
  return { ok: true };
}

export async function retirePostAction(formData: FormData) {
  const { supabase } = await requireDutyOfficer();
  const id = String(formData.get('id') ?? '');
  // Retire rather than delete: allocation history must keep pointing somewhere.
  if (id) await setDutyPostActive(supabase, id, false).catch(() => {});
  revalidatePath('/roster/allocation');
}

/** A member confirming their own duty — not a supervisory act. */
export async function acknowledgeAction(formData: FormData) {
  const { supabase } = await getSession();
  const id = String(formData.get('id') ?? '');
  // RLS (rosters_self_acknowledge) restricts this to the member's own
  // published rows, so no extra ownership check is needed here.
  if (id) await acknowledgeAllocation(supabase, id).catch(() => {});
  revalidatePath('/roster/allocation');
  revalidatePath('/roster/mine');
}
