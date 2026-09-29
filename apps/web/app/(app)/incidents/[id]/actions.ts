'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import {
  addIncidentUpdate, closeCase, logAudit, updateResponderStatus,
} from '@criticom/api';
import type { IncidentStatus, Silo } from '@criticom/db';
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

export async function setStatusAction(formData: FormData) {
  const { supabase, fullName } = await getSession();
  const incidentId = String(formData.get('incident_id'));
  const status = String(formData.get('status')) as IncidentStatus;
  const silo = String(formData.get('silo')) as Silo;
  await updateResponderStatus(supabase, { incident_id: incidentId, status });
  await logAudit(supabase, {
    silo, action_type: 'StatusChange', entity_type: 'incident', entity_id: incidentId,
    user_name: fullName, details: `Status → ${status}`,
  });
  revalidatePath(`/incidents/${incidentId}`);
  revalidatePath('/responder');
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

export async function closeCaseAction(formData: FormData) {
  const { supabase, fullName } = await getSession();
  const incidentId = String(formData.get('incident_id'));
  const silo = String(formData.get('silo')) as Silo;
  const reason = String(formData.get('reason') ?? '').trim() || undefined;
  await closeCase(supabase, { incident_id: incidentId, reason });
  await logAudit(supabase, {
    silo, action_type: 'CaseClosed', entity_type: 'incident', entity_id: incidentId,
    user_name: fullName, details: reason ?? 'Closed without reason',
  });
  revalidatePath(`/incidents/${incidentId}`);
  revalidatePath('/case-manager');
}
