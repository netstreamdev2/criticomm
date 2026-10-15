import type { Database, DepartmentPartStatus, IncidentStatus, Silo } from '@criticom/db';

/**
 * A call sent to several departments has one part per department (migration
 * 0073): waiting at the department's desk, dispatched, its lead's progress,
 * then finished by its report or stood down. These rules have no
 * dependencies so they can be tested, and mirror the database:
 * forDepartment() is incident_for_department().
 */

export type DepartmentPart = Database['public']['Tables']['incident_departments']['Row'];

/** The embedded select that brings a call's parts with it. */
export const PARTS = 'departments:incident_departments(*)';

const OPEN: readonly DepartmentPartStatus[] = ['Waiting', 'Dispatched', 'En Route', 'Arrived', 'On Scene', 'Transporting'];
const ORDER: readonly Silo[] = ['MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster'];

/** Still being worked, or waiting to be. */
export function partOpen(status: DepartmentPartStatus): boolean {
  return OPEN.includes(status);
}

/** On the way to the scene: 0 waiting … 5 transporting; null once finished. */
export function partStep(status: DepartmentPartStatus): number | null {
  const i = OPEN.indexOf(status);
  return i < 0 ? null : i;
}

/** This department's part, if the call was sent to it. */
export function partFor(parts: readonly DepartmentPart[] | null | undefined, silo: Silo | string | null | undefined) {
  return (parts ?? []).find((p) => p.silo === silo) ?? null;
}

/** The parts in the order the desks read them: Police, Fire, EMS, Disaster. */
export function sortParts<T extends Pick<DepartmentPart, 'silo'>>(parts: readonly T[] | null | undefined): T[] {
  return [...(parts ?? [])].sort((a, b) => ORDER.indexOf(a.silo) - ORDER.indexOf(b.silo));
}

/** The call's status as one department sees it. */
export function statusForPart(part: Pick<DepartmentPart, 'status'> | null, callStatus: IncidentStatus): IncidentStatus {
  if (callStatus === 'Closed') return 'Closed';
  if (!part || part.status === 'Waiting') return 'Pending Dispatch';
  if (part.status === 'Not needed' || part.status === 'Cancelled') return 'Closed';
  return part.status;
}

type CallShape = {
  status: IncidentStatus;
  accepted_by?: string | null;
  accepted_at?: string | null;
  responding_officer?: string | null;
  assigned_to?: string | null;
  assigned_to_name?: string | null;
  report_filed_at?: string | null;
  dispatch_time?: string | null;
  arrived_timestamp?: string | null;
  departments?: readonly DepartmentPart[] | null;
  responders?: ReadonlyArray<{ silo: string }> | null;
};

/**
 * The call as one department sees it: its own status, lead, assignment,
 * dispatch, arrival, report, and crew. A call from before 0073 (no parts
 * read) is returned as it is.
 */
export function forDepartment<T extends CallShape>(call: T, silo: Silo | string | null | undefined): T {
  if (!call.departments || !silo) return call;
  const part = partFor(call.departments, silo);
  const responders = call.responders?.filter((r) => r.silo === silo);
  if (!part) {
    return {
      ...call,
      status: statusForPart(null, call.status),
      accepted_by: null, accepted_at: null, assigned_to: null, assigned_to_name: null, report_filed_at: null,
      ...(responders ? { responders } : {}),
    };
  }
  return {
    ...call,
    status: statusForPart(part, call.status),
    accepted_by: part.lead_id,
    accepted_at: part.accepted_at,
    responding_officer: part.lead_name ?? call.responding_officer ?? null,
    assigned_to: part.assigned_to,
    assigned_to_name: part.assigned_to_name,
    report_filed_at: part.report_filed_at,
    dispatch_time: part.dispatched_at ?? call.dispatch_time ?? null,
    arrived_timestamp: part.arrived_at ?? call.arrived_timestamp ?? null,
    ...(responders ? { responders } : {}),
  };
}

/** A part in a few plain words, for the desks. */
export function partWords(
  part: Pick<DepartmentPart, 'status' | 'lead_name' | 'assigned_to_name'> & { closed_at?: string | null },
): string {
  switch (part.status) {
    case 'Waiting': return 'Waiting to dispatch';
    case 'Dispatched':
      return part.assigned_to_name ? `Assigned to ${part.assigned_to_name}` : 'Dispatched';
    case 'En Route':
    case 'Arrived':
    case 'On Scene':
    case 'Transporting':
      return part.lead_name ? `${part.status} · ${part.lead_name}` : part.status;
    case 'Resolved': return part.closed_at ? 'Closed on scene' : 'Report filed';
    case 'Not needed': return 'Not needed';
    case 'Cancelled': return 'Cancelled';
  }
}

/** Departments still on the call, by name. */
export function openParts<T extends Pick<DepartmentPart, 'silo' | 'status'>>(parts: readonly T[] | null | undefined): T[] {
  return sortParts(parts).filter((p) => partOpen(p.status));
}

/**
 * The departments a closed part waits on (0074): still working the call, or
 * filed and not yet closed by their lead. Stood down and cancelled parts are
 * done. Mirrors close_department_part().
 */
export function waitingParts<T extends Pick<DepartmentPart, 'silo' | 'status'> & { closed_at?: string | null }>(
  parts: readonly T[] | null | undefined,
  exceptSilo?: Silo | string | null,
): T[] {
  return sortParts(parts).filter((p) => p.silo !== exceptSilo
    && (partOpen(p.status) || (p.status === 'Resolved' && !p.closed_at)));
}

const BEFORE_DISPATCH: readonly string[] = ['New', 'Pending', 'Pending Dispatch', 'Pending Analysis'];

/**
 * Whether a dispatch desk may still edit the call (0079, dispatcher_edit_call):
 * a department's desk until its own department's crews are sent, the control
 * room (no desk) until any are. A call from before 0073 has no parts: its
 * status says. The database makes the same check.
 */
export function editableBeforeDispatch(
  call: { status: IncidentStatus; departments?: readonly Pick<DepartmentPart, 'silo' | 'dispatched_at'>[] | null },
  desk: Silo | null,
): boolean {
  if (call.status === 'Resolved' || call.status === 'Closed') return false;
  const parts = call.departments ?? [];
  if (parts.length === 0) return BEFORE_DISPATCH.includes(call.status);
  return !parts.some((p) => p.dispatched_at && (desk === null || p.silo === desk));
}
