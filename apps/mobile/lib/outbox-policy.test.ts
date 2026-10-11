import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  asUuid, backoffMs, comparePriority, dedupeKeyOf, describe, isMine, isPermanent, leadsOnPhone, MAX_ATTEMPTS, mediaOnPhone,
  newEntryId, statusOnPhone,
  type OutboxEntry, type OutboxOp,
} from './outbox-policy.ts';

/**
 * The outbox is the only thing standing between a responder in a dead zone and
 * a lost record. Every rule below is reachable only when the network is down —
 * the least convenient place to find out it is wrong — so they are pinned here
 * rather than discovered in the field.
 *
 * Run: pnpm test
 */

const entry = (op: OutboxOp, over: Partial<OutboxEntry> = {}): OutboxEntry => ({
  id: Math.random().toString(36).slice(2),
  op,
  occurredAt: '2026-08-04T10:00:00.000Z',
  attempts: 0,
  status: 'queued',
  nextAttemptAt: 0,
  ...over,
});

const PANIC: OutboxOp = {
  kind: 'panic', silo: 'MetroPolice', lat: -29.85, lng: 31.02,
  accuracy: 12, responderName: 'Const. Khumalo',
};
const STATUS: OutboxOp = { kind: 'incident_status', incidentId: 'i1', status: 'On Scene' };
const NOTE: OutboxOp = { kind: 'incident_note', incidentId: 'i1', silo: 'MetroPolice', message: 'Scene secured' };
const PHOTO: OutboxOp = {
  kind: 'evidence', incidentId: 'i1', silo: 'MetroPolice',
  localUri: 'file:///outbox/a.jpg', filename: 'a.jpg',
  mimeType: 'image/jpeg', mediaKind: 'image',
};
const FIX: OutboxOp = { kind: 'duty_location', lat: -29.85, lng: 31.02 };

/* ── Ordering ───────────────────────────────────────────────────────── */

test('a panic is delivered before everything else already queued', () => {
  // The panic is the NEWEST entry — it must still go first. If a brief window
  // of signal only carries one request, it has to carry the emergency.
  const queue = [
    entry(PHOTO, { occurredAt: '2026-08-04T09:00:00.000Z' }),
    entry(NOTE, { occurredAt: '2026-08-04T09:10:00.000Z' }),
    entry(STATUS, { occurredAt: '2026-08-04T09:20:00.000Z' }),
    entry(PANIC, { occurredAt: '2026-08-04T09:59:00.000Z' }),
  ];
  const order = [...queue].sort(comparePriority).map((e) => e.op.kind);
  assert.deepEqual(order, ['panic', 'incident_status', 'incident_note', 'evidence']);
});

test('status changes outrank notes and attachments', () => {
  // Dispatch allocates crews off status. A note or a photo can wait behind it.
  const order = [entry(PHOTO), entry(NOTE), entry(STATUS)]
    .sort(comparePriority)
    .map((e) => e.op.kind);
  assert.deepEqual(order, ['incident_status', 'incident_note', 'evidence']);
});

test('within one kind, the oldest capture is delivered first', () => {
  const older = entry(STATUS, { occurredAt: '2026-08-04T08:00:00.000Z' });
  const newer = entry(STATUS, { occurredAt: '2026-08-04T09:00:00.000Z' });
  assert.deepEqual(
    [newer, older].sort(comparePriority).map((e) => e.occurredAt),
    [older.occurredAt, newer.occurredAt],
  );
});

/* ── Collapsing ─────────────────────────────────────────────────────── */

test('only position fixes collapse; evidential ops never do', () => {
  assert.equal(dedupeKeyOf(FIX), 'duty_location');

  // Each of these is a distinct event with its own evidential value. Collapsing
  // two "On Scene" presses, or two photos, would destroy a record.
  for (const op of [PANIC, STATUS, NOTE, PHOTO]) {
    assert.equal(dedupeKeyOf(op), null, `${op.kind} must never be collapsed`);
  }
});

/* ── Retry policy ───────────────────────────────────────────────────── */

test('network failures are retryable — that is the whole point of the queue', () => {
  assert.equal(isPermanent(new Error('Network request failed')), false);
  assert.equal(isPermanent({ status: 500 }), false);
  assert.equal(isPermanent({ status: 503 }), false);
  assert.equal(isPermanent({ status: 429 }), false);
  assert.equal(isPermanent({ status: 408 }), false);
  assert.equal(isPermanent(null), false);
  assert.equal(isPermanent(undefined), false);
});

