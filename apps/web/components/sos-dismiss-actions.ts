'use server';

import { revalidatePath } from 'next/cache';
import { dismissSos } from '@criticom/api';
import { getSession } from '@/lib/session';

/**
 * Dismiss an SOS pressed by mistake (0093). The database decides who may
 * (the system administrators, the system controller and dispatch), takes it
 * off every screen and alert, and keeps it on the record.
 */
export async function dismissSosAction(incidentId: string, reason: string): Promise<{ ok: true } | { error: string }> {
  const { supabase } = await getSession();
  try {
    await dismissSos(supabase, incidentId, reason);
  } catch (e) {
    const message = (e as { message?: string }).message ?? '';
    if (/Not permitted/.test(message)) return { error: 'Only the control room, dispatch and the system administrators may dismiss an SOS.' };
    if (/schema cache|Could not find the function/.test(message)) return { error: 'Dismissing an SOS is not set up yet. Ask the system administrator.' };
    return { error: message || 'The SOS was not dismissed. Try again.' };
  }
  // Every screen that shows it: the banner and map in the layout, the call, the dashboards.
  revalidatePath('/', 'layout');
  return { ok: true };
}
