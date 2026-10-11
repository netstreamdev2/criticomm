import type { CriticomClient, Database, Silo, IncidentStatus } from '@criticom/db';
import { cleanSearch } from '../cases/stage';
import { noteText } from './note';

export { noteText } from './note';
import type {
  LogIncomingCallInput,
  DispatchUnitInput,
  UpdateResponderStatusInput,
} from '@criticom/db/schemas';
import { logIncomingCallSchema } from '@criticom/db/schemas';

type Incident = Database['public']['Tables']['incidents']['Row'];

/** ControlRoomController.LogNew + IncidentWorkflowService.LogIncomingCallAsync */
export async function logIncomingCall(
  client: CriticomClient,
  raw: LogIncomingCallInput,
): Promise<Incident> {
  // Checked here as well as in the database, so a bad call is refused with a
  // plain reason before it leaves the console.
  const parsed = logIncomingCallSchema.safeParse(raw);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'The call details are incomplete');
  const input = parsed.data;
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
    p_incident_category: input.incident_category ?? null,
    p_region: input.region ?? null,
    p_tagged_silos: [...new Set(input.tagged_silos)],
  });
  if (error) throw error;
  return data as Incident;
}

/**
 * Send a call to other departments' dispatch desks (0068): they are tagged,
 * their dispatchers are told, and the timeline records who did it. Tags are
 * only ever added.
 */
export async function tagIncidentDepartments(
  client: CriticomClient,
  args: { incident_id: string; silos: Silo[]; note?: string | null },
) {
  const { data, error } = await client.rpc('tag_incident_departments', {
    p_incident: args.incident_id,
    p_silos: args.silos,
    p_note: args.note ?? null,
  });
  if (error) throw error;
  return data as Incident;
}

