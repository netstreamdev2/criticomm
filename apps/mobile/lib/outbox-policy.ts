import type { Silo } from '@criticom/db/types';
import { english, type Translate } from '@criticom/db/i18n';
import { wordsIn } from './department.ts';

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
      /** Why they marked on scene by hand, when the phone had not put them there (0099). */
      reason?: string;
      /** Responding: where the scene is, so the phone can tell when it gets there with no signal. */
      scene?: { lat: number; lng: number };
      /** On scene worked out by the phone: the fix that put it there, sent first so the server checks it. */
      fix?: { t: string; lat: number; lng: number; acc: number | null; spd: number | null; hdg: number | null; mock?: true };
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
      /** The police case report that closes the call (migration 0039). */
      kind: 'incident_report';
      incidentId: string;
      incidentNumber: string;
      reportType: string;
      fields: Record<string, string>;
      details: Record<string, string>;
    }
  | {
      /** The fire report that closes a Fire incident (migration 0059). */
      kind: 'fire_report';
      incidentId: string;
      incidentNumber: string;
      fields: Record<string, string>;
    }
  | {
      /** The patient care report that closes an EMS call (migration 0063). */
      kind: 'pcr';
      incidentId: string;
      incidentNumber: string;
      fields: Record<string, string>;
    }
  | {
      /** The post-mortem that closes a Disaster incident (migration 0065). */
      kind: 'post_mortem';
      incidentId: string;
      incidentNumber: string;
      fields: Record<string, string>;
    }
  | {
      /**
       * Disaster Management's assessment of one place on a call-out (0107).
       * The entry id is the server's client reference: a resend never files it twice.
       */
      kind: 'disaster_assessment';
      incidentId: string;
      incidentNumber: string;
      place: string;
      fields: Record<string, unknown>;
    }
  | {
      /**
       * A fire safety site inspection (0106). The entry id is the server's
       * client reference: a resend never files it twice.
       */
      kind: 'fire_inspection';
      fields: Record<string, unknown>;
      /** The business or site, for the sync tray. */
      label: string;
    }
  | {
      /** The lead closes their department's part after its report (migration 0074). */
      kind: 'close_part';
      incidentId: string;
      incidentNumber: string;
      /** How the call ended (0098); absent from closes queued before it. */
      disposition?: string;
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
    }
  | {
      kind: 'firearm_check';
      /** Client-generated row uuid — the primary key on replay, so a retry
       *  that raced a committed insert dedupes instead of double-filing. */
      rowId: string;
      checkKind: 'Issue' | 'Return' | 'Inspection';
      serialNumber: string;
      makeModel?: string;
      serialVerified: boolean;
      barrelClear: boolean;
      actionFunctional: boolean;
      safetyFunctional: boolean;
      sightsSecure: boolean;
      cleaned: boolean;
      magazines: number;
      roundsIssued: number;
      roundsReturned?: number;
      defects?: string;
      userName: string;
    }
  | {
      /**
       * A notice served at the roadside (migration 0057): one to three
       * charges. The entry id is the server's client reference, so a retry
       * never files the notice twice.
       */
      kind: 'issue_fine';
      notice: Record<string, unknown>;
      /** Description, amount and code ride along for the provisional slip;
       *  the server takes them from the charge book when it has them. */
      charges: Array<{
        offence_id?: string | null;
        description: string;
        amount: number | null;
        code?: string | null;
        legal_ref?: string | null;
        demerit?: number;
      }>;
      noticeType: 'AARTO 01' | 'Section 56' | 'Section 341';
      /** "ND123456 · B Dlamini" — for the sync tray. */
      label: string;
    }
  | {
      /** An alert read, or acknowledged, with no signal. */
      kind: 'alert_read';
      alertId: string;
      acknowledged: boolean;
      /** The alert's title, for the sync tray. */
      title?: string;
    }
  | {
      /** A duty on the roster acknowledged (0021). */
      kind: 'allocation_ack';
      rosterId: string;
      /** "Mon 12 Oct · Day shift", for the sync tray. */
      label?: string;
    }
  | {
      /** A leave request. The row id is chosen on the phone, so a resend never files it twice. */
      kind: 'leave_request';
      rowId: string;
      silo: Silo;
      from: string;
      to: string;
      absence: string;
      reason: string | null;
    }
  | {
      /** Cancel your own leave before it starts (0072). */
      kind: 'leave_cancel';
      leaveId: string;
      /** "Annual · 20 Oct to 22 Oct", for the sync tray. */
      label: string;
    }
  | {
      /** Offer one of your shifts for a colleague's (0072). The entry id is the swap's id. */
      kind: 'swap_request';
      myLine: string;
      theirLine: string;
      note: string | null;
      label: string;
    }
  | {
      /** Accept or decline a swap offered to you. */
      kind: 'swap_respond';
      swapId: string;
      accept: boolean;
      label: string;
    }
  | {
      kind: 'swap_withdraw';
      swapId: string;
      label: string;
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

export function describe(op: OutboxOp, t: Translate = english.t): string {
  const tail = (s: string | null | undefined) => (s ? ` · ${s}` : '');
  switch (op.kind) {
    case 'incident_status':
      return `${t('Status → {status}', { status: t(op.status) })}${tail(op.incidentNumber)}`;
    case 'incident_note':
      return `${t('Update')} · ${op.message.slice(0, 40)}${op.message.length > 40 ? '…' : ''}`;
    case 'evidence':
      return `${op.mediaKind === 'audio' ? t('Voice note') : t('Photo')} · ${op.filename}`;
    case 'incident_report':
      return `${t('Incident report')} · ${op.incidentNumber}`;
    case 'fire_report':
      return `${t('Fire report')} · ${op.incidentNumber}`;
    case 'pcr':
      return `${t('Patient report')} · ${op.incidentNumber}`;
    case 'post_mortem':
      return `${t('Post-mortem')} · ${op.incidentNumber}`;
    case 'disaster_assessment':
      return `${t('Assessment')} · ${op.place} · ${op.incidentNumber}`;
    case 'fire_inspection':
      return `${t('Site inspection')} · ${op.label}`;
    case 'close_part':
      return `${t('Close')} · ${op.incidentNumber}`;
    case 'panic':
      return t('EMERGENCY — {person} needs assistance', { person: wordsIn(op.silo, t).person });
    case 'duty_location':
      return t('Position update');
    case 'firearm_check':
      return `${op.checkKind === 'Issue' ? t('Firearm issue') : op.checkKind === 'Return' ? t('Firearm return') : t('Firearm inspection')} · ${op.serialNumber}`;
    case 'issue_fine':
      return `${t('Fine')} · ${op.noticeType} · ${op.label}`;
    case 'alert_read':
      return `${op.acknowledged ? t('Alert acknowledged') : t('Alert read')}${tail(op.title?.slice(0, 40))}`;
    case 'allocation_ack':
      return `${t('Duty acknowledged')}${tail(op.label)}`;
    case 'leave_request':
      return `${t('Leave')} · ${t(op.absence)} · ${t('{from} to {to}', { from: op.from, to: op.to })}`;
    case 'leave_cancel':
      return `${t('Cancel leave')} · ${op.label}`;
    case 'swap_request':
      return `${t('Swap asked')} · ${op.label}`;
    case 'swap_respond':
      return `${op.accept ? t('Swap accepted') : t('Swap declined')} · ${op.label}`;
    case 'swap_withdraw':
      return `${t('Swap withdrawn')} · ${op.label}`;
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
  // After the status it depends on (the server wants the officer On Scene),
  // ahead of photos: the report is what tells command the call is closed.
  incident_report: 2,
  fire_report: 2,
  pcr: 2,
  post_mortem: 2,
  // What the JOC and relief work from: with the reports.
  disaster_assessment: 2,
  duty_location: 2,
  // After the report it closes (the server wants it filed first).
  close_part: 3,
  incident_note: 3,
  // Armoury paperwork matters, but never ahead of anything an active incident
  // is waiting on — only the attachments queue behind it.
  firearm_check: 4,
  // A served notice is paperwork too: after anything a live incident is
  // waiting on, ahead of photos.
  issue_fine: 4,
  fire_inspection: 4,
  // Small, and nothing a live incident waits on.
  alert_read: 3,
  allocation_ack: 4,
  leave_request: 4,
  leave_cancel: 4,
  swap_request: 4,
  swap_respond: 4,
  swap_withdraw: 4,
  evidence: 5,
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
// P0001 is a business rule the server raised on purpose ("file the report on
// INC-… first", "10 photos is the maximum") — the same request will be refused
// again, so it is surfaced to the officer instead of retried.
// 22023 (a value the server refuses, e.g. "say why") and P0002 (not found)
// are the schedule functions' refusals (0072).
const PERMANENT_CODES = new Set(['42501', '23503', '23505', 'PGRST301', '22P02', 'P0001', 'P0002', '22023']);

export function isPermanent(error: unknown): boolean {
  const e = error as { code?: string; status?: number } | null;
  if (!e) return false;
  if (e.code && PERMANENT_CODES.has(e.code)) return true;
  // 401/403 mean the session is not authorised for this write; 404 means the
  // target is gone. 408/409/429 and every 5xx stay retryable.
  return e.status === 401 || e.status === 403 || e.status === 404;
}

/**
 * The reason a delivery failed, in words. The database's refusals arrive as
 * plain objects ({ message, code, … }), not Errors, so String() gave the crew
 * "[object Object]" in the sync tray instead of what to do about it.
 */
export function errorText(error: unknown): string {
  if (typeof error === 'string') return error || 'Unknown error';
  const e = error as { message?: unknown; hint?: unknown } | null;
  const message = e && typeof e.message === 'string' ? e.message.trim() : '';
  const hint = e && typeof e.hint === 'string' ? e.hint.trim() : '';
  if (message) return hint ? `${message} ${hint}` : message;
  return 'Unknown error';
}

/**
 * Entries from an older build carry no `userId`. Treating those as the current
 * user's preserves the behaviour they were written under; everything written
 * since is matched strictly.
 */
export function isMine(entry: OutboxEntry, userId: string): boolean {
  return entry.userId === undefined || entry.userId === userId;
}

/* ── A call as this phone knows it ─────────────────────────────────────── */
// What the officer did on the phone counts before the server has heard of
// it, so a report can be written and filed in a dead zone: the call they
// responded to offline is theirs, the On Scene they pressed stands, and the
// photos still waiting to send are counted.

/** The officer's status on a call: the latest one waiting on this phone, else the server's. */
export function statusOnPhone(pending: readonly OutboxEntry[], incidentId: string, serverStatus: string | null | undefined) {
  let latest: OutboxEntry | null = null;
  for (const e of pending) {
    if (e.op.kind !== 'incident_status' || e.op.incidentId !== incidentId) continue;
    if (!latest || e.occurredAt >= latest.occurredAt) latest = e;
  }
  return latest?.op.kind === 'incident_status' ? latest.op.status : (serverStatus ?? null);
}

/**
 * Whether this officer leads the call: the server says so, or nobody has it
 * yet (and it was not sent to someone else) and they responded from this phone. If someone else got there first,
 * the server refuses the report and it shows in the sync tray.
 */
export function leadsOnPhone(
  incident: { accepted_by: string | null; assigned_to?: string | null },
  userId: string | undefined,
  pending: readonly OutboxEntry[],
  incidentId: string,
): boolean {
  if (!userId) return false;
  if (incident.accepted_by) return incident.accepted_by === userId;
  // As the server rules (callView): a call sent to someone else is theirs to lead.
  if (incident.assigned_to && incident.assigned_to !== userId) return false;
  return pending.some((e) => e.op.kind === 'incident_status' && e.op.incidentId === incidentId && isMine(e, userId));
}

/** Photos and voice notes for a call taken on this phone and still waiting to send. */
export function mediaOnPhone(pending: readonly OutboxEntry[], incidentId: string) {
  let photos = 0;
  let voice = 0;
  for (const e of pending) {
    if (e.op.kind !== 'evidence' || e.op.incidentId !== incidentId) continue;
    if (e.op.mediaKind === 'audio') voice++;
    else if (e.op.mediaKind === 'image') photos++;
  }
  return { photos, voice };
}

/* ── Entry ids ──────────────────────────────────────────────────────────── */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A random v4 UUID for a new outbox entry. The id doubles as the server's
 * idempotency key (incidents.client_ref, firearm_checklists.id), and those
 * columns are uuid — an id in any other shape is rejected outright (22P02),
 * which the queue treats as permanent: the op would never be delivered.
 */
export function newEntryId(random: () => number = Math.random): string {
  const hex = Array.from({ length: 32 }, () => Math.floor(random() * 16).toString(16));
  hex[12] = '4';
  hex[16] = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * The entry's id as a UUID. Entries queued by older builds have ids like
 * "lzx3k-abc12345"; they map to the same UUID on every attempt, so delivery
 * stays idempotent and an SOS stuck on a phone can still go through.
 */
export function asUuid(id: string): string {
  if (UUID_RE.test(id)) return id.toLowerCase();
  // Four 32-bit FNV-1a passes with different seeds → 128 deterministic bits.
  const words = [0x811c9dc5, 0x01000193, 0xdeadbeef, 0x12345678].map((seed) => {
    let h = seed >>> 0;
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  });
  const hex = words.join('').split('');
  hex[12] = '4';
  hex[16] = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
