import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import * as FileSystem from 'expo-file-system';
import {
  addIncidentUpdate, fileFireReport, fileIncidentReport, filePcr, filePostMortem, issueFines, raisePanic, toggleDuty, updateResponderStatus,
  uploadIncidentEvidence,
} from '@criticom/api';
import type { CriticomClient, IncidentStatus } from '@criticom/db';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import {
  asUuid, backoffMs, comparePriority, dedupeKeyOf, describe, isMine, isPermanent, MAX_ATTEMPTS, newEntryId,
  readOutbox, releaseAttachment, writeOutbox,
  type OutboxEntry, type OutboxOp,
} from '@/lib/outbox';

/**
 * Delivery for the outbox.
 *
 * `outbox.ts` decides what is stored; this decides when it goes and what
 * "sending" means for each kind of op. Split that way so the queue's rules can
 * be reasoned about — and tested — without a network or a React tree.
 *
 * Every handler must be safe to run twice. Delivery can be interrupted after
 * the server committed but before we recorded that it had (process killed,
 * battery dies, socket drops between request and response), and the retry that
 * follows is indistinguishable from a first attempt. How each one achieves
 * that is noted at the handler.
 */

/* ── base64 ─────────────────────────────────────────────────────────── */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * React Native has no `Buffer` and no dependable `atob`, and supabase-js will
 * not accept the Blob that `fetch(fileUri)` returns on Android — it uploads
 * zero bytes. Reading the file as base64 and handing over an ArrayBuffer is the
 * one path that works on both platforms, so the decode lives here.
 */
export function decodeBase64(input: string): Uint8Array {
  const clean = input.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes = new Uint8Array((clean.length * 3) >> 2);
  let byte = 0;
  let bits = 0;
  let out = 0;

  for (let i = 0; i < clean.length; i += 1) {
    const value = B64.indexOf(clean[i] as string);
    if (value < 0) continue;
    byte = (byte << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[out++] = (byte >> bits) & 0xff;
    }
  }
  return bytes.subarray(0, out);
}

/* ── Handlers ───────────────────────────────────────────────────────── */

type Handler = (client: CriticomClient, entry: OutboxEntry) => Promise<void>;

