import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import type { Silo } from '@criticom/db/types';

/**
 * The outbox — durable storage for work the phone has accepted but not yet
 * delivered.
 *
 * Coverage in the field is not a solved problem. Basements, lift shafts, the
 * industrial south, half of the N3 corridor at peak: a responder marks himself
 * On Scene and the request goes nowhere. The pre-outbox behaviour was to show
 * an error and drop it, which pushes the recovery onto the one person who has
 * least attention to spare, and loses the timestamp that the whole incident
 * record is later reconstructed from.
 *
 * So every field mutation is written here first and delivered afterwards. The
 * consequences that follow from that choice:
 *
 *   • **The recorded time is when the responder acted**, not when the network
 *     came back. Ops carry their own `occurredAt`, and handlers send it. An
 *     arrival time that drifts by the length of a dead zone is evidence that
 *     misleads an inquiry.
 *   • **Nothing is dropped silently.** An op that exhausts its retries is
 *     parked as `failed` and stays visible in the sync tray until a human
 *     resolves it. A photo of a scene cannot be re-taken an hour later.
 *   • **Replay must be safe.** Delivery can be interrupted after the server
 *     committed but before we recorded that, so every handler is written to
 *     tolerate running twice (see `sync.tsx`).
 *
 * This module owns persistence only — no network, no React. That keeps it
 * testable and means a corrupt queue can be inspected and repaired without
 * booting the app's provider tree.
 */

const KEY = 'criticom.outbox.v1';

/** Attachments are copied here so a cache eviction cannot destroy evidence. */
const OUTBOX_DIR = `${FileSystem.documentDirectory ?? ''}outbox/`;

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
      /** File inside OUTBOX_DIR — owned by us, deleted after delivery. */
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

/* ── Persistence ────────────────────────────────────────────────────── */

export async function readOutbox(): Promise<OutboxEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Tolerate entries written by an older build: anything unrecognisable is
    // skipped rather than throwing, which would strand the whole queue.
    return parsed.filter(
      (e): e is OutboxEntry =>
        Boolean(e) && typeof e === 'object'
        && typeof (e as OutboxEntry).id === 'string'
        && Boolean((e as OutboxEntry).op),
    );
  } catch {
    return [];
  }
}

export async function writeOutbox(entries: OutboxEntry[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(entries));
  } catch (e) {
    // Storage full, most likely. Nothing useful to do beyond surfacing it —
    // the in-memory queue still delivers for this session.
    console.warn('[criticom] could not persist outbox', e);
  }
}

/* ── Attachments ────────────────────────────────────────────────────── */

/**
 * Copy a picked or recorded file into storage we control.
 *
 * Both the image picker and the audio recorder hand back a URI in the OS cache,
 * which Android reclaims under memory pressure with no warning. A photo of a
 * scene that has since been cleared cannot be retaken, so the file is copied
 * out of the cache before the op is queued. Returns the original URI if the
 * copy fails — a possibly-evictable file still beats no evidence.
 */
export async function retainAttachment(uri: string, filename: string): Promise<string> {
  try {
    const dir = await FileSystem.getInfoAsync(OUTBOX_DIR);
    if (!dir.exists) await FileSystem.makeDirectoryAsync(OUTBOX_DIR, { intermediates: true });
    const target = `${OUTBOX_DIR}${Date.now()}-${filename.replace(/[^\w.\-]/g, '_')}`;
    await FileSystem.copyAsync({ from: uri, to: target });
    return target;
  } catch (e) {
    console.warn('[criticom] could not retain attachment, using original uri', e);
    return uri;
  }
}

/** Delete a retained attachment once it is safely on the server. */
export async function releaseAttachment(uri: string): Promise<void> {
  if (!uri.startsWith(OUTBOX_DIR)) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch { /* a leftover file is harmless */ }
}

/* ── Backoff ────────────────────────────────────────────────────────── */

/**
 * Give up on *automatic* retries after this many attempts. The op is not
 * deleted — it moves to `failed` and waits for a human. With the schedule
 * below that is roughly ten minutes of trying.
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
