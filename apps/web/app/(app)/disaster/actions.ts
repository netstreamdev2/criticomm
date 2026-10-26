'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { filePostMortem } from '@criticom/api';
import { postMortemPayload, validatePostMortem } from '@criticom/db/post-mortem';
import { getSession } from '@/lib/session';

const message = (e: unknown, fallback: string) => (e as { message?: string })?.message ?? fallback;

// DisasterController.DispatchResources and LogPeriodicUpdate are the Disaster desk now (0111, disaster/desk).

/**
 * The Official After-Action Report from the console (0065): command closes
 * out a deployed incident. The server checks who may file and what it says.
 */
export async function filePostMortemAction(incidentId: string, answers: Record<string, string>): Promise<{ error: string } | undefined> {
  const problems = validatePostMortem(answers);
  if (problems.length) return { error: problems.join(' ') };
  const { supabase } = await getSession();
  try {
    await filePostMortem(supabase, { incidentId, fields: postMortemPayload(answers) });
  } catch (e) {
    return { error: message(e, 'The post-mortem was not filed.') };
  }
  revalidatePath('/disaster');
  revalidatePath('/disaster/post-mortem');
  redirect(`/incidents/${incidentId}`);
}
