'use server';

import { revalidatePath } from 'next/cache';
import { importPastEvents } from '@criticom/api';
import { BRIEFING_ROWS, BRIEFING_SOURCE, SAWS_RECORDS, sawsRecordRows } from '@/lib/maps/records';
import { getSession } from '@/lib/session';

/**
 * Load the past disasters into the records (0119): SAWS's record of weather
 * disasters in eThekwini, read from the NDMC now, and the major events in
 * the Director's briefing. Loading again updates the same rows. The
 * database checks that the person works the Disaster desk.
 */
export async function loadRecordsAction(): Promise<{ error: string } | { loaded: number; skipped: number }> {
  const { supabase } = await getSession();
  let saws: Awaited<ReturnType<typeof sawsRecordRows>>;
  try {
    saws = await sawsRecordRows();
  } catch {
    return { error: 'The NDMC did not answer. Try again in a few minutes.' };
  }
  try {
    const a = await importPastEvents(supabase, SAWS_RECORDS, saws);
    const b = await importPastEvents(supabase, BRIEFING_SOURCE, BRIEFING_ROWS);
    revalidatePath('/disaster/records');
    revalidatePath('/disaster/wards', 'layout');
    return { loaded: a.loaded + b.loaded, skipped: a.skipped + b.skipped };
  } catch (e) {
    return { error: String((e as { message?: string })?.message ?? 'The records were not loaded.') };
  }
}
