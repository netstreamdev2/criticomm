import type { IncidentSeverity, IncidentStatus, Silo, UserRole } from '@criticom/db';

/**
 * Criti: the assistant's shared vocabulary.
 *
 * Criti never acts on its own. It reads what the signed-in person may read,
 * points out what needs attention (insights), and offers to do things
 * (proposals). A proposal runs only when the person confirms it, through
 * the same database functions the forms use, so their role and their
 * department decide, never the assistant.
 */

export type DeskSilo = Exclude<Silo, 'Ethekwini'>;

/** The signed-in person, as the database knows them. */
export type CritiMe = {
  userId: string;
  name: string;
  role: UserRole;
  silo: Silo;
};

/** A call, as much of it as Criti reasons over. */
export type CritiIncident = {
  id: string;
  incident_number: string;
  silo: Silo;
  tagged_silos: Silo[] | null;
  dispatched_silos: Silo[] | null;
  incident_type: string;
  incident_category: string | null;
  incident_severity: IncidentSeverity;
  status: IncidentStatus;
  source: string | null;
  location_address: string;
  location_lat: number | null;
  location_lng: number | null;
  caller_name: string | null;
  caller_number: string | null;
  call_timestamp: string;
  incident_created_at: string;
  dispatch_time: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  assigned_at: string | null;
  accepted_by: string | null;
  accepted_at: string | null;
  arrived_timestamp: string | null;
  responding_officer: string | null;
  number_of_victims: number | null;
  medical_type: string | null;
  created_by: string | null;
  updated_at: string;
  /** The latest timeline entry, when known. */
  last_note_at?: string | null;
};

/** Someone on duty in the app: the people a dispatch reaches. */
export type CritiCrew = {
  userId: string;
  name: string;
  badge: string;
  silo: Silo;
  station: string | null;
  unitNumber: string | null;
  lat: number | null;
  lng: number | null;
  seenAt: string;
  onDutySince: string | null;
  /** When their app last reached the server (a fix, the radio): on duty but silent for hours means they left without going off duty. */
  lastContactAt?: string | null;
  busyWith: { id: string; number: string } | null;
  activeCalls: number;
};

/** Silent this long, they are listed but not offered for a call: most likely gone home still marked on duty. */
export const OUT_OF_TOUCH_MS = 8 * 3_600_000;
/** Silent this long, Criti says so beside their name. */
export const QUIET_MS = 30 * 60_000;

/** True when their app has not been heard from for `ms`. */
export function silentFor(c: Pick<CritiCrew, 'lastContactAt' | 'seenAt'>, now: Date, ms: number): boolean {
  const last = c.lastContactAt ?? c.seenAt;
  return Boolean(last) && now.getTime() - new Date(last).getTime() > ms;
}

/**
 * When something counts as late. The dispatch figures follow the automatic
 * rules (Admin → Automations), the rest Operations Settings, so a tile and
 * the escalation it warns about never disagree.
 */
export type CritiThresholds = {
  /** A call waiting this long for dispatch is late (sla_unassigned warn). */
  lateWarnMinutes: number;
  /** …and this long is badly late (sla_unassigned critical). */
  lateCriticalMinutes: number;
  /** Sent to a crew, and nobody has pressed Responding after this long. */
  notAcceptedMinutes: number;
  /** Accepted, and no crew on scene after this long (sla_no_arrival). */
  noArrivalMinutes: number;
  /** An open call with no news for this long has gone quiet (stale_incidents). */
  quietHours: number;
  /** Two open calls this close together may be the same emergency. */
  duplicateHours: number;
  /** On duty longer than this is a long shift (duty.max_shift_hours). */
  maxShiftHours: number;
  /** On scene longer than this with the call still open (sla.call_duration_target_minutes). */
  onSceneMinutes: number;
  /** This many calls waiting for one department is a queue building. */
  queueBuilding: number;
  /** Travel estimate: average road speed and how much longer roads are than a straight line. */
  etaSpeedKmh: number;
  etaRoadFactor: number;
};

