import type { CriticomClient, Database, Silo, IncidentStatus } from '@criticom/db';
import type {
  LogIncomingCallInput,
  DispatchUnitInput,
  UpdateResponderStatusInput,
} from '@criticom/db/schemas';

type Incident = Database['public']['Tables']['incidents']['Row'];

/** ControlRoomController.LogNew + IncidentWorkflowService.LogIncomingCallAsync */
export async function logIncomingCall(
  client: CriticomClient,
  input: LogIncomingCallInput,
): Promise<Incident> {
  const { data, error } = await client.rpc('log_incoming_call', {
    p_silo: input.silo,
    p_caller_name: input.caller_name,
    p_caller_number: input.caller_number,
    p_call_description: input.call_description,
    p_incident_type: input.incident_type,
    p_incident_severity: input.incident_severity,
    p_location_address: input.location_address,
    p_location_lat: input.location_lat,
    p_location_lng: input.location_lng,
    p_suburb: input.suburb ?? null,
    p_city: input.city ?? null,
    p_postal_code: input.postal_code ?? null,
    p_fire_incident_type: input.fire_incident_type ?? null,
    p_medical_type: input.medical_type ?? null,
    p_disaster_type: input.disaster_type ?? null,
    p_is_caller_patient: input.is_caller_patient ?? null,
    p_patient_name: input.patient_name ?? null,
    p_number_of_victims: input.number_of_victims ?? null,
    p_notes: input.notes ?? null,
  });
  if (error) throw error;
  return data as Incident;
}

/** ControlRoomController.CheckDuplicate */
export async function checkDuplicateIncident(
  client: CriticomClient,
  args: { phone?: string | null; location?: string | null; type?: string | null },
) {
  const { data, error } = await client.rpc('check_duplicate_incident', {
    p_phone: args.phone ?? null,
    p_location: args.location ?? null,
    p_type: args.type ?? null,
  });
  if (error) throw error;
  return data?.[0] ?? null;
}

/** IncidentWorkflowService.DispatchUnitAsync */
export async function dispatchUnit(client: CriticomClient, input: DispatchUnitInput) {
  const { data, error } = await client.rpc('dispatch_unit', {
    p_incident_id: input.incident_id,
    p_unit_id: input.unit_id,
    p_unit_type: input.unit_type,
    p_target_silos: input.target_silos,
  });
  if (error) throw error;
  return data as Incident;
}

/** ResponderController.UpdateStatus / IncidentWorkflowService.UpdateResponderStatusAsync */
export async function updateResponderStatus(
  client: CriticomClient,
  input: UpdateResponderStatusInput,
) {
  const { data, error } = await client.rpc('update_responder_status', {
    p_incident_id: input.incident_id,
    p_status: input.status,
  });
  if (error) throw error;
  return data as Incident;
}

/** CaseManagerController.CloseCase */
export async function closeCase(
  client: CriticomClient,
  args: { incident_id: string; reason?: string },
) {
  const { data, error } = await client.rpc('close_case', {
    p_incident_id: args.incident_id,
    p_reason: args.reason ?? null,
  });
  if (error) throw error;
  return data as Incident;
}

/** DispatchController.KPI / IncidentWorkflowService.GetDispatcherKPIsAsync */
export async function getDispatcherKpis(client: CriticomClient, silo?: Silo) {
  const { data, error } = await client.rpc('get_dispatcher_kpis', { p_silo: silo ?? null });
  if (error) throw error;
  return data;
}