const HANDLERS: { [K in OutboxOp['kind']]: Handler } = {
  /**
   * Idempotent because it is a state assignment, not an increment: replaying
   * "On Scene" leaves the incident On Scene. `occurredAt` carries the real
   * time, and the server refuses to move `arrived_timestamp` once set, so a
   * replay cannot rewrite the arrival either.
   */
  incident_status: async (client, entry) => {
    const op = entry.op as Extract<OutboxOp, { kind: 'incident_status' }>;
    await updateResponderStatus(client, {
      incident_id: op.incidentId,
      status: op.status as IncidentStatus,
      occurred_at: entry.occurredAt,
    });
  },

  /**
   * Idempotent on the server: once a report is filed for the call, a replay
   * returns that report instead of filing a second one.
   */
  incident_report: async (client, entry) => {
    const op = entry.op as Extract<OutboxOp, { kind: 'incident_report' }>;
    await fileIncidentReport(client, {
      incidentId: op.incidentId,
      reportType: op.reportType,
      fields: op.fields,
      details: op.details,
    });
  },

  /**
   * Not naturally idempotent — a second insert is a second timeline entry. The
   * outbox id is embedded in a trailing marker so a replay can be detected and
   * skipped. Cheap, and far better than a duplicated note in evidence.
   */
  incident_note: async (client, entry) => {
    const op = entry.op as Extract<OutboxOp, { kind: 'incident_note' }>;
    const marker = `​${entry.id}`;
    const { data: existing } = await client
      .from('incident_updates')
      .select('id')
      .eq('incident_id', op.incidentId)
      .like('message', `%${marker}`)
      .maybeSingle();
    if (existing) return;

    await addIncidentUpdate(client, {
      incident_id: op.incidentId,
      silo: op.silo,
      // The marker is a zero-width space plus the id: invisible in every UI
      // that renders the message, matchable by the query above.
      message: `${op.message}${marker}`,
    });
  },

  /**
   * Idempotent through `idempotencyKey`: the storage path is derived from the
   * outbox id rather than the clock, the upload upserts, and an existing
   * attachment row for that path is returned instead of inserted again.
   */
  evidence: async (client, entry) => {
    const op = entry.op as Extract<OutboxOp, { kind: 'evidence' }>;

    const info = await FileSystem.getInfoAsync(op.localUri);
    if (!info.exists) {
      // The file is gone — cache evicted before we could retain it, or the user
      // cleared app storage. Nothing to upload and nothing retry will fix.
      throw Object.assign(new Error('Attachment file no longer on the device'), { status: 404 });
    }

    const base64 = await FileSystem.readAsStringAsync(op.localUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const bytes = decodeBase64(base64);

    await uploadIncidentEvidence(client, {
      incident_id: op.incidentId,
      silo: op.silo,
      file: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      filename: op.filename,
      kind: op.mediaKind,
      contentType: op.mimeType,
      size: bytes.byteLength,
      caption: op.caption,
      idempotencyKey: entry.id,
    });

    await addIncidentUpdate(client, {
      incident_id: op.incidentId,
      silo: op.silo,
      // A voice note's caption carries its length ("Voice note · 0:42").
      message: `${op.mediaKind === 'audio' ? `🎙️ ${op.caption ?? 'Voice note'}` : '📷 Scene photo'} captured ${
        new Date(entry.occurredAt).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
      } (${op.filename})​${entry.id}`,
    }).catch(() => {
      // The evidence is filed; a missing timeline line is not worth failing the
      // op and re-uploading the whole attachment on the next pass.
    });

    await releaseAttachment(op.localUri);
  },

  /** Idempotent through `client_ref` — see `raise_panic` in migration 0024. */
  panic: async (client, entry) => {
    const op = entry.op as Extract<OutboxOp, { kind: 'panic' }>;
    await raisePanic(client, {
      lat: op.lat,
      lng: op.lng,
      accuracy: op.accuracy,
      note: op.note,
      // Older builds queued non-UUID ids; this maps them to a stable UUID.
      clientRef: asUuid(entry.id),
      occurredAt: entry.occurredAt,
    });
  },

  /**
   * A position write, so replay is harmless. Only ever one queued at a time —
   * `dedupeKeyOf` collapses older fixes into the newest.
   */
  duty_location: async (client, entry) => {
    const op = entry.op as Extract<OutboxOp, { kind: 'duty_location' }>;
    await toggleDuty(client, { onDuty: true, latitude: op.lat, longitude: op.lng });
  },

  /**
   * Idempotent through the client-generated row id: the insert carries it as
   * the primary key, so a replay of a committed insert violates the PK — which
   * is proof it already landed, and is swallowed as success rather than parked.
   * `occurredAt` is written as created_at: the checklist happened at the
   * armoury counter, not when the phone found signal.
   */
  firearm_check: async (client, entry) => {
    const op = entry.op as Extract<OutboxOp, { kind: 'firearm_check' }>;
    const { error } = await client.from('firearm_checklists').insert({
      id: op.rowId,
      kind: op.checkKind,
      serial_number: op.serialNumber,
      make_model: op.makeModel ?? null,
      serial_verified: op.serialVerified,
      barrel_clear: op.barrelClear,
      action_functional: op.actionFunctional,
      safety_functional: op.safetyFunctional,
      sights_secure: op.sightsSecure,
      cleaned: op.cleaned,
      magazines: op.magazines,
      rounds_issued: op.roundsIssued,
      rounds_returned: op.roundsReturned ?? null,
      defects: op.defects ?? null,
      user_name: op.userName,
      created_at: entry.occurredAt,
    });
    if (error && error.code !== '23505') throw error;
  },

  /**
   * Idempotent through the entry id, which issue_fines() (0057) takes as the
   * notice's client reference: replaying a notice that already landed returns
   * the fines on file instead of numbering it twice. The served time is when
   * the officer pressed Issue, not when the phone found signal. A refusal
   * (P0001: an invalid ID number, a missing signature) is permanent and is
   * parked in the sync tray with the reason.
   */
  /**
   * Idempotent on the server: file_fire_report() (0059) returns the report
   * already filed when the incident is closed by an earlier delivery.
   */
  fire_report: async (client, entry) => {
    const op = entry.op as Extract<OutboxOp, { kind: 'fire_report' }>;
    await fileFireReport(client, { incidentId: op.incidentId, fields: op.fields });
  },

  /** Idempotent on the server: file_pcr() (0063) returns the report already filed. */
  pcr: async (client, entry) => {
    const op = entry.op as Extract<OutboxOp, { kind: 'pcr' }>;
    await filePcr(client, { incidentId: op.incidentId, fields: op.fields });
  },

  /** Idempotent on the server: file_post_mortem() (0065) returns the report already filed. */
  post_mortem: async (client, entry) => {
    const op = entry.op as Extract<OutboxOp, { kind: 'post_mortem' }>;
    await filePostMortem(client, { incidentId: op.incidentId, fields: op.fields });
  },

  issue_fine: async (client, entry) => {
    const op = entry.op as Extract<OutboxOp, { kind: 'issue_fine' }>;
    await issueFines(client, {
      notice: op.notice,
      charges: op.charges.map((c) => ({
        offence_id: c.offence_id ?? null, description: c.description, amount: c.amount, code: c.code ?? undefined,
      })),
      clientRef: asUuid(entry.id),
      occurredAt: entry.occurredAt,
    });
  },
};

/* ── Provider ───────────────────────────────────────────────────────── */

type SyncApi = {
  /**
   * Accept a mutation. Persists first, sends after — so an app kill between
   * the two loses nothing, and the caller can update its UI immediately
   * without waiting for a round trip.
   */
  enqueue: (op: OutboxOp, opts?: { occurredAt?: string }) => Promise<string>;
  /** Everything not yet delivered, newest last. */
  pending: OutboxEntry[];
  /** Ops that exhausted their retries and need a human. */
  failed: OutboxEntry[];
  online: boolean;
  syncing: boolean;
  /** Force a delivery pass, and reset failed ops to queued. */
  retryAll: () => Promise<void>;
  /** Give up on one op. Only reachable from the sync tray, with a confirm. */
  discard: (id: string) => Promise<void>;
  describeOp: (op: OutboxOp) => string;
};

const Ctx = createContext<SyncApi | null>(null);

export function useSync(): SyncApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSync must be used inside <SyncProvider>');
  return ctx;
}