test('authorisation and missing-target failures are not retried', () => {
  // Retrying these forever drains a phone battery and buries real failures.
  assert.equal(isPermanent({ code: '42501' }), true, 'RLS denial');
  assert.equal(isPermanent({ code: '23503' }), true, 'foreign key gone');
  assert.equal(isPermanent({ code: 'P0001' }), true, 'server business rule');
  assert.equal(isPermanent({ status: 401 }), true);
  assert.equal(isPermanent({ status: 403 }), true);
  assert.equal(isPermanent({ status: 404 }), true);
});

test('backoff grows but is capped, so a long outage is not a busy loop', () => {
  assert.equal(backoffMs(0), 1000);
  assert.equal(backoffMs(1), 2000);
  assert.equal(backoffMs(5), 32_000);
  assert.equal(backoffMs(6), 60_000, 'capped');
  assert.equal(backoffMs(50), 60_000, 'still capped');

  // These attempts only accrue while the device has a connection, so the
  // budget measures "how long we keep trying against a server that is
  // failing", not "how long we tolerate being offline". Minutes is right:
  // long enough to ride out a flapping tower, short enough that a genuinely
  // broken op reaches the sync tray while the responder is still on the job.
  let total = 0;
  for (let i = 0; i < MAX_ATTEMPTS; i += 1) total += backoffMs(i);
  assert.ok(total > 2 * 60_000, `retry budget ${total}ms is too short`);
  assert.ok(total < 15 * 60_000, `retry budget ${total}ms is too long`);
});

/* ── Ownership ──────────────────────────────────────────────────────── */

test('an op is only ever delivered under the account that captured it', () => {
  // Handsets are shared between shifts. Delivering officer A's status change
  // under officer B's session would attribute A's action to B in a record that
  // is later read as evidence.
  const mine = entry(STATUS, { userId: 'user-a' });
  assert.equal(isMine(mine, 'user-a'), true);
  assert.equal(isMine(mine, 'user-b'), false);
});

test('entries from a build before user-scoping still deliver', () => {
  // Upgrading the app must not strand work already sitting on the phone.
  const legacy = entry(STATUS, { userId: undefined });
  assert.equal(isMine(legacy, 'anyone'), true);
});

/* ── Descriptions ───────────────────────────────────────────────────── */

test('every op kind describes itself for the sync tray', () => {
  // The tray is how a responder answers "did that actually send?". An op with
  // no description would appear as a blank row, which is worse than no row.
  for (const op of [PANIC, STATUS, NOTE, PHOTO, FIX]) {
    const text = describe(op);
    assert.equal(typeof text, 'string');
    assert.ok(text.length > 0, `${op.kind} has no description`);
  }
  assert.match(describe(PANIC), /EMERGENCY/);
  assert.match(describe(STATUS), /On Scene/);
});

const FINE: OutboxOp = {
  kind: 'issue_fine', noticeType: 'AARTO 01', label: 'ND123456 · B Dlamini',
  notice: { notice_type: 'AARTO 01', vehicle_reg: 'ND123456' },
  charges: [{ offence_id: null, description: 'Driver not wearing a seatbelt', amount: 500 }],
};

test('a served fine sends after a live incident, ahead of photos, and is never collapsed', () => {
  const photo = entry(PHOTO, { occurredAt: '2026-08-04T09:00:00.000Z' });
  const fine = entry(FINE, { occurredAt: '2026-08-04T10:00:00.000Z' });
  const status = entry(STATUS, { occurredAt: '2026-08-04T11:00:00.000Z' });
  const order = [photo, fine, status].sort(comparePriority).map((e) => e.op.kind);
  assert.deepEqual(order, ['incident_status', 'issue_fine', 'evidence']);
  assert.equal(dedupeKeyOf(FINE), null);
  assert.equal(describe(FINE), 'Fine · AARTO 01 · ND123456 · B Dlamini');
});

test('a long note is truncated rather than overflowing the tray', () => {
  const long = describe({
    kind: 'incident_note', incidentId: 'i1', silo: 'MetroPolice',
    message: 'x'.repeat(200),
  });
  assert.ok(long.length < 60, `description was ${long.length} chars`);
  assert.match(long, /…$/);
});

test('new entry ids are v4 UUIDs — the server keys idempotency on uuid columns', () => {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  for (let i = 0; i < 50; i++) assert.match(newEntryId(), uuid);
  assert.notEqual(newEntryId(), newEntryId());
});

test('old-style ids map to the same UUID every time; UUIDs pass through', () => {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const legacy = 'lzx3k9-abc12345';
  assert.match(asUuid(legacy), uuid);
  assert.equal(asUuid(legacy), asUuid(legacy));
  assert.notEqual(asUuid(legacy), asUuid('lzx3k9-abc12346'));
  const real = newEntryId();
  assert.equal(asUuid(real), real);
});

