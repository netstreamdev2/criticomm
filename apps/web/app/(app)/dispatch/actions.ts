'use server';

import { revalidatePath } from 'next/cache';
import { tagIncidentDepartments } from '@criticom/api';
import type { Silo } from '@criticom/db';
import { getSession } from '@/lib/session';

const DESKS: Silo[] = ['MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster'];

/**
 * Send a call to another department's dispatch desk (0068). The database
 * decides who may and records who did; its dispatchers are told at once.
 */
export async function sendToDeskAction(
  incidentId: string, silos: Silo[], note: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase } = await getSession();
  const chosen = silos.filter((s) => DESKS.includes(s));
  if (chosen.length === 0) return { ok: false, error: 'Choose the department to send it to.' };
  try {
    await tagIncidentDepartments(supabase, { incident_id: String(incidentId), silos: chosen, note: String(note ?? '').slice(0, 300) || null });
    revalidatePath(`/dispatch/assign/${incidentId}`);
    revalidatePath(`/incidents/${incidentId}`);
    revalidatePath('/dispatch/pending');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as { message?: string })?.message ?? 'It could not be sent. Try again.' };
  }
}
