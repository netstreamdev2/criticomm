import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cacheKey, cacheRule, errorWords, evictions, hashKey, isNetworkFailure, MAX_AGE_MS, saDay, servable,
} from './offline-cache-policy.ts';

const REST = 'https://abc.supabase.co/rest/v1';

test('only reads are kept: table reads and the RPCs that only read', () => {
  assert.deepEqual(cacheRule('GET', `${REST}/incidents?select=*&id=eq.1`), { rpc: null });
  assert.deepEqual(cacheRule('HEAD', `${REST}/personnel?select=id`), { rpc: null });
  assert.deepEqual(cacheRule('POST', `${REST}/rpc/has_completed_shift_start_today`), { rpc: 'has_completed_shift_start_today' });
  assert.equal(cacheRule('POST', `${REST}/incidents`), null, 'an insert is never answered from the phone');
  assert.equal(cacheRule('PATCH', `${REST}/incidents?id=eq.1`), null);
  assert.equal(cacheRule('DELETE', `${REST}/incidents?id=eq.1`), null);
  assert.equal(cacheRule('POST', `${REST}/rpc/toggle_duty`), null, 'an RPC that changes something is never answered from the phone');
  assert.equal(cacheRule('POST', `${REST}/rpc/raise_panic`), null);
  assert.equal(cacheRule('POST', `${REST}/rpc/record_track`), null);
  assert.equal(cacheRule('GET', 'https://abc.supabase.co/auth/v1/user'), null, 'sign-in is not a database read');
  assert.equal(cacheRule('GET', 'https://abc.supabase.co/storage/v1/object/public/x.jpg'), null);
});

test('a kept answer is filed per person and per exact question', () => {
  const base = { owner: 'u1', method: 'GET', url: `${REST}/incidents?select=*&id=eq.1`, accept: 'application/json' };
  assert.equal(cacheKey(base).key, cacheKey({ ...base }).key);
  assert.notEqual(cacheKey(base).key, cacheKey({ ...base, owner: 'u2' }).key, 'one crew member never sees another\'s');
  assert.notEqual(cacheKey(base).key, cacheKey({ ...base, accept: 'application/vnd.pgrst.object+json' }).key, '.single() is a different answer');
  assert.notEqual(cacheKey(base).key, cacheKey({ ...base, prefer: 'count=exact' }).key);
  assert.notEqual(cacheKey(base).key, cacheKey({ ...base, url: `${REST}/incidents?select=*&id=eq.2` }).key);
  assert.notEqual(
    cacheKey({ owner: 'u1', method: 'POST', url: `${REST}/rpc/search_everything`, body: '{"q":"a"}' }).key,
    cacheKey({ owner: 'u1', method: 'POST', url: `${REST}/rpc/search_everything`, body: '{"q":"b"}' }).key,
  );
  assert.equal(cacheKey(base).dated, false);
});

test('clock times in a question are folded, and such answers are dated', () => {
  const at = (iso: string) => cacheKey({ owner: 'u1', method: 'GET', url: `${REST}/incidents?assigned_at=gte.${encodeURIComponent(iso)}` });
  const a = at('2026-10-11T08:00:00.000Z');
  const b = at('2026-10-11T08:01:30.123Z');
  assert.equal(a.key, b.key, 'the same screen asked a minute later finds its answer');
  assert.equal(a.dated, true);
  const plainDate = cacheKey({ owner: 'u1', method: 'GET', url: `${REST}/rosters?duty_date=gte.2026-10-11` });
  assert.equal(plainDate.dated, false, 'a calendar date is part of the question, not a clock time');
});

test('how long a kept answer may stand in for the server', () => {
  const now = Date.parse('2026-10-11T12:00:00Z'); // 14:00 in South Africa
  const meta = (savedAt: number, extra: Partial<{ dated: boolean; rpc: string | null }> = {}) => ({ savedAt, dated: false, rpc: null, ...extra });
  assert.equal(servable(meta(now - 60_000), now), true);
  assert.equal(servable(meta(now - MAX_AGE_MS + 1000), now), true, 'up to two shifts old');
  assert.equal(servable(meta(now - MAX_AGE_MS - 1000), now), false);
  assert.equal(servable(meta(now + 10 * 60_000), now), false, 'a clock that jumped back is not trusted');

  // "Today" answers only on the South African day they were saved.
  const earlierToday = Date.parse('2026-10-10T22:30:00Z'); // 00:30 on the 11th in SA
  const lastNight = Date.parse('2026-10-10T21:30:00Z'); // 23:30 on the 10th in SA
  assert.equal(servable(meta(earlierToday, { rpc: 'has_completed_shift_start_today' }), now), true);
  assert.equal(servable(meta(lastNight, { rpc: 'has_completed_shift_start_today' }), now), false, 'yesterday\'s start of shift does not open today');
  assert.equal(servable(meta(lastNight, { dated: true }), now), false);
  assert.equal(servable(meta(lastNight), now), true, 'an undated answer from last night still shows');
  assert.equal(saDay(Date.parse('2026-10-10T22:00:00Z')), '2026-10-11');
  assert.equal(saDay(Date.parse('2026-10-10T21:59:59Z')), '2026-10-10');
});

test('the oldest answers go first when the phone holds too many', () => {
  const now = 10_000_000_000;
  const rows = [
    { hash: 'new', savedAt: now - 1000, size: 10 },
    { hash: 'mid', savedAt: now - 2000, size: 10 },
    { hash: 'old', savedAt: now - 3000, size: 10 },
    { hash: 'ancient', savedAt: now - MAX_AGE_MS - 1, size: 1 },
  ];
  assert.deepEqual(evictions(rows, now).sort(), ['ancient']);
  assert.deepEqual(evictions(rows, now, { maxEntries: 2, maxBytes: 1e9, maxAge: MAX_AGE_MS }).sort(), ['ancient', 'old']);
  assert.deepEqual(evictions(rows, now, { maxEntries: 99, maxBytes: 15, maxAge: MAX_AGE_MS }).sort(), ['ancient', 'mid', 'old']);
});

test('file names are stable and spread out', () => {
  assert.equal(hashKey('abc'), hashKey('abc'));
  assert.notEqual(hashKey('abc'), hashKey('abd'));
  assert.match(hashKey('anything'), /^[0-9a-f]{14}$/);
  const seen = new Set(Array.from({ length: 5000 }, (_, i) => hashKey(`u1\nGET\n${REST}/incidents?id=eq.${i}`)));
  assert.equal(seen.size, 5000);
});

test('"no connection" is told apart from the server saying no', () => {
  assert.equal(isNetworkFailure(new TypeError('Network request failed')), true);
  assert.equal(isNetworkFailure({ message: 'TypeError: Network request failed', code: '' }), true, 'as supabase-js reports it');
  assert.equal(isNetworkFailure({ name: 'AbortError', message: 'Aborted' }), true);
  assert.equal(isNetworkFailure({ name: 'AuthRetryableFetchError', message: 'Failed to fetch' }), true);
  assert.equal(isNetworkFailure({ message: 'Complete today\'s readiness first', code: 'P0001' }), false);
  assert.equal(isNetworkFailure({ message: 'new row violates row-level security policy', code: '42501' }), false);
  assert.equal(isNetworkFailure(null), false);
  assert.equal(errorWords(new TypeError('Network request failed')), 'No connection. Try again when you have signal.');
  assert.equal(errorWords({ message: 'Choose a vehicle first' }), 'Choose a vehicle first');
  assert.equal(errorWords({}, 'Try again'), 'Try again');
});
