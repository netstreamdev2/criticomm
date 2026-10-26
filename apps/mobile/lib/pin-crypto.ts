/**
 * SHA-256, HMAC-SHA-256 and PBKDF2-HMAC-SHA-256 in plain TypeScript, for
 * checking a PIN on the phone with no signal (lib/offline-pass-policy.ts).
 * The app has no native crypto module; these follow FIPS 180-4, RFC 2104 and
 * RFC 8018 and are checked against Node's crypto in pin-crypto.test.ts.
 * No dependencies, so it can be tested.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

const W = new Uint32Array(64);

/** One 64-byte block into the state. */
function compress(state: Uint32Array, block: Uint8Array, at: number) {
  for (let i = 0; i < 16; i++) {
    const j = at + i * 4;
    W[i] = ((block[j]! << 24) | (block[j + 1]! << 16) | (block[j + 2]! << 8) | block[j + 3]!) >>> 0;
  }
  for (let i = 16; i < 64; i++) {
    const a = W[i - 15]!;
    const b = W[i - 2]!;
    const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
    const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
    W[i] = (W[i - 16]! + s0 + W[i - 7]! + s1) >>> 0;
  }
  let a = state[0]!, b = state[1]!, c = state[2]!, d = state[3]!, e = state[4]!, f = state[5]!, g = state[6]!, h = state[7]!;
  for (let i = 0; i < 64; i++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const ch = (e & f) ^ (~e & g);
    const t1 = (h + S1 + ch + K[i]! + W[i]!) >>> 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (S0 + maj) >>> 0;
    h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
  }
  state[0] = (state[0]! + a) >>> 0; state[1] = (state[1]! + b) >>> 0; state[2] = (state[2]! + c) >>> 0; state[3] = (state[3]! + d) >>> 0;
  state[4] = (state[4]! + e) >>> 0; state[5] = (state[5]! + f) >>> 0; state[6] = (state[6]! + g) >>> 0; state[7] = (state[7]! + h) >>> 0;
}

/** Hashes `data` after `prefixBlocks` already in `state` (each 64 bytes), and returns the 32-byte digest. */
function finish(state: Uint32Array, data: Uint8Array, prefixBlocks: number): Uint8Array {
  const whole = Math.floor(data.length / 64);
  for (let i = 0; i < whole; i++) compress(state, data, i * 64);
  const rest = data.length - whole * 64;
  const tail = new Uint8Array(rest < 56 ? 64 : 128);
  tail.set(data.subarray(whole * 64));
  tail[rest] = 0x80;
  const bits = (prefixBlocks * 64 + data.length) * 8;
  const end = tail.length;
  // Lengths here are far below 2^32 bits; the high word stays nought.
  tail[end - 4] = (bits >>> 24) & 255; tail[end - 3] = (bits >>> 16) & 255; tail[end - 2] = (bits >>> 8) & 255; tail[end - 1] = bits & 255;
  for (let i = 0; i < tail.length; i += 64) compress(state, tail, i);
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    const v = state[i]!;
    out[i * 4] = v >>> 24; out[i * 4 + 1] = (v >>> 16) & 255; out[i * 4 + 2] = (v >>> 8) & 255; out[i * 4 + 3] = v & 255;
  }
  return out;
}

export function sha256(data: Uint8Array): Uint8Array {
  return finish(new Uint32Array(IV), data, 0);
}

/** UTF-8 bytes of a string. */
export function utf8(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

/** HMAC's inner and outer states for a key, so PBKDF2 pays for the key once. */
function hmacStates(key: Uint8Array) {
  const k = key.length > 64 ? sha256(key) : key;
  const block = new Uint8Array(64);
  block.set(k);
  const inner = new Uint32Array(IV);
  const outer = new Uint32Array(IV);
  const ipad = new Uint8Array(64);
  const opad = new Uint8Array(64);
  for (let i = 0; i < 64; i++) { ipad[i] = block[i]! ^ 0x36; opad[i] = block[i]! ^ 0x5c; }
  compress(inner, ipad, 0);
  compress(outer, opad, 0);
  return { inner, outer };
}

function hmacWith(states: { inner: Uint32Array; outer: Uint32Array }, data: Uint8Array): Uint8Array {
  const innerDigest = finish(new Uint32Array(states.inner), data, 1);
  return finish(new Uint32Array(states.outer), innerDigest, 1);
}

export function hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
  return hmacWith(hmacStates(key), data);
}

/** PBKDF2-HMAC-SHA-256, one block (32 bytes): all a PIN check needs. */
export function pbkdf2Sha256(password: Uint8Array, salt: Uint8Array, iterations: number): Uint8Array {
  const states = hmacStates(password);
  const first = new Uint8Array(salt.length + 4);
  first.set(salt);
  first[salt.length + 3] = 1;
  let u = hmacWith(states, first);
  const out = Uint8Array.from(u);
  for (let i = 1; i < iterations; i++) {
    u = hmacWith(states, u);
    for (let j = 0; j < 32; j++) out[j] = out[j]! ^ u[j]!;
  }
  return out;
}

/** Equal hex strings, compared in the same time whatever they hold. */
export function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
