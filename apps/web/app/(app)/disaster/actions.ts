'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  appendDisasterUpdate, createDisasterLog, filePostMortem, getDisasterLogForIncident, getIncident, logAudit,
  updateDisasterLog,
} from '@criticom/api';
import { postMortemPayload, validatePostMortem } from '@criticom/db/post-mortem';
import { getSession } from '@/lib/session';

const S = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? '').trim();
  return v === '' ? null : v;
};
const message = (e: unknown, fallback: string) => (e as { message?: string })?.message ?? fallback;

/**
 * DisasterController.DispatchResources: resources sent to an open incident.
 * One deployment log per incident, as V4 — dispatching again updates it.
 */
export async function dispatchResourcesAction(formData: FormData) {
  const { supabase, fullName } = await getSession();
  const incidentId = S(formData, 'incident_id');
  const resource = S(formData, 'resource_type');
  const description = S(formData, 'description');
  if (!incidentId || !resource || !description) redirect('/disaster/dispatch?error=missing');
  const incident = await getIncident(supabase, incidentId).catch(() => null);
  if (!incident) redirect('/disaster/dispatch?error=incident');
  const fields = {
    incident_type: S(formData, 'incident_type') ?? incident.disaster_type ?? incident.incident_type,
    location: S(formData, 'location') ?? incident.location_address,
    description,
    resource_type: resource,
    dispatch_timestamp: new Date().toISOString(),
  };
  const existing = await getDisasterLogForIncident(supabase, incident.id);
  const log = existing
    ? await updateDisasterLog(supabase, existing.id, fields)
    : await createDisasterLog(supabase, { ...fields, incident_id: incident.id, incident_number: incident.incident_number });
  await logAudit(supabase, {
    silo: 'EthekwiniDisaster', action_type: 'ResourcesDispatched', entity_type: 'disaster_log',
    entity_id: log.id, user_name: fullName, details: `${incident.incident_number}: ${log.resource_type} → ${log.location}`,
  });
  revalidatePath('/disaster');
  redirect('/disaster');
}

/** DisasterController.LogPeriodicUpdate. */
export async function periodicUpdateAction(formData: FormData) {
  const { supabase } = await getSession();
  const logId = String(formData.get('log_id'));
  const text = String(formData.get('text') ?? '').trim();
  if (!text) return;
  await appendDisasterUpdate(supabase, { log_id: logId, text: text.slice(0, 2000) });
  revalidatePath('/disaster');
}

/**
 * The Official After-Action Report from the console (0065): command closes
 * out a deployed incident. The server checks who may file and what it says.
 */
export async function filePostMortemAction(incidentId: string, answers: Record<string, string>): Promise<{ error: string } | undefined> {
  const problems = validatePostMortem(answers);
  if (problems.length) return { error: problems.join(' ') };
  const { supabase } = await getSession();
  try {
    await filePostMortem(supabase, { incidentId, fields: postMortemPayload(answers) });
  } catch (e) {
    return { error: message(e, 'The post-mortem was not filed.') };
  }
  revalidatePath('/disaster');
  revalidatePath('/disaster/post-mortem');
  redirect(`/incidents/${incidentId}`);
}