/** IncidentsController.IncomingIncidents — for dispatchers */
export async function listPendingIncidents(client: CriticomClient, silo?: Silo) {
  let q = client
    .from('incidents')
    .select('*')
    .in('status', ['Pending Dispatch', 'Pending', 'New', 'Pending Analysis'])
    .order('incident_severity', { ascending: false })
    .order('call_timestamp', { ascending: true });
  if (silo) q = q.eq('silo', silo);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/** IncidentsController.Dashboard — active (in-flight) incidents */
export async function listActiveIncidents(client: CriticomClient, silo?: Silo) {
  let q = client
    .from('incidents')
    .select('*')
    .not('status', 'in', '("Closed","Resolved")')
    .order('incident_created_at', { ascending: false });
  if (silo) q = q.eq('silo', silo);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/** ResponderController.Index — incidents assigned to my unit */
export async function listMyAssignedIncidents(client: CriticomClient, unitId: string | null) {
  if (!unitId) return [];
  const { data, error } = await client
    .from('incidents')
    .select('*')
    .eq('unit_id', unitId)
    .not('status', 'in', '("Closed","Resolved")')
    .order('dispatch_time', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** IncidentsController.Details + ReportsController.IncidentLifecycle */
export async function getIncident(client: CriticomClient, id: string) {
  const { data, error } = await client.from('incidents').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

/** ReportsController.GetIncidentUpdates */
export async function getIncidentUpdates(client: CriticomClient, incidentId: string) {
  const { data, error } = await client
    .from('incident_updates')
    .select('*')
    .eq('incident_id', incidentId)
    .order('timestamp', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** ReportsController.AddUpdate */
export async function addIncidentUpdate(
  client: CriticomClient,
  args: { incident_id: string; silo: Silo; message: string },
) {
  const { data, error } = await client
    .from('incident_updates')
    .insert({ ...args })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** ResponderController.UploadIncidentSite POST — uploads to Storage + writes incident_attachments */
export async function uploadIncidentEvidence(
  client: CriticomClient,
  args: {
    incident_id: string;
    silo: Silo;
    file: Blob | File;
    filename: string;
    kind: 'image' | 'audio' | 'video' | 'document';
    caption?: string;
  },
) {
  const path = `${args.silo}/${args.incident_id}/${args.kind}/${Date.now()}-${args.filename}`;
  const { error: upErr } = await client.storage
    .from('incident-media')
    .upload(path, args.file, { contentType: (args.file as File).type, upsert: false });
  if (upErr) throw upErr;

  const { data, error } = await client
    .from('incident_attachments')
    .insert({
      incident_id: args.incident_id,
      silo: args.silo,
      storage_path: path,
      kind: args.kind,
      content_type: (args.file as File).type ?? null,
      size_bytes: (args.file as File).size ?? null,
      caption: args.caption ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** CaseManagerController.Index — closed/resolved cases for review */
export async function listClosedIncidents(client: CriticomClient, silo?: Silo) {
  let q = client
    .from('incidents')
    .select('*')
    .in('status', ['Closed', 'Resolved'])
    .order('closed_at', { ascending: false });
  if (silo) q = q.eq('silo', silo);
  const { data, error } = await q.limit(500);
  if (error) throw error;
  return data ?? [];
}

/** ReportsController.Index — full incident archive with basic filters */
export async function listAllIncidents(
  client: CriticomClient,
  opts: { silo?: Silo; status?: IncidentStatus; search?: string; limit?: number } = {},
) {
  let q = client.from('incidents').select('*').order('incident_created_at', { ascending: false });
  if (opts.silo) q = q.eq('silo', opts.silo);
  if (opts.status) q = q.eq('status', opts.status);
  if (opts.search) {
    q = q.or(
      `incident_number.ilike.%${opts.search}%,caller_name.ilike.%${opts.search}%,location_address.ilike.%${opts.search}%`,
    );
  }
  const { data, error } = await q.limit(opts.limit ?? 300);
  if (error) throw error;
  return data ?? [];
}

/** Attachments for an incident (evidence gallery in case manager / responder). */
export async function listIncidentAttachments(client: CriticomClient, incidentId: string) {
  const { data, error } = await client
    .from('incident_attachments')
    .select('*')
    .eq('incident_id', incidentId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Lookup status type union (re-export for client-side use). */
export type { IncidentStatus };
