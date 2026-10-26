import assert from 'node:assert/strict';
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { hmacSha256, pbkdf2Sha256, sameHex, sha256, toHex, utf8 } from './pin-crypto.ts';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

test('SHA-256 matches the standard vectors', () => {
  assert.equal(toHex(sha256(utf8(''))), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(toHex(sha256(utf8('abc'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(toHex(sha256(utf8('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
});

test('SHA-256 matches Node for every length around the block edges, and random data', () => {
  for (let n = 0; n <= 200; n++) {
    const data = randomBytes(n);
    assert.equal(hex(sha256(data)), createHash('sha256').update(data).digest('hex'), `length ${n}`);
  }
  for (let i = 0; i < 50; i++) {
    const data = randomBytes(1 + Math.floor(Math.random() * 5000));
    assert.equal(hex(sha256(data)), createHash('sha256').update(data).digest('hex'));
  }
});

test('HMAC-SHA-256 matches Node, for short, block-sized and long keys', () => {
  for (const keyLength of [0, 1, 6, 32, 63, 64, 65, 200]) {
    for (let i = 0; i < 10; i++) {
      const key = randomBytes(keyLength);
      const data = randomBytes(Math.floor(Math.random() * 300));
      assert.equal(hex(hmacSha256(key, data)), createHmac('sha256', key).update(data).digest('hex'), `key ${keyLength}`);
    }
  }
  // RFC 4231 test case 2.
  assert.equal(toHex(hmacSha256(utf8('Jefe'), utf8('what do ya want for nothing?'))),
    '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
});

test('PBKDF2-HMAC-SHA-256 matches Node', () => {
  for (const iterations of [1, 2, 3, 100, 1000]) {
    const pin = utf8(String(Math.floor(Math.random() * 1e6)).padStart(6, '0'));
    const salt = randomBytes(16 + Math.floor(Math.random() * 40));
    assert.equal(hex(pbkdf2Sha256(pin, salt, iterations)), pbkdf2Sync(pin, salt, iterations, 32, 'sha256').toString('hex'), `${iterations} rounds`);
  }
  assert.equal(hex(pbkdf2Sha256(utf8('482139'), utf8('salt-and-officer'), 10_000)),
    pbkdf2Sync('482139', 'salt-and-officer', 10_000, 32, 'sha256').toString('hex'));
});

test('UTF-8 and the hex comparison', () => {
  assert.equal(hex(utf8('é€😀a')), Buffer.from('é€😀a', 'utf8').toString('hex'));
  assert.ok(sameHex('00ff', '00ff'));
  assert.ok(!sameHex('00ff', '00fe'));
  assert.ok(!sameHex('00ff', '00ff00'));
});
