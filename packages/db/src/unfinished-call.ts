/**
 * A call sent to dispatch before its details were in (0076) is unfinished
 * until they are. Who may finish it, and why not, in the same words for the
 * call logger, the call page and the list of unfinished calls. The database
 * makes the same check in complete_call_intake(): this only decides what the
 * screens offer, never what is allowed.
 */

/** The roles complete_call_intake() lets in at all. */
const FINISH_ROLES: readonly string[] = ['SystemAdmin', 'SuperAdmin', 'Admin', 'ControlRoom', 'IncidentLogger', 'System'];
/** Who may finish anyone's call: the platform, and the organisation's control room and administrators. */
const ANY_CALL_ROLES: readonly string[] = ['SystemAdmin', 'SuperAdmin', 'System'];
const CONTROL_ROOM_ROLES: readonly string[] = ['ControlRoom', 'Admin'];

export type FinishCallBlock = 'finished' | 'closed' | 'not-yours' | 'role';

/** Why this person may not finish this call, or null when they may. */
export function finishCallBlock(
  me: { userId: string; role: string; silo: string },
  call: { created_by: string | null; status: string; intake_complete: boolean | null },
): FinishCallBlock | null {
  if (call.status === 'Resolved' || call.status === 'Closed') return 'closed';
  if (call.intake_complete !== false) return 'finished';
  if (!FINISH_ROLES.includes(me.role)) return 'role';
  if (call.created_by === me.userId) return null;
  if (ANY_CALL_ROLES.includes(me.role)) return null;
  if (CONTROL_ROOM_ROLES.includes(me.role) && me.silo === 'Ethekwini') return null;
  return 'not-yours';
}

export function mayFinishCall(
  me: { userId: string; role: string; silo: string },
  call: { created_by: string | null; status: string; intake_complete: boolean | null },
): boolean {
  return finishCallBlock(me, call) === null;
}

/** May this person see every unfinished call in the organisation, not just their own. */
export function seesAllUnfinished(me: { role: string; silo: string }): boolean {
  return ANY_CALL_ROLES.includes(me.role) || (CONTROL_ROOM_ROLES.includes(me.role) && me.silo === 'Ethekwini');
}