/** A v4 UUID: the id is also the server's idempotency key, and those columns are uuid. */
const newId = () => newEntryId();

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // The queue is mirrored into a ref because the flush loop runs outside React's
  // render cycle — reading state there would give it whatever was current when
  // the callback was created, which during a burst of retries is stale.
  const ref = useRef<OutboxEntry[]>([]);
  const flushing = useRef(false);
  // Mirrored for the same reason as the queue: the flush loop runs outside
  // React's render cycle and would otherwise read a stale value.
  const onlineRef = useRef(true);

  const commit = useCallback(async (next: OutboxEntry[]) => {
    ref.current = next;
    setEntries(next);
    await writeOutbox(next);
  }, []);

  // Restore anything left over from a previous run before doing anything else:
  // an app killed mid-shift must come back holding the same queue.
  useEffect(() => {
    void (async () => {
      const stored = await readOutbox();
      ref.current = stored;
      setEntries(stored);
    })();
  }, []);

  /* ── Delivery ─────────────────────────────────────────────────────── */

  const flush = useCallback(async () => {
    if (flushing.current || !session) return;
    if (ref.current.length === 0) return;

    // Do not burn the retry budget on a known-dead connection. Every attempt
    // here counts toward MAX_ATTEMPTS, after which the op is parked as failed
    // and needs a human — and "the crew drove through a tunnel" must never be
    // the reason a scene photo needs manual intervention. `online` starts true
    // and is only set false by an explicit NetInfo verdict, so an unknown
    // state still tries.
    if (!onlineRef.current) return;

    flushing.current = true;
    setSyncing(true);
    try {
      const client = getSupabase();

      // One pass over a priority-ordered snapshot. A pass, rather than a loop
      // until empty: if the connection is flapping we want to yield and let the
      // backoff decide when to come back, not spin.
      const due = [...ref.current]
        .filter((e) => e.status === 'queued'
          && e.nextAttemptAt <= Date.now()
          && isMine(e, session.user.id))
        .sort(comparePriority);

      for (const entry of due) {
        // Re-read: an earlier op in this pass may have removed it (dedupe).
        if (!ref.current.some((e) => e.id === entry.id)) continue;

        try {
          await HANDLERS[entry.op.kind](client, entry);
          await commit(ref.current.filter((e) => e.id !== entry.id));
        } catch (error) {
          const attempts = entry.attempts + 1;
          const permanent = isPermanent(error);
          const exhausted = attempts >= MAX_ATTEMPTS;
          const message = error instanceof Error ? error.message : String(error);

          await commit(ref.current.map((e) => (
            e.id === entry.id
              ? {
                  ...e,
                  attempts,
                  status: permanent || exhausted ? 'failed' : 'queued',
                  lastError: message,
                  nextAttemptAt: Date.now() + backoffMs(attempts),
                }
              : e
          )));

          // A network failure will hit every remaining op the same way. Stop
          // the pass rather than burning all their retry budgets at once.
          if (!permanent) break;
        }
      }
    } finally {
      flushing.current = false;
      setSyncing(false);
    }
  }, [session, commit]);

  const enqueue = useCallback(async (op: OutboxOp, opts?: { occurredAt?: string }) => {
    const id = newId();
    const entry: OutboxEntry = {
      id,
      op,
      userId: session?.user.id,
      occurredAt: opts?.occurredAt ?? new Date().toISOString(),
      attempts: 0,
      status: 'queued',
      nextAttemptAt: 0,
    };

    const key = dedupeKeyOf(op);
    const base = key
      ? ref.current.filter((e) => dedupeKeyOf(e.op) !== key)
      : ref.current;

    await commit([...base, entry]);
    void flush();
    return id;
  }, [commit, flush, session]);

  const retryAll = useCallback(async () => {
    const userId = session?.user.id;
    await commit(ref.current.map((e) => (
      userId && !isMine(e, userId)
        ? e
        : { ...e, status: 'queued' as const, attempts: 0, nextAttemptAt: 0 }
    )));
    await flush();
  }, [commit, flush, session]);

  const discard = useCallback(async (id: string) => {
    const entry = ref.current.find((e) => e.id === id);
    if (entry?.op.kind === 'evidence') await releaseAttachment(entry.op.localUri);
    await commit(ref.current.filter((e) => e.id !== id));
  }, [commit]);

  /* ── Triggers ─────────────────────────────────────────────────────── */

  // Connectivity. `isInternetReachable` rather than `isConnected`: a phone
  // attached to a captive portal or a tower with no backhaul reports connected
  // and delivers nothing, which is exactly the case the outbox exists for.
  useEffect(() => {
    const off = NetInfo.addEventListener((state) => {
      // `isInternetReachable` is null until NetInfo has probed. Treating
      // "unknown" as online means we try and let the request decide, rather
      // than sitting on a queue because a probe has not finished.
      const reachable = state.isInternetReachable ?? state.isConnected ?? true;
      onlineRef.current = reachable;
      setOnline(reachable);
      if (reachable) void flush();
    });
    return off;
  }, [flush]);

  // Coming back to the app is the other moment worth retrying on: the phone may
  // have regained signal while backgrounded, where our listener was throttled.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void flush();
    });
    return () => sub.remove();
  }, [flush]);

  // Backoff timer. Cheap enough to run always, and it is what actually retries
  // a queue that failed while the phone stayed nominally online.
  useEffect(() => {
    const timer = setInterval(() => { void flush(); }, 15_000);
    return () => clearInterval(timer);
  }, [flush]);

  // A queue restored on launch, or one waiting for a sign-in, goes as soon as
  // there is a session to send it under.
  useEffect(() => { if (session) void flush(); }, [session, flush]);

  const api = useMemo<SyncApi>(() => {
    // Only ever surface the signed-in user's own work. Another shift's queue
    // still exists on the handset and still delivers when they sign back in,
    // but it is not this person's to see, retry or discard.
    const userId = session?.user.id;
    const mine = userId ? entries.filter((e) => isMine(e, userId)) : [];
    return {
      enqueue,
      pending: mine.filter((e) => e.status === 'queued'),
      failed: mine.filter((e) => e.status === 'failed'),
      online,
      syncing,
      retryAll,
      discard,
      describeOp: describe,
    };
  }, [enqueue, entries, online, syncing, retryAll, discard, session]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
