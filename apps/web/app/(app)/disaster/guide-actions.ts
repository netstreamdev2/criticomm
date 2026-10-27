'use server';

import { revalidatePath } from 'next/cache';
import { practiceStep, setGuideStatus, startPracticeIncident } from '@criticom/api';
import { getSession } from '@/lib/session';

/**
 * Criti's tour and the practice incident (0121). The tour's answer is kept
 * with the person's account; a practice incident is theirs alone and never
 * reaches the desk. The database checks both.
 */

const fail = (e: unknown, fallback: string) => ({ error: String((e as { message?: string })?.message ?? fallback).replace(/^error:\s*/i, '') });

export async function guideStatusAction(guide: string, status: 'done' | 'dismissed'): Promise<{ error: string } | { ok: true }> {
  const { supabase } = await getSession();
  try {
    await setGuideStatus(supabase, guide, status);
  } catch (e) {
    return fail(e, 'Not saved.');
  }
  revalidatePath('/disaster', 'layout');
  return { ok: true };
}

export async function startPracticeAction(fields: Record<string, string>) {
  const { supabase } = await getSession();
  try {
    const p = await startPracticeIncident(supabase, fields);
    revalidatePath('/disaster/practice');
    return { id: p.id };
  } catch (e) {
    return fail(e, 'The practice incident was not started.');
  }
}

export async function practiceStepAction(id: string, step: string, fields: Record<string, unknown>): Promise<{ error: string } | { ok: true }> {
  const { supabase } = await getSession();
  try {
    await practiceStep(supabase, id, step, fields);
  } catch (e) {
    return fail(e, 'That step was not saved.');
  }
  revalidatePath('/disaster/practice');
  return { ok: true };
}
