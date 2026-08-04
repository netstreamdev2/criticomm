import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import type { OutboxEntry } from './outbox-policy.ts';

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
 * This module owns persistence only. The queue's *rules* — ordering, dedupe,
 * retry policy, ownership — live in `outbox-policy.ts`, which has no imports
 * and is unit-tested; none of them can be exercised through a React Native
 * runtime, and all of them are only reachable through a dead zone.
 */

export * from './outbox-policy.ts';

const KEY = 'criticom.outbox.v1';

/** Attachments are copied here so a cache eviction cannot destroy evidence. */
const OUTBOX_DIR = `${FileSystem.documentDirectory ?? ''}outbox/`;

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
