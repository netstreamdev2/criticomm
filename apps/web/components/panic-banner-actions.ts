'use server';

import { revalidatePath } from 'next/cache';
import { markAlertRead } from '@criticom/api';
import { getSession } from '@/lib/session';

/** × on the SOS banner: the same acknowledgement as × on the pop-up. */
export async function clearSosAction(formData: FormData) {
  const { supabase } = await getSession();
  const alertId = String(formData.get('alert_id') ?? '');
  if (!alertId) return;
  await markAlertRead(supabase, alertId, { acknowledged: true });
  revalidatePath('/', 'layout');
}
