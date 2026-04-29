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
});