/** The dispatch desks a call was sent to; a call from before 0068 counts its own department. */
export function deskTags(incident: Pick<Incident, 'silo' | 'tagged_silos' | 'dispatched_silos'>): Silo[] {
  const tags = new Set<Silo>([...(incident.tagged_silos ?? []), ...(incident.dispatched_silos ?? [])]);
  if (tags.size === 0 && incident.silo !== 'Ethekwini') tags.add(incident.silo);
  tags.delete('Ethekwini');
  return [...tags];
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

/**
 * Dispatch a call to one or more departments (migration 0040). It goes out to
 * every officer on duty there; the first to accept takes it. Refused with
 * "No one is on duty to receive the dispatch" when nobody is.
 */
export async function routeIncident(
  client: CriticomClient,
  args: { incident_id: string; silos: Silo[]; notes?: string | null },
) {
  const { data, error } = await client.rpc('route_incident', {
    p_incident_id: args.incident_id,
    p_silos: args.silos,
    p_notes: args.notes ?? null,
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
    p_occurred_at: input.occurred_at ?? null,
  });
  if (error) throw error;
  return data as Incident;
}

/**
 * Officer-down. Creates a Critical incident at the caller's position and
 * interrupts every screen in their department and the control room.
 *
 * `clientRef` is required in practice even though the signature allows it to be
 * omitted: it is what stops a replayed panic — the outbox retrying after the
 * network came back — from raising a second emergency for the same event. Pass
 * a UUID generated once, at the moment the button was held, and reuse it for
 * every retry.
 *
 * Any authenticated account may call this. That is deliberate; see the note on
 * `raise_panic` in migration 0024.
 */
export async function raisePanic(
  client: CriticomClient,
  args: {
    lat?: number | null;
    lng?: number | null;
    accuracy?: number | null;
    note?: string | null;
    clientRef?: string | null;
    occurredAt?: string | null;
  } = {},
): Promise<Incident> {
  const { data, error } = await client.rpc('raise_panic', {
    p_lat: args.lat ?? null,
    p_lng: args.lng ?? null,
    p_accuracy: args.accuracy ?? null,
    p_note: args.note ?? null,
    p_client_ref: args.clientRef ?? null,
    p_occurred_at: args.occurredAt ?? null,
  });
  if (error) throw error;
  return data as Incident;
}

/**
 * Open SOS incidents this person was alerted to and has not cleared — the
 * standing reminder above every page. It follows the SOS alerts themselves, so
 * it reaches exactly whom raise_panic() paged (0047): the officer's department
 * desk, the central control room and department command. Clearing the alert
 * (× on the pop-up or on the banner) or closing the incident ends it.
 */
export async function listMyOpenSos(client: CriticomClient, userId: string) {
  const { data: alerts, error } = await client
    .from('alerts')
    .select('id, incident_id')
    .eq('kind', 'sos')
    .eq('target_user_id', userId)
    .not('incident_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  if (!alerts || alerts.length === 0) return [];

  const { data: reads, error: readErr } = await client
    .from('alert_reads')
    .select('alert_id')
    .eq('user_id', userId)
    .eq('acknowledged', true)
    .in('alert_id', alerts.map((a) => a.id));
  if (readErr) throw readErr;
  const cleared = new Set((reads ?? []).map((r) => r.alert_id));

  const alertFor = new Map<string, string>();
  for (const a of alerts) {
    if (a.incident_id && !cleared.has(a.id) && !alertFor.has(a.incident_id)) alertFor.set(a.incident_id, a.id);
  }
  if (alertFor.size === 0) return [];

  const { data: incidents, error: incErr } = await client
    .from('incidents')
    .select('*')
    .in('id', [...alertFor.keys()])
    .not('status', 'in', '("Closed","Resolved")')
    .order('incident_created_at', { ascending: false });
  if (incErr) throw incErr;
  return (incidents ?? []).map((incident) => ({ incident, alertId: alertFor.get(incident.id)! }));
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
    .order('call_timestamp', { ascending: true });
  // A department's queue is the calls sent to its desk (0068): logged under
  // it, tagged for it, or with its crews already on them.
  if (silo) q = q.or(`silo.eq.${silo},tagged_silos.cs.{${silo}},dispatched_silos.cs.{${silo}}`);
  const { data, error } = await q;
  if (error) throw error;
  // An officer's SOS first, then by real severity (the column sorts as text,
  // which put Medium above Critical), then the longest-waiting first.
  const rank = (i: Incident) => (i.source === 'Responder-Panic' ? -1 : (PENDING_RANK[i.incident_severity] ?? 9));
  return (data ?? []).sort((a, b) => rank(a) - rank(b));
}

const PENDING_RANK: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };

export type QueueSort = 'newest' | 'oldest' | 'severity';
export type QueueFilters = {
  q?: string | null;
  severity?: string | null;
  region?: string | null;
  /** The department a call was logged under; 'Ethekwini' is the control room. */
  department?: string | null;
  sort?: QueueSort | null;
};

/**
 * The dispatch queue with its filters. Newest call on top by default, as a
 * chat list reads, strictly by when the call came in; oldest-first and
 * most-severe-first (newest first within a severity) on request. An officer's
 * SOS is marked on the row rather than moved, so the order is always the one
 * chosen.
 */
export async function listQueue(client: CriticomClient, f: QueueFilters = {}) {
  const sort: QueueSort = f.sort === 'oldest' || f.sort === 'severity' ? f.sort : 'newest';
  let q = client
    .from('incidents')
    .select('*')
    .in('status', ['Pending Dispatch', 'Pending', 'New', 'Pending Analysis'])
    .order('call_timestamp', { ascending: sort === 'oldest' })
    .order('incident_created_at', { ascending: sort === 'oldest' });
  const term = cleanSearch(f.q);
  if (term) {
    q = q.or([
      `incident_number.ilike.%${term}%`, `caller_name.ilike.%${term}%`, `caller_number.ilike.%${term}%`,
      `location_address.ilike.%${term}%`, `incident_type.ilike.%${term}%`, `suburb.ilike.%${term}%`,
    ].join(','));
  }
  if (f.severity && f.severity in PENDING_RANK) q = q.eq('incident_severity', f.severity as Incident['incident_severity']);
  if (f.region) q = q.eq('region', f.region);
  // Sent to that desk: tagged for it, logged under it, or sent to its crews (0068).
  if (f.department) {
    const d = f.department as Silo;
    q = d === 'Ethekwini' ? q.eq('silo', d) : q.or(`silo.eq.${d},tagged_silos.cs.{${d}},dispatched_silos.cs.{${d}}`);
  }
  const { data, error } = await q.limit(500);
  if (error) throw error;
  const rows = data ?? [];
  if (sort !== 'severity') return rows;
  // A stable sort: newest first within each severity, as the query ordered them.
  return [...rows].sort((a, b) => (PENDING_RANK[a.incident_severity] ?? 9) - (PENDING_RANK[b.incident_severity] ?? 9));
}

/**
 * Police Home tiles (V4 dashboard): live incidents, their severity split, and
 * how many closed today. Counts only — no rows travel — and RLS scopes them
 * to what the caller's service can see.
 */
export async function getIncidentOverview(client: CriticomClient) {
  const saDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const todayStart = new Date(`${saDate}T00:00:00+02:00`).toISOString();

  const live = () => client.from('incidents').select('id', { count: 'exact', head: true })
    .not('status', 'in', '("Closed","Resolved")');
  const [all, high, medium, low, closed] = await Promise.all([
    live(),
    live().in('incident_severity', ['High', 'Critical']),
    live().eq('incident_severity', 'Medium'),
    live().eq('incident_severity', 'Low'),
    client.from('incidents').select('id', { count: 'exact', head: true })
      .in('status', ['Closed', 'Resolved'])
      .gte('closed_at', todayStart),
  ]);
  for (const res of [all, high, medium, low, closed]) {
    if (res.error) throw res.error;
  }
  return {
    live: all.count ?? 0,
    high: high.count ?? 0,
    medium: medium.count ?? 0,
    low: low.count ?? 0,
    closedToday: closed.count ?? 0,
  };
}

/** IncidentsController.Dashboard — active (in-flight) incidents */
export async function listActiveIncidents(client: CriticomClient, silo?: Silo) {
  let q = client
    .from('incidents')
    .select('*')
    .not('status', 'in', '("Closed","Resolved")')
    .order('incident_created_at', { ascending: false });
  // A department's live calls are the ones it owns AND the ones routed to it
  // (Operations Manual 3.4) — a control-room call sent to Police is Police work.
  if (silo) q = q.or(`silo.eq.${silo},dispatched_silos.cs.{${silo}}`);
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
  // Without the phone's outbox marker: see ./note.ts.
  return (data ?? []).map((u) => ({ ...u, message: noteText(u.message) }));
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

/**
 * ResponderController.UploadIncidentSite POST — uploads to Storage + writes
 * incident_attachments.
 *
 * Accepts an ArrayBuffer as well as a Blob/File because React Native has no
 * usable `File`, and the responder app reads captured media off disk as bytes.
 * When it does, it must also pass `contentType` — there is nothing to infer it
 * from — and the caller-supplied `size` keeps the attachment row honest.
 *
 * `idempotencyKey` makes replay safe. The offline outbox can be interrupted
 * after Storage accepted the file but before the row was written, and retrying
 * then would either fail on a duplicate path or leave a second copy of the same
 * photo in the case file. With a key, the path is derived from it rather than
 * from the clock, the upload upserts, and an existing attachment row for that
 * path is returned instead of inserting another. Without one, behaviour is
 * unchanged: a fresh timestamped path every call.
 */
export async function uploadIncidentEvidence(
  client: CriticomClient,
  args: {
    incident_id: string;
    silo: Silo;
    file: Blob | File | ArrayBuffer;
    filename: string;
    kind: 'image' | 'audio' | 'video' | 'document';
    caption?: string;
    /** Required when `file` is an ArrayBuffer. */
    contentType?: string;
    /** Byte length, when it cannot be read off the file object. */
    size?: number;
    /** Stable per logical upload — see above. */
    idempotencyKey?: string;
  },
) {
  const blobLike = args.file as Partial<File>;
  const contentType = args.contentType ?? blobLike.type ?? undefined;
  const size = args.size ?? blobLike.size ?? null;

  const discriminator = args.idempotencyKey ?? String(Date.now());
  const path = `${args.silo}/${args.incident_id}/${args.kind}/${discriminator}-${args.filename}`;

  const { error: upErr } = await client.storage
    .from('incident-media')
    .upload(path, args.file, { contentType, upsert: Boolean(args.idempotencyKey) });
  if (upErr) throw upErr;

  if (args.idempotencyKey) {
    const { data: existing } = await client
      .from('incident_attachments')
      .select('*')
      .eq('storage_path', path)
      .maybeSingle();
    if (existing) return existing;
  }

  const { data, error } = await client
    .from('incident_attachments')
    .insert({
      incident_id: args.incident_id,
      silo: args.silo,
      storage_path: path,
      kind: args.kind,
      content_type: contentType ?? null,
      size_bytes: size,
      caption: args.caption ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** ReportsController.Index — full incident archive with basic filters */
export async function listAllIncidents(
  client: CriticomClient,
  opts: { silo?: Silo; status?: IncidentStatus; statuses?: IncidentStatus[]; search?: string; limit?: number } = {},
) {
  let q = client.from('incidents').select('*').order('incident_created_at', { ascending: false });
  // A department's incidents are the ones it owns and the ones it was sent:
  // a call the control room logs stays filed under the control room after it
  // is dispatched, so filtering on the owner alone hid it from the very
  // department working it.
  const dept = opts.silo ? `silo.eq.${opts.silo},dispatched_silos.cs.{${opts.silo}}` : null;
  // Search text is cleaned: a comma or bracket in it would rewrite the filter.
  const term = cleanSearch(opts.search);
  const search = term
    ? `incident_number.ilike.%${term}%,caller_name.ilike.%${term}%,location_address.ilike.%${term}%`
    : null;
  if (dept && search) q = q.or(`and(or(${dept}),or(${search}))`);
  else if (dept) q = q.or(dept);
  else if (search) q = q.or(search);
  if (opts.status) q = q.eq('status', opts.status);
  if (opts.statuses?.length) q = q.in('status', opts.statuses);
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

/* ── Police response: dispatch → accept → report (migration 0039) ────────── */

type MetroReport = Database['public']['Tables']['metro_reports']['Row'];

/**
 * The latest call this officer leads and has not closed out. A lead cannot
 * sign out or go off duty while one is open (0039); backup can.
 */
export async function getMyOpenIncident(client: CriticomClient, userId: string) {
  const { data, error } = await client
    .from('incidents')
    .select('*')
    .eq('accepted_by', userId)
    .not('status', 'in', '("Closed","Resolved")')
    .order('accepted_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as Incident | null;
}

/** File the case report; the server resolves the call and tells command. */
export async function fileIncidentReport(
  client: CriticomClient,
  args: {
    incidentId: string;
    reportType: string;
    fields: Record<string, unknown>;
    details?: Record<string, unknown>;
  },
) {
  const { data, error } = await client.rpc('file_incident_report', {
    p_incident_id: args.incidentId,
    p_report_type: args.reportType,
    p_fields: args.fields,
    p_details: args.details ?? {},
  });
  if (error) throw error;
  return data as MetroReport;
}

/** The filed case report for an incident, if any. */
export async function getIncidentReport(client: CriticomClient, incidentId: string) {
  const { data, error } = await client
    .from('metro_reports')
    .select('*')
    .eq('incident_id', incidentId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as MetroReport | null;
}

/* ── Dispatch: send to all, or assign; lead + backup (migrations 0040, 0042) ── */

export type IncidentResponder = Pick<
  Database['public']['Tables']['incident_responders']['Row'],
  'user_id' | 'name' | 'silo' | 'role' | 'status' | 'joined_at'
>;

/** An incident with who is responding to it. */
export type FieldIncident = Incident & { responders: IncidentResponder[] };

const RESPONDERS = 'responders:incident_responders(user_id, name, silo, role, status, joined_at)';

/** Statuses before a call has been sent out; officers never see these. */
const NOT_YET_SENT = '("New","Pending","Pending Dispatch","Pending Analysis","Closed","Resolved")';

/** Assign a call to one on-duty officer; they lead it. Re-assigning is allowed until someone leads. */
export async function assignIncident(
  client: CriticomClient,
  args: { incident_id: string; user_id: string; notes?: string | null },
) {
  const { data, error } = await client.rpc('assign_incident', {
    p_incident_id: args.incident_id,
    p_user_id: args.user_id,
    p_notes: args.notes ?? null,
  });
  if (error) throw error;
  return data as Incident;
}

/**
 * Every live call an officer can see from the field: those sent to their
 * department, assigned to them, or that they respond to — whoever holds them.
 */
export async function listFieldIncidents(client: CriticomClient, silo: Silo, userId: string) {
  const { data, error } = await client
    .from('incidents')
    .select(`*, ${RESPONDERS}`)
    .not('status', 'in', NOT_YET_SENT)
    .or(`dispatched_silos.cs.{${silo}},assigned_to.eq.${userId},accepted_by.eq.${userId}`)
    .order('dispatch_time', { ascending: false, nullsFirst: false })
    .limit(300);
  if (error) throw error;
  return (data ?? []) as unknown as FieldIncident[];
}

/** One call with its responders. */
export async function getFieldIncident(client: CriticomClient, id: string) {
  const { data, error } = await client
    .from('incidents')
    .select(`*, ${RESPONDERS}`)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as unknown as FieldIncident | null;
}

/** The open calls this officer is responding to, lead or backup. */
export async function listMyActiveIncidents(client: CriticomClient, userId: string) {
  const { data, error } = await client
    .from('incidents')
    .select(`*, ${RESPONDERS}, mine:incident_responders!inner(user_id)`)
    .eq('mine.user_id', userId)
    .not('status', 'in', '("Closed","Resolved")')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as FieldIncident[];
}

/**
 * Open incidents dispatch has assigned to this officer, newest first. Callers
 * drop the ones the officer is already responding to.
 */
export async function listAssignedToMe(client: CriticomClient, userId: string) {
  const { data, error } = await client
    .from('incidents')
    .select('id, incident_number, incident_type, incident_severity, location_address, status')
    .eq('assigned_to', userId)
    .not('status', 'in', '("Closed","Resolved")')
    .order('assigned_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/**
 * The open calls this officer is on: leading, backing up, or assigned to and
 * not yet answered (0042). Since calls go to officers rather than vehicles,
 * this replaces looking calls up by the officer's unit, which missed every
 * call sent to all on duty or assigned before the officer accepted it.
 */
export async function listMyCalls(client: CriticomClient, userId: string): Promise<FieldIncident[]> {
  const [responding, assigned] = await Promise.all([
    listMyActiveIncidents(client, userId),
    client
      .from('incidents')
      .select(`*, ${RESPONDERS}`)
      .eq('assigned_to', userId)
      .not('status', 'in', '("Closed","Resolved")'),
  ]);
  if (assigned.error) throw assigned.error;
  const byId = new Map<string, FieldIncident>();
  for (const call of [...responding, ...((assigned.data ?? []) as unknown as FieldIncident[])]) byId.set(call.id, call);
  return [...byId.values()].sort((a, b) => (b.dispatch_time ?? '').localeCompare(a.dispatch_time ?? ''));
}

/**
 * How many incidents dispatch assigned to this officer since midnight (SA
 * time) — answered, closed or still waiting.
 */
export async function countAssignedToMeToday(client: CriticomClient, userId: string) {
  const saDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const { count, error } = await client
    .from('incidents')
    .select('id', { count: 'exact', head: true })
    .eq('assigned_to', userId)
    .gte('assigned_at', new Date(`${saDate}T00:00:00+02:00`).toISOString());
  if (error) throw error;
  return count ?? 0;
}

/** Who is responding to a call, lead first. */
export async function listIncidentResponders(client: CriticomClient, incidentId: string) {
  const { data, error } = await client
    .from('incident_responders')
    .select('user_id, name, silo, role, status, joined_at')
    .eq('incident_id', incidentId)
    .order('role', { ascending: false })
    .order('joined_at');
  if (error) throw error;
  return (data ?? []) as IncidentResponder[];
}

export type OnDutyOfficer = {
  userId: string;
  name: string;
  badge: string;
  silo: Silo;
  station: string | null;
  unitNumber: string | null;
  lat: number | null;
  lng: number | null;
  /** When the officer's record (and GPS heartbeat) last changed. */
  seenAt: string;
  /** When they went on duty in the app (migration 0041). */
  onDutySince: string | null;
  /** The latest open call this officer is on, if any. */
  busyWith: { id: string; number: string } | null;
  /** Open calls they respond to or are assigned to — officers may hold several (0042). */
  activeCalls: number;
};

/**
 * Officers on duty in the app right now — the people a dispatch reaches —
 * with their last position and whether they are already on a call.
 */
export async function listOnDutyOfficers(client: CriticomClient, silos?: Silo[]) {
  let q = client
    .from('personnel')
    .select('user_id, first_name, last_name, rank, badge_number, silo, station, latitude, longitude, updated_at, duty_started_at, apparatus:assigned_apparatus_id (unit_number)')
    .eq('is_on_duty', true)
    .not('user_id', 'is', null);
  if (silos?.length) q = q.in('silo', silos);
  const { data: people, error } = await q;
  if (error) throw error;

  const officers: OnDutyOfficer[] = ((people ?? []) as Array<Record<string, unknown>>).map((p) => {
    const lat = (p.latitude as number | null) ?? null;
    const lng = (p.longitude as number | null) ?? null;
    const noFix = lat === null || lng === null || (lat === 0 && lng === 0);
    return {
      userId: p.user_id as string,
      name: `${p.rank ?? ''} ${p.first_name ?? ''} ${p.last_name ?? ''}`.replace(/\s+/g, ' ').trim(),
      badge: String(p.badge_number ?? ''),
      silo: p.silo as Silo,
      station: (p.station as string | null) ?? null,
      unitNumber: (p.apparatus as { unit_number?: string } | null)?.unit_number ?? null,
      lat: noFix ? null : lat,
      lng: noFix ? null : lng,
      seenAt: String(p.updated_at),
      onDutySince: (p.duty_started_at as string | null) ?? null,
      busyWith: null,
      activeCalls: 0,
    };
  });

  const ids = officers.map((o) => o.userId);
  if (ids.length) {
    // Calls they respond to (lead or backup) and calls assigned to them but
    // not yet answered; each counted once per officer.
    const [responding, assigned] = await Promise.all([
      client
        .from('incident_responders')
        .select('user_id, incident:incidents!inner(id, incident_number, status)')
        .in('user_id', ids)
        .not('incident.status', 'in', '("Closed","Resolved")'),
      client
        .from('incidents')
        .select('id, incident_number, assigned_to')
        .in('assigned_to', ids)
        .not('status', 'in', '("Closed","Resolved")'),
    ]);
    if (responding.error) throw responding.error;
    if (assigned.error) throw assigned.error;
    const calls = new Map<string, Map<string, string>>();
    const add = (userId: string | null, id: string, number: string) => {
      if (!userId) return;
      const mine = calls.get(userId) ?? new Map<string, string>();
      mine.set(id, number);
      calls.set(userId, mine);
    };
    for (const r of (responding.data ?? []) as unknown as Array<{ user_id: string; incident: { id: string; incident_number: string } }>) {
      add(r.user_id, r.incident.id, r.incident.incident_number);
    }
    for (const a of assigned.data ?? []) add(a.assigned_to, a.id, a.incident_number);
    for (const officer of officers) {
      const mine = calls.get(officer.userId);
      if (!mine) continue;
      officer.activeCalls = mine.size;
      const [first] = mine.entries();
      if (first) officer.busyWith = { id: first[0], number: first[1] };
    }
  }
  return officers;
}

/**
 * Short-lived links to evidence files, keyed by storage path. Storage RLS
 * decides what the caller may open; files they cannot see are simply absent.
 */
export async function signIncidentMedia(client: CriticomClient, paths: string[], expiresIn = 3600) {
  const urls = new Map<string, string>();
  if (paths.length === 0) return urls;
  const { data, error } = await client.storage.from('incident-media').createSignedUrls(paths, expiresIn);
  if (error) throw error;
  for (const row of data ?? []) {
    if (row.path && row.signedUrl) urls.set(row.path, row.signedUrl);
  }
  return urls;
}