/* ── Offline: alerts, duty, leave ───────────────────────────────────── */

test('acknowledgements, duty confirmations and leave queue too, behind a live incident', () => {
  const ack: OutboxOp = { kind: 'alert_read', alertId: 'a1', acknowledged: true, title: 'Assigned: INC-20261011-0004' };
  const duty: OutboxOp = { kind: 'allocation_ack', rosterId: 'r1', label: 'Mon 12 Oct · Day shift' };
  const leave: OutboxOp = {
    kind: 'leave_request', rowId: newEntryId(), silo: 'MetroPolice', from: '2026-10-20', to: '2026-10-22', absence: 'Annual', reason: null,
  };
  assert.equal(describe(ack), 'Alert acknowledged · Assigned: INC-20261011-0004');
  assert.equal(describe({ kind: 'alert_read', alertId: 'a2', acknowledged: false }), 'Alert read');
  assert.equal(describe(duty), 'Duty acknowledged · Mon 12 Oct · Day shift');
  assert.equal(describe(leave), 'Leave · Annual · 2026-10-20 to 2026-10-22');
  for (const op of [ack, duty, leave]) assert.equal(dedupeKeyOf(op), null, `${op.kind} is never collapsed`);
  const later = { occurredAt: '2026-08-04T10:05:00.000Z' };
  const order = [entry(leave, later), entry(duty), entry(ack), entry(STATUS), entry(PHOTO)].sort(comparePriority).map((e) => e.op.kind);
  assert.deepEqual(order, ['incident_status', 'alert_read', 'allocation_ack', 'leave_request', 'evidence']);
});

/* ── A call as this phone knows it ──────────────────────────────────── */

const ME = 'u-me';
const status = (s: string, at: string, incidentId = 'i1') =>
  entry({ kind: 'incident_status', incidentId, status: s }, { occurredAt: at, userId: ME });

test('the status pressed last on the phone counts, before the server has it', () => {
  const pending = [status('On Scene', '2026-10-11T10:20:00Z'), status('En Route', '2026-10-11T10:05:00Z'), status('Arrived', '2026-10-11T10:30:00Z', 'i2')];
  assert.equal(statusOnPhone(pending, 'i1', 'Dispatched'), 'On Scene', 'En Route then On Scene in a dead zone is On Scene');
  assert.equal(statusOnPhone(pending, 'i3', 'Dispatched'), 'Dispatched', 'nothing on the phone: the server\'s');
  assert.equal(statusOnPhone([], 'i1', null), null);
});

test('a call responded to offline is the officer\'s to report on, unless someone else has it', () => {
  const responded = [status('En Route', '2026-10-11T10:05:00Z')];
  assert.equal(leadsOnPhone({ accepted_by: ME }, ME, [], 'i1'), true, 'the server says so');
  assert.equal(leadsOnPhone({ accepted_by: 'u-other' }, ME, responded, 'i1'), false, 'someone else leads it');
  assert.equal(leadsOnPhone({ accepted_by: null }, ME, responded, 'i1'), true, 'responded from this phone, nobody else has it');
  assert.equal(leadsOnPhone({ accepted_by: null, assigned_to: ME }, ME, responded, 'i1'), true);
  assert.equal(leadsOnPhone({ accepted_by: null, assigned_to: 'u-other' }, ME, responded, 'i1'), false, 'sent to someone else: backup at most');
  assert.equal(leadsOnPhone({ accepted_by: null }, ME, [], 'i1'), false, 'not responded at all');
  assert.equal(leadsOnPhone({ accepted_by: null }, ME, responded, 'i2'), false, 'responded to a different call');
  assert.equal(leadsOnPhone({ accepted_by: ME }, undefined, [], 'i1'), false, 'signed out');
});

test('photos and voice notes still on the phone are counted for the report', () => {
  const voice: OutboxOp = { ...PHOTO, mediaKind: 'audio', filename: 'a.m4a', mimeType: 'audio/m4a' } as OutboxOp;
  const elsewhere: OutboxOp = { ...PHOTO, incidentId: 'i9' } as OutboxOp;
  const pending = [entry(PHOTO), entry(PHOTO), entry(voice), entry(elsewhere), entry(NOTE)];
  assert.deepEqual(mediaOnPhone(pending, 'i1'), { photos: 2, voice: 1 });
  assert.deepEqual(mediaOnPhone(pending, 'i5'), { photos: 0, voice: 0 });
});
