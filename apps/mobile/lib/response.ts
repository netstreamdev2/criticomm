import { english, tx, type Translate } from '@criticom/db/i18n';
import type { IncidentStatus } from '@criticom/db/types';
import { wordsIn } from './department.ts';

/**
 * How a crew works a call, with no app dependencies so it can be tested.
 * The wording is in English unless a translator `t` is passed.
 *
 * A police call is closed by its case report, not by a status: the lead
 * goes En Route (responding), On Scene, then files the report — the server
 * resolves the call when the report lands (migration 0039) and refuses a bare
 * "Resolved" from the field. A firefighter works the same way with the fire
 * report (migration 0059), and may mark Transporting on the way. A paramedic
 * works it with the patient care report (migrations 0063, 0064), the same
 * way, and a Disaster Management officer with the post-mortem (migration
 * 0065). Other services keep the full ladder.
 */

/** Photos per case file; the server enforces the same number. */
export const MAX_PHOTOS = 10;

type CallLike = {
  silo: string;
  dispatched_silos?: readonly string[] | null;
  report_filed_at?: string | null;
};

export function isPoliceCall(call: CallLike) {
  return call.silo === 'MetroPolice' || (call.dispatched_silos ?? []).includes('MetroPolice');
}

export type NextStep =
  | { kind: 'status'; status: IncidentStatus; label: string }
  | { kind: 'report'; label: string }
  | null;

/** A firefighter works a call with the fire report, whatever department owns it. */
export function isFireResponder(silo: string | null | undefined) {
  return silo === 'MetroFire';
}

/** A paramedic works a call with the patient care report, whatever department owns it. */
export function isEmsResponder(silo: string | null | undefined) {
  return silo === 'Medical';
}

/** A Disaster Management officer closes an incident with the post-mortem (migration 0065). */
export function isDisasterResponder(silo: string | null | undefined) {
  return silo === 'EthekwiniDisaster';
}

/** Where the lead files the report that closes the call. */
export function reportPathFor(incidentId: string, meSilo: string | null | undefined) {
  if (isFireResponder(meSilo)) return `/fire-report/${incidentId}`;
  if (isEmsResponder(meSilo)) return `/pcr/${incidentId}`;
  if (isDisasterResponder(meSilo)) return `/post-mortem/${incidentId}`;
  return `/report/${incidentId}`;
}

const FIRE_LADDER: Partial<Record<IncidentStatus, IncidentStatus>> = {
  Dispatched: 'En Route',
  'En Route': 'On Scene',
  Arrived: 'On Scene',
};

const POLICE_LADDER: Partial<Record<IncidentStatus, IncidentStatus>> = {
  Dispatched: 'En Route',
  'En Route': 'On Scene',
  Arrived: 'On Scene',
};

const LADDER: Partial<Record<IncidentStatus, IncidentStatus>> = {
  Dispatched: 'En Route',
  'En Route': 'Arrived',
  Arrived: 'On Scene',
  'On Scene': 'Transporting',
  Transporting: 'Resolved',
};

/** The button that moves a call on to each status. */
const MARK: Partial<Record<IncidentStatus, string>> = {
  'En Route': tx('Accept · Mark En Route'),
  Arrived: tx('Mark Arrived'),
  'On Scene': tx('Mark On Scene'),
  Transporting: tx('Mark Transporting'),
  Resolved: tx('Mark Resolved'),
};
const markLabel = (to: IncidentStatus, t: Translate) => t(MARK[to] ?? to);

/** The one action the crew takes next on this call, if any. */
export function nextStep(call: CallLike, status: IncidentStatus, meSilo?: string, t: Translate = english.t): NextStep {
  if (status === 'Resolved' || status === 'Closed') return null;
  if (isFireResponder(meSilo) || isEmsResponder(meSilo) || isDisasterResponder(meSilo)) {
    if (call.report_filed_at) return null;
    if (status === 'On Scene' || status === 'Transporting') {
      return {
        kind: 'report',
        label: isEmsResponder(meSilo) ? t('File patient report') : isDisasterResponder(meSilo) ? t('File post-mortem') : t('File fire report'),
      };
    }
    const to = FIRE_LADDER[status];
    return to ? { kind: 'status', status: to, label: markLabel(to, t) } : null;
  }
  if (isPoliceCall(call)) {
    if (call.report_filed_at) return null;
    if (status === 'On Scene' || status === 'Transporting') {
      return { kind: 'report', label: t('File incident report') };
    }
    const to = POLICE_LADDER[status];
    return to ? { kind: 'status', status: to, label: markLabel(to, t) } : null;
  }
  const to = LADDER[status];
  return to ? { kind: 'status', status: to, label: to === 'En Route' ? t('Mark En Route') : markLabel(to, t) } : null;
}

