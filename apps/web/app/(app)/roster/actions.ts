'use server';

import { revalidatePath } from 'next/cache';
import {
  addEndorsement, addShift, cancelShift, deactivateEndorsement, decideSwap, generateRoster,
  publishRoster, recordShiftOutcome, setMemberTeam,
} from '@criticom/api';
import { canManageRoster, type ShiftOutcome, type Silo } from '@criticom/db';
import { getSession } from '@/lib/session';

/**
 * Roster planner actions. Each goes through a database function that checks
 * who is asking and refuses clashes (migration 0072); the role check here
 * only turns a stranger away before the round trip, and what the database
 * says comes back to the screen as it is.
 */

export type RosterResult = { ok?: true; error?: string; message?: string };

async function rosterer(silo: string | null) {
  const session = await getSession();
  const target = (silo || session.silo) as Silo;
  if (!canManageRoster(session.role, session.silo, target)) throw new Error('You do not roster this department.');
  return { ...session, target };
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const fail = (e: unknown, fallback: string): RosterResult => ({ error: e instanceof Error ? e.message : fallback });
const done = () => {
  revalidatePath('/roster');
  revalidatePath('/roster/allocation');
  revalidatePath('/roster/mine');
};

export async function addShiftAction(fd: FormData): Promise<RosterResult> {
  try {
    const { supabase } = await rosterer(str(fd, 'silo'));
    await addShift(supabase, {
      userId: str(fd, 'userId'),
      day: str(fd, 'day'),
      templateId: str(fd, 'templateId'),
      publish: str(fd, 'publish') === 'on',
      note: str(fd, 'note') || null,
    });
  } catch (e) {
    return fail(e, 'The shift was not added.');
  }
  done();
  return { ok: true };
}

export async function cancelShiftAction(fd: FormData): Promise<RosterResult> {
  try {
    const { supabase } = await rosterer(str(fd, 'silo'));
    await cancelShift(supabase, str(fd, 'id'), str(fd, 'reason'));
  } catch (e) {
    return fail(e, 'The shift was not cancelled.');
  }
  done();
  return { ok: true };
}

export async function generateAction(fd: FormData): Promise<RosterResult & { created?: number; skipped?: number; reasons?: Array<{ name: string; day: string; reason: string }> }> {
  try {
    const { supabase } = await rosterer(str(fd, 'silo'));
    const teams = fd.getAll('teams').map(String).filter(Boolean);
    const res = await generateRoster(supabase, {
      rotationId: str(fd, 'rotationId'), from: str(fd, 'from'), to: str(fd, 'to'), teams,
    });
    done();
    return { ok: true, created: res.created, skipped: res.skipped, reasons: res.reasons };
  } catch (e) {
    return fail(e, 'The roster was not built.');
  }
}

export async function publishAction(fd: FormData): Promise<RosterResult & { count?: number }> {
  try {
    const { supabase, target } = await rosterer(str(fd, 'silo'));
    const count = await publishRoster(supabase, { silo: target, from: str(fd, 'from'), to: str(fd, 'to') });
    done();
    return { ok: true, count };
  } catch (e) {
    return fail(e, 'The roster was not issued.');
  }
}

export async function outcomeAction(fd: FormData): Promise<RosterResult> {
  try {
    const { supabase } = await rosterer(str(fd, 'silo'));
    await recordShiftOutcome(supabase, {
      rosterId: str(fd, 'id'), outcome: str(fd, 'outcome') as ShiftOutcome, reason: str(fd, 'reason'),
    });
  } catch (e) {
    return fail(e, 'Not recorded.');
  }
  done();
  revalidatePath('/dashboard');
  return { ok: true };
}

export async function decideSwapAction(fd: FormData): Promise<RosterResult> {
  try {
    const { supabase } = await rosterer(str(fd, 'silo'));
    await decideSwap(supabase, { id: str(fd, 'id'), approve: str(fd, 'decision') === 'approve', comment: str(fd, 'comment') || null });
  } catch (e) {
    return fail(e, 'Not decided.');
  }
  done();
  return { ok: true };
}

export async function setTeamAction(fd: FormData): Promise<RosterResult> {
  try {
    const { supabase } = await rosterer(str(fd, 'silo'));
    await setMemberTeam(supabase, str(fd, 'userId'), str(fd, 'team') || null);
  } catch (e) {
    return fail(e, 'The team was not changed.');
  }
  revalidatePath('/roster');
  revalidatePath('/roster/setup');
  return { ok: true };
}

export async function addEndorsementAction(fd: FormData): Promise<RosterResult> {
  try {
    const { supabase, target, fullName } = await rosterer(str(fd, 'silo'));
    const [userId, name] = str(fd, 'member').split('|');
    if (!userId) return { error: 'Choose the member.' };
    const type = str(fd, 'type');
    const startDate = str(fd, 'start_date');
    // A court date with no end is that one day, never open-ended: it keeps
    // the person off the roster for as long as it runs.
    const endDate = str(fd, 'end_date') || (type === 'Court Attendance' ? startDate : '');
    await addEndorsement(supabase, {
      silo: target,
      user_id: userId,
      employee_name: name || null,
      type,
      details: str(fd, 'details') || null,
      start_date: startDate,
      end_date: endDate || null,
      is_active: true,
      created_by: fullName,
    });
  } catch (e) {
    return fail(e, 'Not added.');
  }
  revalidatePath('/roster');
  return { ok: true };
}

export async function deactivateEndorsementAction(fd: FormData): Promise<RosterResult> {
  try {
    const { supabase } = await rosterer(str(fd, 'silo'));
    await deactivateEndorsement(supabase, str(fd, 'id'));
  } catch (e) {
    return fail(e, 'Not removed.');
  }
  revalidatePath('/roster');
  return { ok: true };
}
