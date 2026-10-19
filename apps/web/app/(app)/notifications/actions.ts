'use server';

import { revalidatePath } from 'next/cache';
import { sendNotification, withdrawNotification, type SendNotificationInput } from '@criticom/api';
import type { Silo, UserRole } from '@criticom/db';
import { getSession } from '@/lib/session';

export type SendState = { ok?: boolean; error?: string } | null;

const S = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

/**
 * Send a notification. The form only offers what notification_reach() allows;
 * the database checks it again, so a crafted request gets its refusal.
 */
export async function sendNotificationAction(_prev: SendState, fd: FormData): Promise<SendState> {
  const { supabase } = await getSession();
  const audience = S(fd, 'audience');
  const silo = (S(fd, 'silo') || undefined) as Silo | undefined;

  let to: SendNotificationInput;
  switch (audience) {
    case 'person': {
      const userId = S(fd, 'user');
      if (!userId) return { error: 'Choose the person.' };
      to = { audience, userId };
      break;
    }
    case 'people': {
      const userIds = fd.getAll('users').map(String).filter(Boolean);
      if (userIds.length === 0) return { error: 'Choose the people.' };
      to = { audience, userIds };
      break;
    }
    case 'role': {
      const roles = fd.getAll('roles').map(String).filter(Boolean) as UserRole[];
      if (roles.length === 0) return { error: 'Choose the roles.' };
      to = { audience, roles, silo, allDepartments: fd.get('all_departments') === 'on' };
      break;
    }
    case 'department':
      to = { audience, silo };
      break;
    case 'organisation':
      to = { audience };
      break;
    default:
      return { error: 'Choose who it is for.' };
  }

  const severity = S(fd, 'severity');
  try {
    await sendNotification(supabase, to, {
      title: S(fd, 'title'),
      body: S(fd, 'body') || null,
      severity: severity === 'Medium' || severity === 'High' ? severity : 'Low',
      kind: audience === 'organisation' || audience === 'department' ? 'broadcast' : 'info',
    });
  } catch (e) {
    return { error: (e as { message?: string }).message ?? 'Could not send it.' };
  }
  revalidatePath('/notifications');
  return { ok: true };
}

/** Take a notification back: it disappears for everyone it went to. */
export async function withdrawNotificationAction(fd: FormData) {
  const { supabase } = await getSession();
  const id = S(fd, 'id');
  if (!id) return;
  await withdrawNotification(supabase, id).catch(() => {});
  revalidatePath('/notifications');
}
