'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import {
  addIncidentUpdate, closeCase, logAudit, setDepartmentStatus, standDownDepartment, updateResponderStatus,
} from '@criticom/api';
import { STATUS_OVERRIDE_ROLES, STATUS_OVERRIDE_STEPS, type IncidentStatus, type Silo } from '@criticom/db';
import { getSession } from '@/lib/session';
import { sendSms } from '@/lib/sms';

export async function addUpdateAction(formData: FormData) {
  const { supabase, fullName } = await getSession();
  const incidentId = String(formData.get('incident_id'));
  const message = String(formData.get('message') ?? '').trim();
  const silo = String(formData.get('silo')) as Silo;
  if (!message) return;
  await addIncidentUpdate(supabase, { incident_id: incidentId, silo, message });
  await logAudit(supabase, {
    silo, action_type: 'IncidentUpdate', entity_type: 'incident', entity_id: incidentId,
    user_name: fullName, details: message.slice(0, 200),
  });
  revalidatePath(`/incidents/${incidentId}`);
}

/** What a console form shows after it runs: the refusal in words, or nothing. */
export type FormState = { error?: string; done?: string } | null;

/** A database refusal as the person reads it: the reason, then what to do. */
function refusal(e: unknown): string {
  const err = e as { message?: string; hint?: string | null };
  return [err.message ?? String(e), err.hint].filter(Boolean).join(' ');
}

/**
 * The desk correcting a crew's status (the officer radioed it in). Only the
 * steps a crew takes: Resolved comes from the report and Closed from
 * close_case(), and the database refuses both here.
 */
export async function setStatusAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase, role, fullName } = await getSession();
  const incidentId = String(formData.get('incident_id'));
  const status = String(formData.get('status')) as IncidentStatus;
  const silo = String(formData.get('silo')) as Silo;
  // The department whose crew it is, on a call several departments share (0073).
  const department = String(formData.get('department') ?? '') as Silo | '';
  if (!STATUS_OVERRIDE_ROLES.includes(role) || !(STATUS_OVERRIDE_STEPS as readonly string[]).includes(status)) {
    return { error: 'The crew sets this from the HikTech app.' };
  }
  try {
    if (department) await setDepartmentStatus(supabase, { incident_id: incidentId, silo: department, status });
    else await updateResponderStatus(supabase, { incident_id: incidentId, status });
    await logAudit(supabase, {
      silo, action_type: 'StatusChange', entity_type: 'incident', entity_id: incidentId,
      user_name: fullName, details: `Status → ${status}${department ? ` for ${department}` : ''} (set from the console)`,
    });
  } catch (e) {
    return { error: refusal(e) };
  }
  revalidatePath(`/incidents/${incidentId}`);
  return { done: `Marked ${status}.` };
}

/**
 * A department is not needed on a shared call (0073). The database decides
 * who may, records the reason and tells the crew to stand down.
 */
export async function standDownAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await getSession();
  const incidentId = String(formData.get('incident_id'));
  const department = String(formData.get('department')) as Silo;
  const reason = String(formData.get('reason') ?? '').trim();
  try {
    await standDownDepartment(supabase, { incident_id: incidentId, silo: department, reason });
  } catch (e) {
    return { error: refusal(e) };
  }
  revalidatePath(`/incidents/${incidentId}`);
  revalidatePath(`/dispatch/assign/${incidentId}`);
  revalidatePath('/dispatch/pending');
  return { done: 'Marked not needed. The crew is told to stand down.' };
}

/**
 * NotificationsController.TriggerLocationSms — mint a share token and SMS the
 * caller a GPS-share deep link.
 */
export async function requestCitizenLocationAction(formData: FormData) {
  const { supabase, fullName } = await getSession();
  const incidentId = String(formData.get('incident_id'));
  const silo = String(formData.get('silo')) as Silo;
  const phone = String(formData.get('phone'));

  const token = randomBytes(16).toString('hex');
  const { error: tokenErr } = await supabase.from('citizen_share_tokens').insert({
    token, incident_id: incidentId, silo,
  });
  if (tokenErr) throw tokenErr;

  const h = await headers();
  const origin =
    process.env.NEXT_PUBLIC_APP_URL ??
    `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('host') ?? 'localhost:3000'}`;
  const link = `${origin}/share-location/${token}`;
  const result = await sendSms(
    phone,
    `HIKTECH ALERT: Emergency responders require your exact location. Tap here to share GPS: ${link}`,
  );

  const outcome = result.ok
    ? `GPS-share SMS sent to ${phone}`
    : `GPS-share link created (${link}) — SMS not sent: ${result.reason}${result.detail ? ` (${result.detail})` : ''}`;
  await addIncidentUpdate(supabase, { incident_id: incidentId, silo, message: outcome });
  await logAudit(supabase, {
    silo, action_type: 'LocationSmsTriggered', entity_type: 'incident', entity_id: incidentId,
    user_name: fullName, details: outcome,
  });
  revalidatePath(`/incidents/${incidentId}`);
}

/**
 * Close the case (0061): after review when it is Resolved, or as a
 * cancellation with a reason while it is live. close_case() decides, records
 * who, how and why on the case and in the audit trail, and tells everyone on
 * the call, so nothing more is written here.
 */
export async function closeCaseAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { supabase } = await getSession();
  const incidentId = String(formData.get('incident_id'));
  const reason = String(formData.get('reason') ?? '').trim() || undefined;
  try {
    await closeCase(supabase, { incident_id: incidentId, reason });
  } catch (e) {
    return { error: refusal(e) };
  }
  revalidatePath(`/incidents/${incidentId}`);
  revalidatePath('/case-manager', 'layout');
  return { done: 'Case closed.' };
}
