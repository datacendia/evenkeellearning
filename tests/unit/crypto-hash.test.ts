// Unit tests for lib/crypto/hash.ts. Focus: deterministic SHA-256 over JSON
// and proof-of-work integrity check.

import { describe, it, expect } from "vitest";
import {
  generateHash,
  generateProofOfWork,
  verifyProofOfWork,
  sha256Hex,
} from "@/lib/crypto/hash";

describe("crypto/hash", () => {
  // v1.5.5 — audit M-2: lock down the pure-JS SHA-256 against NIST
  // FIPS 180-4 test vectors. Any future optimisation or rewrite of
  // `lib/crypto/hash.ts` that drifts from standard SHA-256 will fail
  // here before it ships.
  //
  // These are the canonical FIPS 180-4 test vectors — any SHA-256
  // implementation that doesn't match both is not SHA-256.
  it("matches FIPS 180-4 SHA-256 test vectors", () => {
    // SHA-256("") — the empty string vector.
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    // SHA-256("abc") — the classic FIPS 180-4 test vector.
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    // Multi-block message that exercises the chunking loop.
    expect(
      sha256Hex(
        "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      ),
    ).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("produces a stable hex digest for identical input", () => {
    const a = generateHash({ x: 1, y: "two" });
    const b = generateHash({ x: 1, y: "two" });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces different digests for different input", () => {
    expect(generateHash({ x: 1 })).not.toBe(generateHash({ x: 2 }));
  });

  it("proof-of-work is order-independent for the same event set", () => {
    const events = [
      { id: "a", timestamp: 100, hash: "h1" },
      { id: "b", timestamp: 200, hash: "h2" },
    ];
    const reordered = [events[1], events[0]];
    expect(generateProofOfWork(events)).toBe(generateProofOfWork(reordered));
  });

  it("proof-of-work changes when an event is tampered with", () => {
    const events = [
      { id: "a", timestamp: 100, hash: "h1" },
      { id: "b", timestamp: 200, hash: "h2" },
    ];
    const before = generateProofOfWork(events);
    const tampered = [
      { id: "a", timestamp: 100, hash: "h1" },
      { id: "b", timestamp: 200, hash: "h2-MUTATED" },
    ];
    expect(generateProofOfWork(tampered)).not.toBe(before);
  });

  it("verifyProofOfWork accepts the original and rejects tampering", () => {
    const events = [
      { id: "a", timestamp: 100, hash: "h1" },
      { id: "b", timestamp: 200, hash: "h2" },
    ];
    const pow = generateProofOfWork(events);
    expect(verifyProofOfWork(events, pow)).toBe(true);
    const tampered = [...events, { id: "c", timestamp: 300, hash: "h3" }];
    expect(verifyProofOfWork(tampered, pow)).toBe(false);
  });
});
