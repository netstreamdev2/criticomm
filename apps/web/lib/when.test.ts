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
