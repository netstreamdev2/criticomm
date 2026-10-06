/**
 * Bodycams (migration 0054): why a bodycam may be opened, how long a live
 * feed runs before it asks whether anyone is still watching, and which
 * stretch of footage to offer. The console checks these before it asks; the
 * database checks every view again and has the final word.
 */

import type { BodycamStatus, BodycamViewReason } from './types.generated';

export const BODYCAM_STATUSES: readonly BodycamStatus[] = ['Available', 'Booked out', 'In repair', 'Lost', 'Retired'];

/** The reasons offered when a bodycam is opened without an incident. */
export const BODYCAM_VIEW_REASONS: ReadonlyArray<{ code: Exclude<BodycamViewReason, 'incident'>; label: string }> = [
  { code: 'officer_safety', label: 'Officer safety check' },
  { code: 'sos', label: 'SOS or officer in distress' },
  { code: 'supervision', label: 'Supervising work in progress' },
  { code: 'investigation', label: 'Investigation or evidence review' },
  { code: 'other', label: 'Other (say why)' },
];

export function bodycamReasonLabel(code: BodycamViewReason): string {
  if (code === 'incident') return 'Incident';
  return BODYCAM_VIEW_REASONS.find((r) => r.code === code)?.label ?? code;
}

/** What is missing before a view may open, or null. Mirrors start_bodycam_view(). */
export function viewReasonError(input: {
  incidentId?: string | null;
  reason?: BodycamViewReason | null;
  note?: string | null;
}): string | null {
  const note = (input.note ?? '').trim();
  if (note.length > 300) return 'Keep the reason under 300 characters.';
  if (input.incidentId) return null;
  if (!input.reason) return 'Say why you are opening this bodycam.';
  if (input.reason === 'incident') return 'Choose the incident this is for.';
  if (input.reason === 'other' && note.length < 5) return 'Say why in a few words.';
  return null;
}

// ── Live feeds ──────────────────────────────────────────────────────────

/** Live feeds one person may have open at once; the database refuses a fifth. */
export const MAX_LIVE_FEEDS = 4;
/** How often the viewer's screen confirms a view is still open. */
export const VIEW_HEARTBEAT_MS = 30_000;
/** After this long a live feed asks "Still watching?"… */
export const STILL_WATCHING_AFTER_MS = 10 * 60_000;
/** …and stops if nobody answers within this. */
export const STILL_WATCHING_GRACE_MS = 60_000;

/** Where a live feed is, counted from when it started or was last confirmed. */
export function liveFeedState(since: number, now: number): 'watching' | 'asking' | 'expired' {
  const age = now - since;
  if (age < STILL_WATCHING_AFTER_MS) return 'watching';
  if (age < STILL_WATCHING_AFTER_MS + STILL_WATCHING_GRACE_MS) return 'asking';
  return 'expired';
}

/** Whole seconds left to answer "Still watching?" (0 once it has stopped). */
export function secondsToAnswer(since: number, now: number): number {
  const left = since + STILL_WATCHING_AFTER_MS + STILL_WATCHING_GRACE_MS - now;
  return Math.max(0, Math.ceil(left / 1000));
}

// ── Footage ─────────────────────────────────────────────────────────────

export const FOOTAGE_WINDOW_MAX_HOURS = 24;
const MAX_WINDOW_MS = FOOTAGE_WINDOW_MAX_HOURS * 3_600_000;

/** Why a footage window will be refused, or null. Mirrors start_bodycam_view(). */
export function footageWindowError(from: Date, to: Date, now = new Date()): string | null {
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
    return 'Choose when the footage starts and ends.';
  }
  if (to.getTime() - from.getTime() > MAX_WINDOW_MS) return `Footage windows are capped at ${FOOTAGE_WINDOW_MAX_HOURS} hours.`;
  if (from > now) return 'That window has not happened yet.';
  return null;
}

/**
 * The window to offer for something that started at `start` and ended at
 * `end` (still going: now): a booking, or an incident. Longer than a day is
 * cut to its first 24 hours, and says so.
 */
export function windowFor(start: string, end: string | null, now = new Date()): { from: string; to: string; capped: boolean } {
  const from = new Date(start);
  const finish = end ? new Date(end) : now;
  const to = new Date(Math.min(finish.getTime(), from.getTime() + MAX_WINDOW_MS));
  return { from: from.toISOString(), to: to.toISOString(), capped: to.getTime() < finish.getTime() };
}

/** Whether a booking covers any part of a window. */
export function bookingOverlaps(
  booking: { booked_at: string; returned_at: string | null },
  from: string,
  to: string,
  now = new Date(),
): boolean {
  const end = booking.returned_at ? new Date(booking.returned_at) : now;
  return new Date(booking.booked_at) < new Date(to) && end > new Date(from);
}
