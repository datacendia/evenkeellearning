// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/teacher-attestation.test.ts
//
// Pins the contract for the teacher attestation envelope:
//   • Payload validator catches every malformed-input class.
//   • signAttestation refuses non-passkey signing in the production path
//     (PasskeyRequiredError is propagated).
//   • A custom test-signer round-trip produces a verifiable envelope.
//   • verifyAttestation:
//       - accepts a properly-signed envelope
//       - rejects a tampered payload (signature break)
//       - rejects a wrong CRT digest pin
//       - rejects a non-passkey-derived envelope when requirePasskey=true
//       - accepts a session-key envelope when requirePasskey=false
//   • Forward-compat: spec points carry claimVocabularyVersion=1 and
//     skillUri stays optional.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from "vitest";
import {
  signAttestation,
  verifyAttestation,
  validateAttestationPayload,
  REVIEWER_NOTE_MAX_CHARS,
  type SignAttestationInput,
  type TeacherAttestationEnvelope,
  type TeacherAttestationPayload,
} from "@/lib/teacher/attestation";
import {
  signPayload,
  resetSessionKeyPair,
} from "@/lib/crypto/signing";

// Helper: build a passkey-derived envelope by reusing the session-key
// signer and post-stamping `keyType` to "passkey-derived". This is a
// deliberate test seam — we want to exercise the verify path
// independently of the WebAuthn stack, which isn't available in
// happy-dom. The test for the production passkey-required behaviour
// asserts on the THROW from signAttestation, not on a synthesised
// envelope.
async function buildPasskeyEnvelope(
  payload: TeacherAttestationPayload,
): Promise<TeacherAttestationEnvelope> {
  const sessionEnv = await signPayload(payload);
  return { ...sessionEnv, keyType: "passkey-derived" } as TeacherAttestationEnvelope;
}

const BASE_INPUT: SignAttestationInput = {
  crtContentDigestB64url: "abc123-crtdigest",
  studentExternalId: "S001",
  problemId: "uk-gcse-maths-quadratics-001",
  verdict: "verified-mastery",
  reviewerNote: "Clear factoring; checked both roots.",
  specPoints: [
    { framework: "AQA-GCSE-9-1-Maths", code: "A18", label: "Solve quadratic equations" },
    { framework: "Edexcel-GCSE-9-1-Maths", code: "2.4", label: "Factorise quadratic expressions" },
  ],
  institutionId: "URN-12345",
  now: () => new Date("2026-05-11T08:00:00.000Z"),
};

beforeEach(() => {
  resetSessionKeyPair();
});

// ── Payload validator ──────────────────────────────────────────────────────

describe("validateAttestationPayload", () => {
  function valid(): TeacherAttestationPayload {
    return {
      version: 1,
      crtContentDigestB64url: "d",
      studentExternalId: "S001",
      problemId: "p1",
      attestedAtIso: "2026-05-11T08:00:00.000Z",
      verdict: "verified-mastery",
      specPoints: [],
    };
  }

  it("accepts a minimal valid payload", () => {
    expect(validateAttestationPayload(valid())).toBeNull();
  });

  it("rejects non-object payloads", () => {
    expect(validateAttestationPayload(null)).toBe("payload_not_object");
    expect(validateAttestationPayload("string")).toBe("payload_not_object");
  });

  it("rejects wrong version", () => {
    const p: any = valid();
    p.version = 2;
    expect(validateAttestationPayload(p)).toBe("wrong_version");
  });

  it("rejects missing CRT digest", () => {
    const p: any = valid();
    p.crtContentDigestB64url = "";
    expect(validateAttestationPayload(p)).toBe("missing_crt_digest");
  });

  it("rejects missing student id", () => {
    const p: any = valid();
    p.studentExternalId = "";
    expect(validateAttestationPayload(p)).toBe("missing_student_external_id");
  });

  it("rejects bad verdict enum", () => {
    const p: any = valid();
    p.verdict = "fantastic";
    expect(validateAttestationPayload(p)).toBe("bad_verdict");
  });

  it("rejects malformed attestedAtIso", () => {
    const p: any = valid();
    p.attestedAtIso = "yesterday";
    expect(validateAttestationPayload(p)).toBe("bad_attested_at");
  });

  it("rejects an over-long reviewer note", () => {
    const p: any = valid();
    p.reviewerNote = "x".repeat(REVIEWER_NOTE_MAX_CHARS + 1);
    expect(validateAttestationPayload(p)).toBe("reviewer_note_too_long");
  });

  it("rejects bad spec point shape", () => {
    const p: any = valid();
    p.specPoints = [{ framework: "AQA", code: "" }];
    expect(validateAttestationPayload(p)).toBe("bad_spec_point_code");
  });

  it("rejects spec point with wrong claimVocabularyVersion", () => {
    const p: any = valid();
    p.specPoints = [{ framework: "AQA", code: "A18", claimVocabularyVersion: 2 }];
    expect(validateAttestationPayload(p)).toBe("bad_spec_point_vocab_version");
  });
});

// ── signAttestation ────────────────────────────────────────────────────────

