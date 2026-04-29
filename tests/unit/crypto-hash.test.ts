// Unit tests for lib/crypto/hash.ts. Focus: deterministic SHA-256 over JSON
// and proof-of-work integrity check.

import { describe, it, expect } from "vitest";
import { generateHash, generateProofOfWork, verifyProofOfWork } from "@/lib/crypto/hash";

describe("crypto/hash", () => {
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