/**
 * The optional step beside the main one: a firefighter on scene may mark
 * Transporting (casualties to hospital, the appliance moving) before filing.
 */
export function secondaryStep(call: CallLike, status: IncidentStatus, meSilo?: string, t: Translate = english.t): NextStep {
  if (!(isFireResponder(meSilo) || isEmsResponder(meSilo)) || call.report_filed_at) return null;
  return status === 'On Scene' ? { kind: 'status', status: 'Transporting', label: t('Mark Transporting') } : null;
}

/** Statuses before a call has been sent out to anyone. */
const NOT_SENT: readonly string[] = ['New', 'Pending', 'Pending Dispatch', 'Pending Analysis'];

export type Responder = {
  user_id: string;
  name: string | null;
  role: 'lead' | 'backup';
  status: IncidentStatus;
};

export type FieldCall = CallLike & {
  id: string;
  status: IncidentStatus;
  assigned_to?: string | null;
  assigned_to_name?: string | null;
  accepted_by?: string | null;
  responding_officer?: string | null;
  responders?: readonly Responder[] | null;
  /** 'Responder-Panic' for an officer's SOS; with created_by, who raised it. */
  source?: string | null;
  created_by?: string | null;
};

/** Who holds the call, from where I stand. */
export type Assignment =
  | { kind: 'you' }
  | { kind: 'other'; name: string }
  | { kind: 'open' };

export type CallAction =
  | { kind: 'respond'; asLead: boolean; label: string }
  | { kind: 'status'; status: IncidentStatus; label: string }
  | { kind: 'report'; label: string };

export type CallView = {
  /** My place on the call, if I am responding. */
  role: 'lead' | 'backup' | null;
  /** My own status: the call's for the lead, my row's for backup. */
  myStatus: IncidentStatus | null;
  assignment: Assignment;
  lead: Responder | null;
  backups: Responder[];
  /** The one thing I can do next, if anything. */
  action: CallAction | null;
  /** An optional step beside it (a firefighter on scene: Mark Transporting). */
  secondary: CallAction | null;
  /** Why the action cannot be taken right now (shown, button disabled). */
  blocked: string | null;
  /** Why there is no action at all, when that is worth saying. */
  note: string | null;
  /** My own SOS: I am the one help is being sent to. */
  ownSos: boolean;
};

/**
 * Everything the phone shows about a call for this officer (migration 0042):
 * the assigned officer, or the first to respond to a send-to-all call, leads
 * it; anyone else it was sent to may respond as backup. An officer may hold
 * several calls. `queued` is a status set on this phone that has not reached
 * the server yet — it counts, so the screen shows what the officer did.
 */
