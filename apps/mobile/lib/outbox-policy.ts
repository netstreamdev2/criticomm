import type { Silo } from '@criticom/db/types';

/**
 * The outbox's rules, with no dependencies.
 *
 * Split out from `outbox.ts` — which owns AsyncStorage and the filesystem —
 * purely so this can be tested. Every decision here is one a responder's record
 * depends on: whether a panic is sent before a photo, whether a failed upload
 * is retried or written off, whether two position fixes collapse into one. All
 * of it is reachable only through a dead zone, which is the least convenient
 * place to discover it is wrong.
 */

export type OutboxOp =
  | {
      kind: 'incident_status';
      incidentId: string;
      status: string;
      incidentNumber?: string;
    }
  | {
      kind: 'incident_note';
      incidentId: string;
      silo: Silo;
      message: string;
    }
  | {
      kind: 'evidence';
      incidentId: string;
      silo: Silo;
      /** File inside the outbox directory — owned by us, deleted after delivery. */
      localUri: string;
      filename: string;
      mimeType: string;
      mediaKind: 'image' | 'audio' | 'video' | 'document';
      caption?: string;
    }
  | {
      kind: 'panic';
      silo: Silo;
      lat: number | null;
      lng: number | null;
      accuracy: number | null;
      responderName: string;
      note?: string;
    }
  | {
      kind: 'duty_location';
      lat: number;
      lng: number;
    };

export type OutboxStatus = 'queued' | 'failed';

export type OutboxEntry = {
  id: string;
  op: OutboxOp;
  /**
   * Who captured this. Delivery only ever happens under the same account.
   *
   * Handsets are shared across shifts. Without this, an update queued by the
   * officer going off duty would be delivered under the session of whoever
   * signed in next — attributing their action, and their position, to the
   * wrong person in a record that is later read as evidence. Absent on entries
   * written by an older build; those are delivered under whoever is signed in,
   * which is the pre-existing behaviour and no worse than it was.
   */
  userId?: string;
  /** When the responder performed the action — the time that gets recorded. */
  occurredAt: string;
  attempts: number;
  status: OutboxStatus;
  lastError?: string;
  /** Epoch ms before which delivery should not be retried (backoff). */
  nextAttemptAt: number;
};

/**
 * Ops that supersede an earlier op of the same key rather than queueing behind
 * it. Only position heartbeats qualify: five stale fixes tell dispatch nothing
 * that the newest one does not, and replaying them would walk the marker
 * backwards across the map on reconnect.
 *
 * Everything else — a status change, a note, a photo — is a distinct event with
 * its own evidential value and is never collapsed.
 */
export function dedupeKeyOf(op: OutboxOp): string | null {
  return op.kind === 'duty_location' ? 'duty_location' : null;
}

export function describe(op: OutboxOp): string {
  switch (op.kind) {
    case 'incident_status':
      return `Status → ${op.status}${op.incidentNumber ? ` · ${op.incidentNumber}` : ''}`;
    case 'incident_note':
      return `Update · ${op.message.slice(0, 40)}${op.message.length > 40 ? '…' : ''}`;
    case 'evidence':
      return `${op.mediaKind === 'audio' ? 'Voice note' : 'Photo'} · ${op.filename}`;
    case 'panic':
      return 'EMERGENCY — officer needs assistance';
    case 'duty_location':
      return 'Position update';
  }
}

/**
 * Delivery order. A panic outranks everything: if the phone gets three seconds
 * of signal, those seconds must carry the emergency, not a queue of photos.
 * Status changes come next because dispatch is making crew-allocation decisions
 * off them, then notes, then attachments — which are the largest and the least
 * time-critical.
 */
const PRIORITY: Record<OutboxOp['kind'], number> = {
  panic: 0,
  incident_status: 1,
  duty_location: 2,
  incident_note: 3,
  evidence: 4,
};

export function comparePriority(a: OutboxEntry, b: OutboxEntry): number {
  const byKind = PRIORITY[a.op.kind] - PRIORITY[b.op.kind];
  if (byKind !== 0) return byKind;
  return a.occurredAt.localeCompare(b.occurredAt);
}

/**
 * Give up on *automatic* retries after this many failures. The op is not
 * deleted — it moves to `failed` and waits for a human.
 *
 * This counts failures that happened **with a working connection** (the flush
 * loop does not run while the device is offline), so eight of them means the
 * server is rejecting the write, not that the crew drove through a tunnel.
 * With the backoff below that is about three minutes of actively failing —
 * long enough to ride out a flapping tower, short enough that a genuinely
 * broken op reaches the sync tray while the responder is still on the job.
 */
export const MAX_ATTEMPTS = 8;

/** Exponential with a ceiling, so a long outage does not become a busy loop. */
export function backoffMs(attempts: number): number {
  return Math.min(2 ** attempts * 1000, 60_000);
}

/**
 * Errors that will never succeed on retry, so there is no point burning
 * battery on them: the row is gone, or this user was never allowed to write it.
 * Anything else — timeouts, DNS failures, 5xx, "Network request failed" — is
 * treated as transient, which is the safe default for a queue whose whole
 * purpose is surviving a bad connection.
 */
const PERMANENT_CODES = new Set(['42501', '23503', '23505', 'PGRST301', '22P02']);

export function isPermanent(error: unknown): boolean {
  const e = error as { code?: string; status?: number } | null;
  if (!e) return false;
  if (e.code && PERMANENT_CODES.has(e.code)) return true;
  // 401/403 mean the session is not authorised for this write; 404 means the
  // target is gone. 408/409/429 and every 5xx stay retryable.
  return e.status === 401 || e.status === 403 || e.status === 404;
}

/**
 * Entries from an older build carry no `userId`. Treating those as the current
 * user's preserves the behaviour they were written under; everything written
 * since is matched strictly.
 */
export function isMine(entry: OutboxEntry, userId: string): boolean {
  return entry.userId === undefined || entry.userId === userId;
}
