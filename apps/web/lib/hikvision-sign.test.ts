import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { signedHeaders, stringToSign, toPlatformTime } from './hikvision-sign.ts';

test('the string to sign is the one the vendor’s guide and Postman script build', () => {
  const s = stringToSign('/artemis/api/video/v1/cameras/previewURLs', { key: '24617', nonce: 'n-1', timestamp: '1759658400000' });
  assert.equal(s, [
    'POST', '*/*', 'application/json',
    'x-ca-key:24617', 'x-ca-nonce:n-1', 'x-ca-timestamp:1759658400000',
    '/artemis/api/video/v1/cameras/previewURLs',
  ].join('\n'));
});

test('signed headers carry the key, timestamp, nonce and an HMAC-SHA256 signature', () => {
  const h = signedHeaders({ appKey: '24617', appSecret: 'secret' }, '/artemis/api/resource/v1/cameras', { now: 1759658400000, nonce: 'n-1' });
  const expected = createHmac('sha256', 'secret')
    .update('POST\n*/*\napplication/json\nx-ca-key:24617\nx-ca-nonce:n-1\nx-ca-timestamp:1759658400000\n/artemis/api/resource/v1/cameras')
    .digest('base64');
  assert.equal(h['X-Ca-Signature'], expected);
  assert.equal(h['X-Ca-Signature-Headers'], 'x-ca-key,x-ca-nonce,x-ca-timestamp');
  assert.equal(h['X-Ca-Timestamp'], '1759658400000');
  assert.notEqual(signedHeaders({ appKey: 'k', appSecret: 's' }, '/p')['X-Ca-Nonce'], signedHeaders({ appKey: 'k', appSecret: 's' }, '/p')['X-Ca-Nonce'], 'a fresh nonce each time');
});

test('times go to the platform in South African time with an offset', () => {
  assert.equal(toPlatformTime('2026-10-05T08:00:00Z'), '2026-10-05T10:00:00.000+02:00');
  assert.equal(toPlatformTime('2026-10-05T23:30:00.250Z'), '2026-10-06T01:30:00.250+02:00');
  assert.throws(() => toPlatformTime('yesterday'));
});
