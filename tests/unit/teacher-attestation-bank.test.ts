// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/teacher-attestation-bank.test.ts
//
// Pins the attestation bank behaviour:
//   • appendAttestation persists to localStorage, returns the envelope,
//     and emits a PII-free bus event.
//   • listAttestations / listAttestationsForCrt / listAttestationsForStudent
//     read back what was appended.
//   • clearAttestationBank wipes both the storage and the bus log
//     references (the bank itself, not the bus log).
//   • The cap (MAX_ATTESTATION_ENTRIES) drops oldest first.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  appendAttestation,
  listAttestations,
  listAttestationsForCrt,
  listAttestationsForStudent,
  clearAttestationBank,
  MAX_ATTESTATION_ENTRIES,
} from "@/lib/teacher/attestation-bank";
import type { SignAttestationInput, TeacherAttestationEnvelope, TeacherAttestationPayload } from "@/lib/teacher/attestation";
import { signPayload, resetSessionKeyPair } from "@/lib/crypto/signing";
import * as bus from "@/lib/data-bus";

// Reusable test signer that produces a passkey-keyType envelope without
// invoking WebAuthn.
async function passkeyTestSigner(
  payload: TeacherAttestationPayload,
): Promise<TeacherAttestationEnvelope> {
  const sessionEnv = await signPayload(payload);
  return { ...sessionEnv, keyType: "passkey-derived" } as TeacherAttestationEnvelope;
}

function makeInput(overrides: Partial<SignAttestationInput> = {}): SignAttestationInput {
  return {
    crtContentDigestB64url: "abc-digest",
    studentExternalId: "S001",
    problemId: "uk-gcse-maths-quadratics-001",
    verdict: "verified-mastery",
    reviewerNote: "Clean factoring.",
    specPoints: [{ framework: "AQA-GCSE-9-1-Maths", code: "A18" }],
    signer: passkeyTestSigner,
    now: () => new Date("2026-05-11T08:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  clearAttestationBank();
  resetSessionKeyPair();
});

describe("attestation bank — round-trip", () => {
  it("appendAttestation persists and listAttestations reads back", async () => {
    const env = await appendAttestation(makeInput());
    expect(env.keyType).toBe("passkey-derived");
    const list = listAttestations();
    expect(list).toHaveLength(1);
    expect(list[0].payload.studentExternalId).toBe("S001");
    expect(list[0].payload.verdict).toBe("verified-mastery");
  });

  it("listAttestationsForCrt filters by digest", async () => {
    await appendAttestation(makeInput({ crtContentDigestB64url: "alpha" }));
    await appendAttestation(makeInput({ crtContentDigestB64url: "beta" }));
    expect(listAttestationsForCrt("alpha")).toHaveLength(1);
    expect(listAttestationsForCrt("beta")).toHaveLength(1);
    expect(listAttestationsForCrt("missing")).toHaveLength(0);
  });

  it("listAttestationsForStudent filters by external id", async () => {
    await appendAttestation(makeInput({ studentExternalId: "S001" }));
    await appendAttestation(makeInput({ studentExternalId: "S002" }));
    await appendAttestation(makeInput({ studentExternalId: "S001" }));
    expect(listAttestationsForStudent("S001")).toHaveLength(2);
    expect(listAttestationsForStudent("S002")).toHaveLength(1);
  });
});

describe("attestation bank — bus emission privacy", () => {
  it("emits teacher.attestation.signed with no PII in payload", async () => {
    const spy = vi.spyOn(bus, "publish");
    await appendAttestation(
      makeInput({
        reviewerNote: "Sara worked through her sign error carefully.",
      }),
    );
    expect(spy).toHaveBeenCalled();
    const call = spy.mock.calls.find(
      (c: unknown[]) => c[0] === "teacher.attestation.signed",
    );
    expect(call).toBeDefined();
    const payload = call![1] as Record<string, unknown>;
    const json = JSON.stringify(payload);
    // No reviewer note text in the bus event.
    expect(json).not.toMatch(/Sara/);
    expect(json).not.toMatch(/sign error/i);
    // No full digest, only a prefix.
    expect((payload.crtContentDigestPrefix as string).length).toBeLessThanOrEqual(16);
    // Verdict + counts should be present.
    expect(payload.verdict).toBe("verified-mastery");
    expect(payload.specPointCount).toBe(1);
    expect(payload.keyType).toBe("passkey-derived");
    spy.mockRestore();
  });
});

describe("attestation bank — clear", () => {
  it("clearAttestationBank wipes storage", async () => {
    await appendAttestation(makeInput());
    expect(listAttestations()).toHaveLength(1);
    clearAttestationBank();
    expect(listAttestations()).toHaveLength(0);
  });
});

describe("attestation bank — cap behaviour", () => {
  it("drops oldest entries when MAX_ATTESTATION_ENTRIES is exceeded", async () => {
    // Append cap+1 entries; the first should roll off.
    const total = MAX_ATTESTATION_ENTRIES + 1;
    for (let i = 0; i < total; i++) {
      await appendAttestation(
        makeInput({
          studentExternalId: `S${String(i).padStart(4, "0")}`,
          // Slightly different digests so they're distinguishable.
          crtContentDigestB64url: `crt-${i}`,
        }),
      );
    }
    const list = listAttestations();
    expect(list).toHaveLength(MAX_ATTESTATION_ENTRIES);
    // The first append (S0000) should have rolled off; the last (S<total-1>)
    // should be retained.
    expect(list.find((e: TeacherAttestationEnvelope) => e.payload.studentExternalId === "S0000")).toBeUndefined();
    expect(
      list.find((e: TeacherAttestationEnvelope) => e.payload.studentExternalId === `S${String(total - 1).padStart(4, "0")}`),
    ).toBeDefined();
  });
});
