// ─────────────────────────────────────────────────────────────────────────────
// lib/crypto/hash.ts
//
// SHA-256 content hashing and an event-stream "proof of work" helper.
// Powered by `crypto-js`. This module is browser+node compatible.
//
// HONESTY
// ───────
// The proof-of-work is a content hash, not a digital signature. It proves
// the event array has not been tampered with (assuming SHA-256 collision
// resistance). It does NOT prove who produced the events. To bind authorship
// use `signPayload()` from `lib/crypto/signing.ts`.
// ─────────────────────────────────────────────────────────────────────────────

import CryptoJS from "crypto-js";

export function generateHash(data: unknown): string {
  const jsonString = JSON.stringify(data);
  return CryptoJS.SHA256(jsonString).toString();
}

export function generateProofOfWork(events: ReadonlyArray<{ timestamp: number }>): string {
  const sortedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);
  const eventHashes = sortedEvents.map(e => generateHash(e));
  return generateHash(eventHashes);
}

export function verifyProofOfWork(events: ReadonlyArray<{ timestamp: number }>, claimedHash: string): boolean {
  const computedHash = generateProofOfWork(events);
  return computedHash === claimedHash;
}
