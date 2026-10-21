import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatTime } from './when.ts';

// 15:00 in Durban on 8 October 2026.
const now = new Date('2026-10-08T13:00:00Z');

test('recent calls in minutes, then the time today, then Yesterday, then the date', () => {
  assert.equal(chatTime('2026-10-08T12:59:40Z', now), 'Just now');
  assert.equal(chatTime('2026-10-08T12:48:00Z', now), '12 min');
  assert.equal(chatTime('2026-10-08T12:00:00Z', now), '14:00', 'earlier today, in SA time');
  assert.equal(chatTime('2026-10-07T20:00:00Z', now), 'Yesterday');
  assert.equal(chatTime('2026-08-05T08:00:00Z', now), '05-08-2026');
  assert.equal(chatTime(null, now), '—');
});

test("the day changes at Durban's midnight, not UTC's", () => {
  // 23:30 UTC on 7 Oct is 01:30 on 8 Oct in Durban: still today at 15:00.
  assert.equal(chatTime('2026-10-07T23:30:00Z', now), '01:30');
  // 21:30 UTC on 7 Oct is 23:30 on the 7th in Durban: yesterday.
  assert.equal(chatTime('2026-10-07T21:30:00Z', now), 'Yesterday');
});

test('a wait in years, months, days, hours and minutes, as the calendar counts', async () => {
  const { waitParts, waitShown } = await import('./when.ts');
  // 06 Apr 2026 10:00 SAST → 20 Oct 2026 22:34 SAST: 6 months, 14 days, 12 h 34 min (not "197 days").
  assert.deepEqual(waitParts('2026-04-06T08:00:00Z', new Date('2026-10-20T20:34:00Z')), { y: 0, mo: 6, d: 14, h: 12, m: 34 });
  // Over a year.
  assert.deepEqual(waitParts('2025-01-15T10:00:00+02:00', new Date('2026-03-16T11:05:00+02:00')), { y: 1, mo: 2, d: 1, h: 1, m: 5 });
  // 31 Jan to 1 Mar: one month (to 28 Feb) and one day.
  assert.deepEqual(waitParts('2026-01-31T09:00:00+02:00', new Date('2026-03-01T09:00:00+02:00')), { y: 0, mo: 1, d: 1, h: 0, m: 0 });
  // Under an hour, and a time in the future.
  assert.deepEqual(waitParts('2026-10-20T10:00:00Z', new Date('2026-10-20T10:07:30Z')), { y: 0, mo: 0, d: 0, h: 0, m: 7 });
  assert.deepEqual(waitParts('2026-10-21T10:00:00Z', new Date('2026-10-20T10:00:00Z')), { y: 0, mo: 0, d: 0, h: 0, m: 0 });
  // The month boundary is Durban's: 31 Mar 23:30 SAST to 1 May 00:10 SAST is one month and 40 minutes.
  assert.deepEqual(waitParts('2026-03-31T21:30:00Z', new Date('2026-04-30T22:10:00Z')), { y: 0, mo: 1, d: 0, h: 0, m: 40 });
  // Shown largest first, no leading zeros, hours and minutes always.
  assert.deepEqual(waitShown({ y: 0, mo: 6, d: 14, h: 12, m: 34 }).map(([, u]) => u), ['mo', 'd', 'h', 'm']);
  assert.deepEqual(waitShown({ y: 0, mo: 0, d: 0, h: 0, m: 7 }).map(([, u]) => u), ['h', 'm']);
  assert.deepEqual(waitShown({ y: 1, mo: 0, d: 3, h: 0, m: 0 }).map(([, u]) => u), ['y', 'mo', 'd', 'h', 'm']);
});
