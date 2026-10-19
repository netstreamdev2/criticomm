'use server';

import { revalidatePath } from 'next/cache';
import { allocateDuty, type AllocationResult } from '@criticom/api';
import { getSession } from '@/lib/session';

/**
 * Book the pairs for every day in the range. allocate_duty checks Duty
 * Allocation Edit, and leaves out (with the reason) any day a member is on
 * leave, in court or already on duty.
 */
export async function allocateAction(input: {
  sectionId: string; from: string; to: string; lines: Array<{ post_id: string; user_id: string }>; note?: string | null;
}): Promise<{ error?: string; result?: AllocationResult }> {
  const { supabase } = await getSession();
  try {
    const result = await allocateDuty(supabase, input);
    for (const p of ['/modules/duty-allocation', '/modules/duty-maintenance', '/modules/duty-operations', '/roster', '/roster/mine']) revalidatePath(p);
    return { result };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Not allocated' };
  }
}
