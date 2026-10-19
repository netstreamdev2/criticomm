'use server';

import { captureLeave, decideLeave, setLeaveForm } from '@criticom/api';
import type { Silo } from '@criticom/db';
import { getSession } from '@/lib/session';
import { attempt, field, optional, resolveMember } from '@/lib/office-actions';

const PATHS = ['/modules/leave', '/leave', '/roster', '/roster/mine'] as const;

/** capture_leave checks Maintain Leave Edit, and refuses your own leave. */
export async function captureLeaveAction(fd: FormData) {
  const { supabase } = await getSession();
  return attempt(async () => {
    const userId = await resolveMember(supabase, field(fd, 'silo') as Silo, field(fd, 'member'));
    const row = await captureLeave(supabase, {
      userId,
      code: field(fd, 'code'),
      from: field(fd, 'from'),
      to: field(fd, 'to'),
      formSubmitted: field(fd, 'form') === 'Y',
      notes: optional(fd, 'notes'),
    });
    return `Leave ${row.leave_seq ?? ''} captured`.trim();
  }, ...PATHS);
}

/** decide_leave: someone senior to the member, in their department, never their own. */
export async function decideLeaveAction(fd: FormData) {
  const { supabase } = await getSession();
  return attempt(async () => {
    await decideLeave(supabase, { id: field(fd, 'id'), approve: field(fd, 'approve') === '1', comment: optional(fd, 'comment') });
  }, ...PATHS);
}

export async function setLeaveFormAction(fd: FormData) {
  const { supabase } = await getSession();
  return attempt(() => setLeaveForm(supabase, { id: field(fd, 'id'), submitted: field(fd, 'submitted') === 'Y' }), ...PATHS);
}