export function callView(
  call: FieldCall,
  me: { userId: string; silo: string; onDuty: boolean | null },
  queued: IncidentStatus | null = null,
  t: Translate = english.t,
): CallView {
  const responders = call.responders ?? [];
  const lead: Responder | null = responders.find((r) => r.role === 'lead')
    ?? (call.accepted_by
      ? { user_id: call.accepted_by, name: call.responding_officer ?? null, role: 'lead', status: call.status }
      : null);
  const backups = responders.filter((r) => r.role === 'backup');
  const assignedToMe = call.assigned_to === me.userId;

  let mine = responders.find((r) => r.user_id === me.userId)
    ?? (lead?.user_id === me.userId ? lead : null);
  if (!mine && queued) {
    // Responded offline: the server will decide, this is its rule.
    const asLead = !lead && (!call.assigned_to || assignedToMe);
    mine = { user_id: me.userId, name: null, role: asLead ? 'lead' : 'backup', status: queued };
  }
  const role = mine?.role ?? null;
  const myStatus: IncidentStatus | null = role === 'lead'
    ? (queued ?? call.status)
    : role === 'backup' ? (queued ?? mine?.status ?? null) : null;

  const words = wordsIn(me.silo, t);
  const assignment: Assignment = lead?.user_id === me.userId || (assignedToMe && !lead)
    ? { kind: 'you' }
    : lead
      ? { kind: 'other', name: lead.name ?? t('another {person}', { person: words.person }) }
      : call.assigned_to
        ? { kind: 'other', name: call.assigned_to_name ?? t('another {person}', { person: words.person }) }
        : { kind: 'open' };

  const ownSos = call.source === 'Responder-Panic' && call.created_by === me.userId;
  const view: CallView = { role, myStatus, assignment, lead, backups, action: null, secondary: null, blocked: null, note: null, ownSos };
  if (call.status === 'Resolved' || call.status === 'Closed') return view;
  // The officer in trouble never responds to their own SOS (migration 0044).
  if (ownSos) {
    view.note = t('This is your SOS — dispatch is sending help to you.');
    return view;
  }

  if (role === 'lead' && myStatus) {
    view.action = nextStep(call, myStatus, me.silo, t);
    view.secondary = secondaryStep(call, myStatus, me.silo, t);
    return view;
  }
  if (role === 'backup') {
    if (myStatus === 'En Route') view.action = { kind: 'status', status: 'On Scene', label: t('Mark On Scene') };
    else view.note = t('You are backup on this incident — the lead {person} files the {report}.', { person: words.person, report: words.report });
    return view;
  }

  const sentToMe = assignedToMe
    || (!NOT_SENT.includes(call.status) && (call.dispatched_silos ?? []).includes(me.silo));
  if (!sentToMe) {
    view.note = t('View only — this incident was not sent to your department.');
    return view;
  }
  const asLead = !lead && (!call.assigned_to || assignedToMe);
  view.action = { kind: 'respond', asLead, label: t('Accept') };
  if (me.onDuty === false) view.blocked = t('Go on duty to respond to incidents.');
  return view;
}

/** What the officer is doing right now, for the home screen. */
export type Activity =
  | { kind: 'idle' }
  | { kind: 'en_route' | 'on_scene' | 'transporting' | 'reporting'; incidentId: string; incidentNumber: string }
  /** Dispatch assigned it to me and I have not pressed Responding yet. */
  | { kind: 'assigned'; incidentId: string; incidentNumber: string; count: number };

/**
 * No open call is idle. With one, the report being written (screen open, or
 * filed and still in the outbox) outranks the call's status, which otherwise
 * maps onto the ladder: accepted is en route, arrived is on scene.
 */
export function activityOf(
  call: { id: string; incident_number: string; status: IncidentStatus | null } | null,
  reporting: boolean,
): Activity {
  if (!call) return { kind: 'idle' };
  const at = { incidentId: call.id, incidentNumber: call.incident_number };
  if (reporting) return { kind: 'reporting', ...at };
  switch (call.status) {
    case 'Arrived':
    case 'On Scene':
      return { kind: 'on_scene', ...at };
    case 'Transporting':
      return { kind: 'transporting', ...at };
    default:
      return { kind: 'en_route', ...at };
  }
}

const ACTIVITY_RANK: Record<Activity['kind'], number> = {
  reporting: 0, on_scene: 1, transporting: 2, en_route: 3, assigned: 4, idle: 9,
};

/**
 * With several incidents, the home screen shows the most pressing: writing a
 * report, then on scene, transporting, en route. Incidents assigned to me that
 * I have not responded to yet replace "idle" — never the work in hand.
 * `awaiting` is newest first; the chip points at the newest.
 */
export function pickActivity(
  calls: ReadonlyArray<{ id: string; incident_number: string; status: IncidentStatus | null }>,
  reporting: (id: string) => boolean,
  awaiting: ReadonlyArray<{ id: string; incident_number: string }> = [],
): Activity {
  let best: Activity = { kind: 'idle' };
  for (const call of calls) {
    const a = activityOf(call, reporting(call.id));
    if (ACTIVITY_RANK[a.kind] < ACTIVITY_RANK[best.kind]) best = a;
  }
  const [next] = awaiting;
  if (best.kind === 'idle' && next) {
    return { kind: 'assigned', incidentId: next.id, incidentNumber: next.incident_number, count: awaiting.length };
  }
  return best;
}

/** Photos left to take, counting those still waiting in the outbox. */
export function photosRemaining(filed: number, queued: number) {
  return Math.max(0, MAX_PHOTOS - filed - queued);
}
