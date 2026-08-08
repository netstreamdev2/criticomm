'use server';

import { revalidatePath } from 'next/cache';
import { clockEvent, lastClockEvent, logAudit } from '@criticom/api';
import { getSession } from '@/lib/session';

export async function clockAction(formData: FormData) {
  const { supabase, silo, userId, fullName } = await getSession();
  const kind = String(formData.get('kind')) as 'clock_in' | 'clock_out';
  if (kind !== 'clock_in' && kind !== 'clock_out') return;

  // Refuse a double-punch: the register is append-only, so the guard has to
  // sit here rather than on the row.
  const last = await lastClockEvent(supabase, userId);
  if (last?.kind === kind) return;

  await clockEvent(supabase, {
    kind,
    userName: fullName,
    source: 'console',
    note: String(formData.get('note') ?? '').trim() || undefined,
  });
  await logAudit(supabase, {
    silo: silo === 'Ethekwini' ? 'MetroPolice' : silo,
    action_type: kind === 'clock_in' ? 'ClockedIn' : 'ClockedOut',
    entity_type: 'attendance_event', user_name: fullName,
  }).catch(() => {});

  revalidatePath('/attendance');
}
