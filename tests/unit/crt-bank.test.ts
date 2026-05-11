// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/crt-bank.test.ts
//
// Tests for the CRT bank (local envelope persistence). The bank stores
// signed `CognitiveReasoningTrace` envelopes in `localStorage` with a
// hard cap of 100 entries.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { CognitiveReasoningTrace } from "@/lib/types";
import { appendCRT, listCRTs, clearCRTs, listVerifiedCRTs } from "@/lib/crt/bank";
import { signPayload, verifyEnvelope, resetSessionKeyPair } from "@/lib/crypto/signing";

describe("crt/bank — persistence", () => {
  beforeEach(() => {
    clearCRTs();
  });

  afterEach(() => {
    clearCRTs();
  });

  it("starts empty", () => {
    expect(listCRTs()).toEqual([]);
  });

  it("appends a signed envelope", async () => {
    const trace: CognitiveReasoningTrace = {
      studentId: "student-1",
      sessionId: "session-1",
      problemId: "prob-1",
      events: [],
      startTime: 1000,
      endTime: 2000,
      totalThinkTime: 1000,
      deletionCount: 0,
      pivotCount: 0,
      proofOfWorkHash: "hash-1",
    };

    // Mock signer that returns a valid-looking envelope
    const mockSigner = async (t: CognitiveReasoningTrace) => ({
      signatureB64url: "sig-1",
      publicKeyB64url: "pk-1",
      contentDigestB64url: "digest-1",
      algorithm: "ES256" as const,
      keyType: "session-demo" as const,
      payload: t,
    });

    const env = await appendCRT(trace, mockSigner);
    expect(env.payload).toEqual(trace);
    expect(listCRTs()).toHaveLength(1);
  });

  it("enforces the cap (MAX_CRT_ENTRIES = 100)", async () => {
    const mockSigner = async (t: CognitiveReasoningTrace) => ({
      signatureB64url: "sig-1",
      publicKeyB64url: "pk-1",
      contentDigestB64url: "digest-1",
      algorithm: "ES256" as const,
      keyType: "session-demo" as const,
      payload: t,
    });

    // Append 101 traces; only the last 100 should remain
    for (let i = 0; i < 101; i++) {
      await appendCRT(
        {
          studentId: `student-${i}`,
          sessionId: `session-${i}`,
          problemId: `prob-${i}`,
          events: [],
          startTime: i * 1000,
          endTime: (i + 1) * 1000,
          totalThinkTime: 1000,
          deletionCount: 0,
          pivotCount: 0,
          proofOfWorkHash: `hash-${i}`,
        },
        mockSigner,
      );
    }

    const all = listCRTs();
    expect(all).toHaveLength(100);
    // The first entry should have been dropped
    expect(all[0].payload.studentId).not.toBe("student-0");
  });

  it("clearCRTs wipes the bank", async () => {
    const trace: CognitiveReasoningTrace = {
      studentId: "student-1",
      sessionId: "session-1",
      problemId: "prob-1",
      events: [],
      startTime: 1000,
      endTime: 2000,
      totalThinkTime: 1000,
      deletionCount: 0,
      pivotCount: 0,
      proofOfWorkHash: "hash-1",
    };

    const mockSigner = async (t: CognitiveReasoningTrace) => ({
      signatureB64url: "sig-1",
      publicKeyB64url: "pk-1",
      contentDigestB64url: "digest-1",
      algorithm: "ES256" as const,
      keyType: "session-demo" as const,
      payload: t,
    });

    await appendCRT(trace, mockSigner);
    expect(listCRTs()).toHaveLength(1);

    clearCRTs();
    expect(listCRTs()).toHaveLength(0);
  });
});

describe("crt/bank — verification", () => {
  beforeEach(() => {
    clearCRTs();
  });

  afterEach(() => {
    clearCRTs();
  });

  it("listVerifiedCRTs returns only envelopes that verify", async () => {
    const trace: CognitiveReasoningTrace = {
      studentId: "student-1",
      sessionId: "session-1",
      problemId: "prob-1",
      events: [],
      startTime: 1000,
      endTime: 2000,
      totalThinkTime: 1000,
      deletionCount: 0,
      pivotCount: 0,
      proofOfWorkHash: "hash-1",
    };

    // Mock signer that returns a valid-looking envelope (but won't verify)
    const mockSigner = async (t: CognitiveReasoningTrace) => ({
      signatureB64url: "sig-1",
      publicKeyB64url: "pk-1",
      contentDigestB64url: "digest-1",
      algorithm: "ES256" as const,
      keyType: "session-demo" as const,
      payload: t,
    });

    await appendCRT(trace, mockSigner);
    const verified = await listVerifiedCRTs();
    // Since the mock signature is bogus, verification should fail
    expect(verified).toHaveLength(0);
  });

  // v1.5.5 — audit M-6: end-to-end real-crypto roundtrip. Every other
  // test in this file uses a mock signer that returns a static fake
  // envelope, so a bug in the real `signPayload` → bank persistence →
  // `listVerifiedCRTs` path would never surface here. This test signs
  // with the actual session ECDSA-P256 key, persists, and verifies the
  // round-trip end-to-end. Also pins that tampering with the persisted
  // bytes makes verification fail (integrity property of the bank).
  it("real-crypto roundtrip: signs with the session key, persists, and verifies", async () => {
    resetSessionKeyPair();
    const trace: CognitiveReasoningTrace = {
      studentId: "real-student",
      sessionId: "real-session",
      problemId: "real-prob",
      events: [],
      startTime: 4242,
      endTime: 5252,
      totalThinkTime: 1010,
      deletionCount: 0,
      pivotCount: 0,
      proofOfWorkHash: "real-hash",
    };

    const env = await appendCRT(trace, signPayload);
    expect(env.signatureB64url.length).toBeGreaterThan(40);
    expect(env.publicKeyB64url.length).toBeGreaterThan(40);

    // Sanity: round-trip directly through verifyEnvelope.
    expect(await verifyEnvelope(env)).toBe(true);

    // The bank's verifier returns the envelope as verified.
    const verified = await listVerifiedCRTs();
    expect(verified).toHaveLength(1);
    expect(verified[0]!.payload.studentId).toBe("real-student");

    // Tamper with the persisted payload and confirm verification fails.
    const stored = JSON.parse(
      window.localStorage.getItem("evenkeel.crt.bank") ?? "[]",
    ) as Array<{ payload: CognitiveReasoningTrace }>;
    stored[0]!.payload.studentId = "tampered-student";
    window.localStorage.setItem("evenkeel.crt.bank", JSON.stringify(stored));
    const afterTamper = await listVerifiedCRTs();
    expect(afterTamper).toHaveLength(0);
  });
});
