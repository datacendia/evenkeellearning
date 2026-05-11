// ─────────────────────────────────────────────────────────────────────────────
// lib/crypto/hash.ts
//
// SHA-256 content hashing and an event-stream "proof of work" helper.
// Browser + Node compatible. Pure-JS sync implementation — no dependencies.
//
// v1.5.5 — audit M-2: removed the `crypto-js` dependency (and its ~400KB
// @types/crypto-js peer). The CRTLogger calls `generateHash` from hot
// synchronous paths (every keystroke / deletion / focus event), and
// `SubtleCrypto.digest` is async, so we can't simply delegate to the
// Web Crypto API without cascading async through the logger's entire
// public surface. We keep the sync API and vendor a small, well-known
// SHA-256 implementation instead.
//
// For signing + verification (async paths) we still use `SubtleCrypto`
// in `lib/crypto/signing.ts`. This module is the SYNC hash surface only.
//
// HONESTY
// ───────
// The proof-of-work is a content hash, not a digital signature. It proves
// the event array has not been tampered with (assuming SHA-256 collision
// resistance). It does NOT prove who produced the events. To bind authorship
// use `signPayload()` from `lib/crypto/signing.ts`.
// ─────────────────────────────────────────────────────────────────────────────

// ── Pure-JS SHA-256 (FIPS 180-4) ────────────────────────────────────────────
//
// Adapted from the public-domain reference implementation. Operates on
// UTF-8 encoded bytes and returns a lowercase hex digest. Deterministic,
// endian-independent, no runtime deps.
//
// Constants K: first 32 bits of the fractional parts of the cube roots
// of the first 64 primes.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(n: number, x: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

function utf8Encode(str: string): Uint8Array {
  // Use native TextEncoder when available (browser + Node 18+). Falls
  // back to a manual UTF-8 encoder for exotic runtimes.
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(str);
  }
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c < 0xd800 || c >= 0xe000) {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else {
      // surrogate pair
      i++;
      c = 0x10000 + (((c & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
      bytes.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 0x3f),
        0x80 | ((c >> 6) & 0x3f),
        0x80 | (c & 0x3f),
      );
    }
  }
  return new Uint8Array(bytes);
}

/**
 * Exposed for the NIST test-vector assertion in
 * `tests/unit/crypto-hash.test.ts`. Callers who want to hash arbitrary
 * JSON should use `generateHash` instead.
 */
export function sha256Hex(input: string): string {
  return sha256(input);
}

function sha256(input: string): string {
  const bytes = utf8Encode(input);
  const bitLen = bytes.length * 8;

  // Pre-processing: append the bit "1" + k zero bits + 64-bit big-endian
  // length so that the total is a multiple of 512 bits.
  const padLen = (bytes.length + 9 + 63) & ~63;
  const msg = new Uint8Array(padLen);
  msg.set(bytes);
  msg[bytes.length] = 0x80;
  // 64-bit big-endian bit length. JS numbers are 53-bit safe; split.
  const hiLen = Math.floor(bitLen / 0x100000000);
  const loLen = bitLen >>> 0;
  msg[padLen - 8] = (hiLen >>> 24) & 0xff;
  msg[padLen - 7] = (hiLen >>> 16) & 0xff;
  msg[padLen - 6] = (hiLen >>> 8) & 0xff;
  msg[padLen - 5] = hiLen & 0xff;
  msg[padLen - 4] = (loLen >>> 24) & 0xff;
  msg[padLen - 3] = (loLen >>> 16) & 0xff;
  msg[padLen - 2] = (loLen >>> 8) & 0xff;
  msg[padLen - 1] = loLen & 0xff;

  // Initial hash values: first 32 bits of the fractional parts of the
  // square roots of the first 8 primes.
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const W = new Uint32Array(64);

  for (let off = 0; off < msg.length; off += 64) {
    // Copy chunk into W[0..15] (big-endian).
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      W[i] =
        ((msg[j] << 24) | (msg[j + 1] << 16) | (msg[j + 2] << 8) | msg[j + 3]) >>>
        0;
    }
    // Extend the first 16 words into the remaining 48.
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(7, W[i - 15]) ^ rotr(18, W[i - 15]) ^ (W[i - 15] >>> 3);
      const s1 = rotr(17, W[i - 2]) ^ rotr(19, W[i - 2]) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }

    let a = H[0],
      b = H[1],
      c = H[2],
      d = H[3],
      e = H[4],
      f = H[5],
      g = H[6],
      h = H[7];

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  // Hex-encode the 8 state words.
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += H[i].toString(16).padStart(8, "0");
  }
  return out;
}

// ── Public API (unchanged signatures) ───────────────────────────────────────

export function generateHash(data: unknown): string {
  const jsonString = JSON.stringify(data);
  return sha256(jsonString);
}

export function generateProofOfWork(events: unknown[]): string {
  const sortedEvents = [...events].sort(
    (a, b) => ((a as { timestamp: number }).timestamp) - ((b as { timestamp: number }).timestamp),
  );
  const eventHashes = sortedEvents.map((e) => generateHash(e));
  return generateHash(eventHashes);
}

export function verifyProofOfWork(events: unknown[], claimedHash: string): boolean {
  const computedHash = generateProofOfWork(events);
  return computedHash === claimedHash;
}
