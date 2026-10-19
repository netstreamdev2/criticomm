'use server';

import { allocateDuty, changeDuty } from '@criticom/api';
import { getSession } from '@/lib/session';
import { attempt, field, optional } from '@/lib/office-actions';

const PATHS = ['/modules/duty-maintenance', '/modules/duty-operations', '/roster', '/roster/mine'] as const;

/** South African wall time on a day, as an instant. */
const sa = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+02:00`).toISOString();

/** The wizard: one call sign, one member, a date range and the hours. allocate_duty checks Duty Allocation Edit. */
export async function assignDutyAction(fd: FormData) {
  const { supabase } = await getSession();
  return attempt(async () => {
    const res = await allocateDuty(supabase, {
      sectionId: field(fd, 'section'),
      from: field(fd, 'from'),
      to: field(fd, 'to'),
      lines: [{ post_id: field(fd, 'post'), user_id: field(fd, 'user') }],
      start: optional(fd, 'start'),
      end: optional(fd, 'end'),
    });
    if (res.created === 0 && res.skipped.length > 0) throw new Error(res.skipped[0]?.reason ?? 'Nothing was booked');
    return res.skipped.length > 0
      ? `${res.created} booked; ${res.skipped.length} left out (${res.skipped[0]?.reason})`
      : `${res.created} booked`;
  }, ...PATHS);
}

/** Change one duty's call sign, member or hours. change_duty checks Duty Maintenance Edit. */
export async function changeDutyAction(fd: FormData) {
  const { supabase } = await getSession();
  return attempt(async () => {
    const day = field(fd, 'day');
    const start = optional(fd, 'start');
    const end = optional(fd, 'end');
    let startAt = start && day ? sa(day, start) : null;
    let endAt = end && day ? sa(day, end) : null;
    if (startAt && endAt && endAt <= startAt) endAt = new Date(Date.parse(endAt) + 86_400_000).toISOString();
    if (field(fd, 'times') !== 'changed') { startAt = null; endAt = null; }
    await changeDuty(supabase, {
      lineId: field(fd, 'id'),
      postId: optional(fd, 'post'),
      userId: optional(fd, 'user'),
      start: startAt,
      end: endAt,
    });
  }, ...PATHS);
}
