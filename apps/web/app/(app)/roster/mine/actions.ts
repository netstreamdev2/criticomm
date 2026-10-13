'use server';

import { revalidatePath } from 'next/cache';
import { acknowledgeAllocation, requestSwap, respondSwap, startMyShift, withdrawSwap } from '@criticom/api';
import { getSession } from '@/lib/session';

/** Your own schedule: confirm a shift, start it at the console, swap it. */

export type MineResult = { ok?: true; error?: string; message?: string };
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const fail = (e: unknown, fallback: string): MineResult => ({ error: e instanceof Error ? e.message : fallback });
const done = () => { revalidatePath('/roster/mine'); revalidatePath('/dashboard'); };

export async function confirmShiftAction(fd: FormData): Promise<MineResult> {
  try {
    const { supabase } = await getSession();
    await acknowledgeAllocation(supabase, str(fd, 'id'));
  } catch (e) {
    return fail(e, 'Not confirmed.');
  }
  done();
  return { ok: true };
}

/** Start shift at the console: checks you in to the shift you are due on. */
export async function startShiftAction(): Promise<MineResult> {
  try {
    const { supabase } = await getSession();
    const res = await startMyShift(supabase);
    done();
    if (!res.checked_in) return { ok: true, message: 'Clocked in. You are not on the roster now.' };
    return {
      ok: true,
      message: (res.late_minutes ?? 0) > 0 ? `Started, ${res.late_minutes} min after the start.` : 'Started on time.',
    };
  } catch (e) {
    return fail(e, 'Not started.');
  }
}

export async function requestSwapAction(fd: FormData): Promise<MineResult> {
  try {
    const { supabase } = await getSession();
    await requestSwap(supabase, { id: crypto.randomUUID(), myLine: str(fd, 'myLine'), theirLine: str(fd, 'theirLine'), note: str(fd, 'note') || null });
  } catch (e) {
    return fail(e, 'The swap was not asked for.');
  }
  done();
  return { ok: true };
}

export async function respondSwapAction(fd: FormData): Promise<MineResult> {
  try {
    const { supabase } = await getSession();
    await respondSwap(supabase, { id: str(fd, 'id'), accept: str(fd, 'answer') === 'accept' });
  } catch (e) {
    return fail(e, 'Not answered.');
  }
  done();
  return { ok: true };
}

export async function withdrawSwapAction(fd: FormData): Promise<MineResult> {
  try {
    const { supabase } = await getSession();
    await withdrawSwap(supabase, str(fd, 'id'));
  } catch (e) {
    return fail(e, 'Not withdrawn.');
  }
  done();
  return { ok: true };
}
