'use server';

import { issueEndorsement, withdrawEndorsement } from '@criticom/api';
import type { Silo } from '@criticom/db';
import { getSession } from '@/lib/session';
import { attempt, field, optional, resolveMember } from '@/lib/office-actions';

/** issue_endorsement checks Endorsements Edit for the member's department. */
export async function issueEndorsementAction(fd: FormData) {
  const { supabase } = await getSession();
  return attempt(async () => {
    const userId = await resolveMember(supabase, field(fd, 'silo') as Silo, field(fd, 'member'));
    await issueEndorsement(supabase, {
      userId,
      type: field(fd, 'type'),
      code: optional(fd, 'code'),
      details: field(fd, 'details'),
      start: field(fd, 'start'),
      end: optional(fd, 'end'),
    });
  }, '/modules/endorsements');
}

export async function withdrawEndorsementAction(fd: FormData) {
  const { supabase } = await getSession();
  return attempt(() => withdrawEndorsement(supabase, field(fd, 'id')), '/modules/endorsements');
}
