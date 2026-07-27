'use server';

import { revalidatePath } from 'next/cache';
import { updateResponderStatus, uploadIncidentEvidence, logAudit } from '@criticom/api';
import type { IncidentStatus, Silo } from '@criticom/db';
import { getSession } from '@/lib/session';

export async function responderStatusAction(formData: FormData) {
  const { supabase, fullName } = await getSession();
  const incidentId = String(formData.get('incident_id'));
  const status = String(formData.get('status')) as IncidentStatus;
  const silo = String(formData.get('silo')) as Silo;
  await updateResponderStatus(supabase, { incident_id: incidentId, status });
  await logAudit(supabase, {
    silo, action_type: 'StatusChange', entity_type: 'incident', entity_id: incidentId,
    user_name: fullName, details: `Responder set status → ${status}`,
  });
  revalidatePath('/responder');
}

export async function uploadEvidenceAction(formData: FormData) {
  const { supabase, fullName } = await getSession();
  const incidentId = String(formData.get('incident_id'));
  const silo = String(formData.get('silo')) as Silo;
  const caption = String(formData.get('caption') ?? '').trim() || undefined;
  const file = formData.get('file') as File | null;
  if (!file || file.size === 0) return;

  const kind = file.type.startsWith('image/') ? 'image'
    : file.type.startsWith('audio/') ? 'audio'
    : file.type.startsWith('video/') ? 'video'
    : 'document';

  await uploadIncidentEvidence(supabase, {
    incident_id: incidentId, silo, file, filename: file.name, kind, caption,
  });
  await logAudit(supabase, {
    silo, action_type: 'EvidenceUpload', entity_type: 'incident', entity_id: incidentId,
    user_name: fullName, details: `${kind}: ${file.name}`,
  });
  revalidatePath('/responder');
  revalidatePath(`/incidents/${incidentId}`);
}