export const DEFAULT_THRESHOLDS: CritiThresholds = {
  lateWarnMinutes: 10,
  lateCriticalMinutes: 20,
  notAcceptedMinutes: 5,
  noArrivalMinutes: 30,
  quietHours: 4,
  duplicateHours: 12,
  maxShiftHours: 14,
  onSceneMinutes: 120,
  queueBuilding: 4,
  etaSpeedKmh: 42,
  etaRoadFactor: 1.35,
};

/* ── What Criti may offer to do ─────────────────────────────────────── */

/** The steps the desk may record for a crew that radioed it in (STATUS_OVERRIDE_STEPS). */
export type CrewStep = 'En Route' | 'Arrived' | 'On Scene' | 'Transporting';

/** The four medical priority codes the intake form offers. */
export const MEDICAL_PRIORITIES = [
  'P1 - RED: Critical / Life Threatening',
  'P2 - ORANGE: Urgent / Serious',
  'P3 - YELLOW: Minor / Walking Wounded',
  'P4 - BLUE: Deceased (Mortuary)',
] as const;

export const REGIONS = ['Central', 'North', 'South', 'West', 'Outer'] as const;

/** A call being logged through Criti. Empty text means not known yet. */
export type CallDraft = {
  caller_name: string;
  caller_number: string;
  is_caller_patient: boolean | null;
  patient_names: string;
  call_description: string;
  /** An exact incident code from the configured list. */
  incident_type: string;
  /** The code's group, from the same list. */
  incident_category: string;
  incident_severity: IncidentSeverity | null;
  location_address: string;
  location_lat: number | null;
  location_lng: number | null;
  suburb: string;
  city: string;
  postal_code: string;
  region: string;
  number_of_victims: number | null;
  ems_not_required: boolean;
  medical_priority: string;
  notes: string;
  /** The dispatch desks that receive it (0068). */
  tagged_silos: DeskSilo[];
};

export type Proposal =
  | { kind: 'log_call'; call: CallDraft }
  | { kind: 'assign_officer'; incident_id: string; incident_number: string; user_id: string; officer: string; note: string | null }
  | { kind: 'dispatch_all'; incident_id: string; incident_number: string; silos: DeskSilo[]; note: string | null }
  | { kind: 'send_to_desk'; incident_id: string; incident_number: string; silos: DeskSilo[]; note: string | null }
  | { kind: 'add_note'; incident_id: string; incident_number: string; text: string }
  | { kind: 'set_status'; incident_id: string; incident_number: string; status: CrewStep }
  | { kind: 'cancel_call'; incident_id: string; incident_number: string; reason: string }
  | { kind: 'broadcast'; silos: Silo[]; message: string; severity: 'Medium' | 'High' | 'Critical' };

export type ProposalKind = Proposal['kind'];

/** A proposal as the person reads it before confirming. */
export type ProposalView = {
  proposal: Proposal;
  title: string;
  /** What will happen, line by line. */
  lines: string[];
  /** Read before confirming: a possible duplicate, nobody on duty… */
  warnings: string[];
  /** Still needed before it can run. While any remain, there is no Confirm. */
  missing: string[];
  confirmLabel: string;
};

/* ── What Criti points out ──────────────────────────────────────────── */

export type InsightKind =
  | 'sos'
  | 'incoming_critical'
  | 'late_dispatch'
  | 'not_accepted'
  | 'no_arrival'
  | 'gone_quiet'
  | 'possible_duplicate'
  | 'missing_desk'
  | 'no_crews'
  | 'queue_building'
  | 'long_shift'
  | 'on_scene_long'
  | 'my_call';

export type InsightTone = 'critical' | 'high' | 'warning' | 'info';

export type InsightAction =
  | { type: 'link'; label: string; href: string }
  | { type: 'propose'; label: string; view: ProposalView }
  | { type: 'ask'; label: string; prompt: string };

export type Insight = {
  /** Stable while the condition lasts, so a dismissed tile stays dismissed. */
  id: string;
  kind: InsightKind;
  tone: InsightTone;
  /** Lower is more urgent. */
  rank: number;
  title: string;
  body: string;
  /** When the condition began; the tile counts up from here. */
  since: string | null;
  incident: { id: string; number: string; type: string; severity: IncidentSeverity; address: string; status: IncidentStatus } | null;
  actions: InsightAction[];
};
