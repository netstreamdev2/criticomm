/**
 * Where a call stands for this officer once their department's part is done,
 * with no dependencies so it can be tested. Feeds the Closed tab.
 *
 * The lead files the report (the part is finished), then closes the part on
 * scene (migration 0074). Case review closes the case afterwards; the
 * officer's close neither closes the case nor waits for it.
 */

/** Close is offered for this long after the report; older filed calls just show as filed. */
export const CLOSE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type PartLike = {
  silo: string;
  status: string;
  lead_id: string | null;
  report_filed_at: string | null;
  closed_at?: string | null;
  closed_by_name?: string | null;
};

/** The call as the officer's department sees it (forDepartment). */
export type ClosingCall = {
  status: string;
  accepted_by?: string | null;
  report_filed_at?: string | null;
  close_kind?: string | null;
  departments?: readonly PartLike[] | null;
};

export type Finish =
  /** Report filed and I lead: Close is mine to press. `reportSending`: the report is still on this phone. */
  | { kind: 'to_close'; reportSending: boolean }
  /** My Close is waiting for signal. */
  | { kind: 'closing' }
  /** My department's part is closed on scene. */
  | { kind: 'closed'; at: string | null; by: string | null }
  /** The report is filed and nobody has closed it (I am backup, or Close is no longer offered). */
  | { kind: 'filed' }
  | { kind: 'not_needed' }
  | { kind: 'cancelled' }
  /** Case review closed the case before the part was closed. */
  | { kind: 'case_closed' };

/**
 * Where the call stands for me, or null while my department still works it.
 * `queued` is what this phone holds that the server has not heard yet.
 */
export function finishOf(
  call: ClosingCall,
  me: { userId: string; silo: string },
  queued: { report: boolean; close: boolean },
  now = Date.now(),
): Finish | null {
  const part = (call.departments ?? []).find((p) => p.silo === me.silo) ?? null;
  const lead = (part ? part.lead_id : call.accepted_by ?? null) === me.userId;
  const filedAt = part ? part.report_filed_at : call.report_filed_at ?? null;

  if (part?.closed_at) return { kind: 'closed', at: part.closed_at, by: part.closed_by_name ?? null };
  if (queued.close) return { kind: 'closing' };
  if (part?.status === 'Not needed') return { kind: 'not_needed' };
  if (part?.status === 'Cancelled' || (call.status === 'Closed' && call.close_kind === 'Cancelled')) return { kind: 'cancelled' };
  if (call.status === 'Closed') return { kind: 'case_closed' };
  if (filedAt) {
    const recent = now - new Date(filedAt).getTime() < CLOSE_WINDOW_MS;
    return lead && recent ? { kind: 'to_close', reportSending: false } : { kind: 'filed' };
  }
  // Filed on this phone in a dead zone (only the lead gets to file): the Close queues behind it.
  if (queued.report) return { kind: 'to_close', reportSending: true };
  if (call.status === 'Resolved') return { kind: 'filed' };
  return null;
}

/** The order on the Closed tab: anything still to close first, then newest. */
export function finishRank(f: Finish): number {
  return f.kind === 'to_close' ? 0 : f.kind === 'closing' ? 1 : 2;
}