describe("signAttestation — happy path with custom signer", () => {
  it("produces a verifiable envelope", async () => {
    const env = await signAttestation({ ...BASE_INPUT, signer: buildPasskeyEnvelope });
    expect(env.payload.version).toBe(1);
    expect(env.payload.crtContentDigestB64url).toBe(BASE_INPUT.crtContentDigestB64url);
    expect(env.payload.specPoints).toHaveLength(2);
    expect(env.payload.specPoints[0].claimVocabularyVersion).toBe(1);
    expect(env.payload.attestedAtIso).toBe("2026-05-11T08:00:00.000Z");
    expect(env.keyType).toBe("passkey-derived");

    const result = await verifyAttestation(env);
    expect(result.ok).toBe(true);
    expect(result.signatureValid).toBe(true);
    expect(result.payloadValid).toBe(true);
    expect(result.passkeyDerived).toBe(true);
  });

  it("default-fills claimVocabularyVersion=1 on each spec point", async () => {
    const env = await signAttestation({
      ...BASE_INPUT,
      // Provide spec points WITHOUT claimVocabularyVersion; the orchestrator
      // must fill it in.
      specPoints: [{ framework: "AQA", code: "A18" }],
      signer: buildPasskeyEnvelope,
    });
    expect(env.payload.specPoints[0].claimVocabularyVersion).toBe(1);
  });

  it("VC forward-compat: skillUri stays optional and absent in v1", async () => {
    const env = await signAttestation({ ...BASE_INPUT, signer: buildPasskeyEnvelope });
    expect(env.payload.specPoints[0].skillUri).toBeUndefined();
  });
});

describe("signAttestation — input validation", () => {
  it("throws on bad verdict", async () => {
    await expect(
      signAttestation({
        ...BASE_INPUT,
        verdict: "great" as any,
        signer: buildPasskeyEnvelope,
      }),
    ).rejects.toThrow(/invalid_attestation_payload:bad_verdict/);
  });

  it("throws on too-long reviewer note", async () => {
    await expect(
      signAttestation({
        ...BASE_INPUT,
        reviewerNote: "x".repeat(REVIEWER_NOTE_MAX_CHARS + 1),
        signer: buildPasskeyEnvelope,
      }),
    ).rejects.toThrow(/reviewer_note_too_long/);
  });
});

describe("signAttestation — production path requires a passkey", () => {
  // No `signer` override and no passkey enrolled → the call must throw
  // PasskeyRequiredError. We don't import the error class explicitly
  // (the production module may dynamic-import it); we assert on the
  // shape of the thrown value.
  it("throws when no passkey is enrolled", async () => {
    let threw: unknown = null;
    try {
      await signAttestation(BASE_INPUT);
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeInstanceOf(Error);
    // PasskeyRequiredError has name "PasskeyRequiredError" and a
    // reason field. Either of those is enough to confirm we're on the
    // require-passkey path rather than a generic validation throw.
    const e = threw as Error & { reason?: string; name?: string };
    expect(
      e.name === "PasskeyRequiredError" ||
        e.reason === "not_enrolled" ||
        e.reason === "module_unavailable",
    ).toBe(true);
  });
});

// ── verifyAttestation ──────────────────────────────────────────────────────

describe("verifyAttestation", () => {
  it("rejects a tampered payload (signature mismatch)", async () => {
    const env = await signAttestation({ ...BASE_INPUT, signer: buildPasskeyEnvelope });
    const tampered: TeacherAttestationEnvelope = {
      ...env,
      payload: { ...env.payload, verdict: "needs-revisit" },
    };
    const r = await verifyAttestation(tampered);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("bad_signature");
  });

  it("rejects when the CRT digest pin does not match expectedCrtDigest", async () => {
    const env = await signAttestation({ ...BASE_INPUT, signer: buildPasskeyEnvelope });
    const r = await verifyAttestation(env, { expectedCrtDigest: "not-the-same" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("crt_digest_pin_mismatch");
    expect(r.crtMatchesExpectedDigest).toBe(false);
  });

  it("accepts when the CRT digest pin matches", async () => {
    const env = await signAttestation({ ...BASE_INPUT, signer: buildPasskeyEnvelope });
    const r = await verifyAttestation(env, {
      expectedCrtDigest: BASE_INPUT.crtContentDigestB64url,
    });
    expect(r.ok).toBe(true);
    expect(r.crtMatchesExpectedDigest).toBe(true);
  });

  it("rejects a session-key envelope when requirePasskey=true (default)", async () => {
    // Build a session-key envelope (no passkey post-stamp).
    const sessionSigner = async (
      p: TeacherAttestationPayload,
    ): Promise<TeacherAttestationEnvelope> => {
      const e = await signPayload<TeacherAttestationPayload>(p);
      return e as TeacherAttestationEnvelope;
    };
    const env = await signAttestation({ ...BASE_INPUT, signer: sessionSigner });
    const r = await verifyAttestation(env);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("not_passkey_derived");
  });

  it("accepts a session-key envelope when requirePasskey=false", async () => {
    const sessionSigner = async (
      p: TeacherAttestationPayload,
    ): Promise<TeacherAttestationEnvelope> => {
      const e = await signPayload<TeacherAttestationPayload>(p);
      return e as TeacherAttestationEnvelope;
    };
    const env = await signAttestation({ ...BASE_INPUT, signer: sessionSigner });
    const r = await verifyAttestation(env, { requirePasskey: false });
    expect(r.ok).toBe(true);
    expect(r.passkeyDerived).toBe(false);
  });

  it("rejects a structurally-invalid payload before checking signature", async () => {
    const env = await signAttestation({ ...BASE_INPUT, signer: buildPasskeyEnvelope });
    // Mutate to invalid verdict; this also breaks the signature, but the
    // payload-validity check should fire FIRST so the reason mentions
    // payload_invalid, not bad_signature.
    const broken: TeacherAttestationEnvelope = {
      ...env,
      payload: { ...env.payload, verdict: "fantastic" as any },
    };
    const r = await verifyAttestation(broken);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/^payload_invalid:bad_verdict$/);
  });
});
