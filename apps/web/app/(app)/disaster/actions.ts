'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createDisasterLog, appendDisasterUpdate, createPostMortem, logAudit } from '@criticom/api';
import { getSession } from '@/lib/session';

const S = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? '').trim();
  return v === '' ? null : v;
};
const N = (fd: FormData, k: string) => Number(fd.get(k)) || 0;

export async function dispatchResourcesAction(formData: FormData) {
  const { supabase, fullName } = await getSession();
  const log = await createDisasterLog(supabase, {
    incident_number: S(formData, 'incident_number') ?? `DIS-${Date.now()}`,
    incident_type: S(formData, 'incident_type') ?? 'Other',
    location: S(formData, 'location') ?? '',
    description: S(formData, 'description') ?? '',
    resource_type: S(formData, 'resource_type') ?? 'General',
  });
  await logAudit(supabase, {
    silo: 'EthekwiniDisaster', action_type: 'ResourcesDispatched', entity_type: 'disaster_log',
    entity_id: log.id, user_name: fullName, details: `${log.resource_type} → ${log.location}`,
  });
  revalidatePath('/disaster');
  redirect('/disaster');
}

export async function periodicUpdateAction(formData: FormData) {
  const { supabase } = await getSession();
  const logId = String(formData.get('log_id'));
  const text = String(formData.get('text') ?? '').trim();
  if (!text) return;
  await appendDisasterUpdate(supabase, { log_id: logId, text });
  revalidatePath('/disaster');
}

export async function postMortemAction(formData: FormData) {
  const { supabase, fullName } = await getSession();
  const start = S(formData, 'start_time');
  const end = S(formData, 'end_time');
  const hours = start && end
    ? Math.round(((new Date(end).getTime() - new Date(start).getTime()) / 3_600_000) * 100) / 100
    : null;

  const pm = await createPostMortem(supabase, {
    incident_number: S(formData, 'incident_number') ?? `DIS-${Date.now()}`,
    incident_type: S(formData, 'incident_type'),
    location: S(formData, 'location'),
    start_time: start,
    end_time: end,
    total_duration_hours: hours,
    injuries: N(formData, 'injuries'),
    fatalities: N(formData, 'fatalities'),
    displaced_people: N(formData, 'displaced_people'),
    root_cause: S(formData, 'root_cause'),
    lessons_learned: S(formData, 'lessons_learned'),
    reporting_officer: S(formData, 'reporting_officer') ?? fullName,
  });
  await logAudit(supabase, {
    silo: 'EthekwiniDisaster', action_type: 'PostMortemFiled', entity_type: 'post_mortem_report',
    entity_id: pm.id, user_name: fullName,
  });
  revalidatePath('/disaster/post-mortem');
  redirect('/disaster/post-mortem');
}
