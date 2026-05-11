import { describe, it, expect } from "vitest";
import {
  buildUnsignedCredential,
  issueVerifiableCredential,
  canonicalizeJcsSubset,
  VC_V2_CONTEXT,
  EVEN_KEEL_CREDENTIAL_TYPE,
  PROOF_TYPE,
  PROOF_CRYPTOSUITE,
  type VerifiableCredential,
} from "@/lib/vc/issuer";
import { checkCredentialShape, verifyCredential } from "@/lib/vc/verifier";
import { signPayload } from "@/lib/crypto/signing";
import type { TeacherAttestationEnvelope } from "@/lib/teacher/attestation";

// ─── Fixture ───────────────────────────────────────────────────────────────

function fakeAttestation(over: Partial<TeacherAttestationEnvelope["payload"]> = {}): TeacherAttestationEnvelope {
  return {
    payload: {
      version: 1,
      crtContentDigestB64url: "crt-digest-abc",
      studentExternalId: "alex-01",
      problemId: "alg-quad-01",
      attestedAtIso: "2026-05-02T09:00:00Z",
      verdict: "verified-mastery",
      specPoints: [
        {
          framework: "AQA-GCSE-9-1-Maths",
          code: "A18",
          label: "Solve quadratics",
          claimVocabularyVersion: 1,
        },
      ],
      ...over,
    },
    contentDigestB64url: "att-digest-xyz",
    signatureB64url: "att-sig",
    publicKeyB64url: "teacher-pk",
    signedAtIso: "2026-05-02T09:00:00Z",
    algorithm: "ECDSA-P256-SHA256",
    keyType: "passkey-derived",
  };
}

// Test signer — uses session key so we don't need a WebAuthn ceremony.
const testSigner = (p: { canonical: string }) =>
  signPayload(p, { keySource: "session" });

// ─── canonicalizeJcsSubset ─────────────────────────────────────────────────

describe("canonicalizeJcsSubset", () => {
  it("produces deterministic output with sorted keys", () => {
    const a = canonicalizeJcsSubset({ b: 1, a: 2 });
    const b = canonicalizeJcsSubset({ a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1}');
  });

  it("recursively sorts nested keys", () => {
    const out = canonicalizeJcsSubset({ z: { b: 1, a: 2 }, a: 1 });
    expect(out).toBe('{"a":1,"z":{"a":2,"b":1}}');
  });

  it("preserves array order (not keys)", () => {
    const out = canonicalizeJcsSubset({ arr: [3, 1, 2] });
    expect(out).toBe('{"arr":[3,1,2]}');
  });

  it("drops undefined fields", () => {
    const out = canonicalizeJcsSubset({ a: 1, b: undefined });
    expect(out).toBe('{"a":1}');
  });
});

// ─── buildUnsignedCredential ───────────────────────────────────────────────

describe("buildUnsignedCredential", () => {
  it("emits a W3C-shaped unsigned VC", () => {
    const vc = buildUnsignedCredential({
      attestation: fakeAttestation(),
      issuerDid: "did:web:school.example",
    });
    expect(vc["@context"][0]).toBe(VC_V2_CONTEXT);
    expect(vc.type).toContain("VerifiableCredential");
    expect(vc.type).toContain(EVEN_KEEL_CREDENTIAL_TYPE);
    expect(vc.issuer).toBe("did:web:school.example");
    expect(vc.validFrom).toBe("2026-05-02T09:00:00Z");
    expect(vc.credentialSubject.id).toBe("urn:evenkeel:learner:alex-01");
    expect(vc.credentialSubject.type).toBe("Learner");
    expect(vc.credentialSubject.claim).toBe("DemonstratedMastery");
    expect(vc.credentialSubject.demonstratedSpecPoints).toHaveLength(1);
    expect(vc.credentialSubject.evidenceContentDigestB64url).toBe("crt-digest-abc");
    expect(vc.credentialSubject.problemId).toBe("alg-quad-01");
  });

  it("maps each verdict to a distinct claim name", () => {
    const masteries = ["verified-mastery", "verified-with-support", "needs-revisit", "anomaly-rejected"] as const;
    const names = masteries.map((v) =>
      buildUnsignedCredential({
        attestation: fakeAttestation({ verdict: v }),
        issuerDid: "did:web:x",
      }).credentialSubject.claim,
    );
    expect(new Set(names).size).toBe(4);
  });

  it("includes reviewerNote when present", () => {
    const vc = buildUnsignedCredential({
      attestation: fakeAttestation({ reviewerNote: "Clean reasoning trace." }),
      issuerDid: "did:web:x",
    });
    expect(vc.credentialSubject.reviewerNote).toBe("Clean reasoning trace.");
  });

  it("omits reviewerNote when absent", () => {
    const vc = buildUnsignedCredential({
      attestation: fakeAttestation(),
      issuerDid: "did:web:x",
    });
    expect(vc.credentialSubject.reviewerNote).toBeUndefined();
  });

  it("derives stable id from attestation digest", () => {
    const vc = buildUnsignedCredential({
      attestation: fakeAttestation(),
      issuerDid: "did:web:x",
    });
    expect(vc.id).toBe("urn:evenkeel:vc:att-digest-xyz");
  });

  it("respects custom id override", () => {
    const vc = buildUnsignedCredential({
      attestation: fakeAttestation(),
      issuerDid: "did:web:x",
      id: "urn:custom:vc:1",
    });
    expect(vc.id).toBe("urn:custom:vc:1");
  });

  it("respects custom validFromIso", () => {
    const vc = buildUnsignedCredential({
      attestation: fakeAttestation(),
      issuerDid: "did:web:x",
      validFromIso: "2026-06-01T00:00:00Z",
    });
    expect(vc.validFrom).toBe("2026-06-01T00:00:00Z");
  });

  it("throws on invalid spec point in the attestation", () => {
    const bad = fakeAttestation({
      specPoints: [{ framework: "", code: "A18", claimVocabularyVersion: 1 }],
    });
    expect(() =>
      buildUnsignedCredential({ attestation: bad, issuerDid: "did:web:x" }),
    ).toThrow(/invalid_spec_point/);
  });
});

// ─── issueVerifiableCredential round-trip ──────────────────────────────────

describe("issueVerifiableCredential + verifyCredential", () => {
  it("issues a VC and verifies it round-trip", async () => {
    const vc = await issueVerifiableCredential({
      attestation: fakeAttestation(),
      issuerDid: "did:web:school.example",
      signer: testSigner,
    });
    expect(vc.proof.type).toBe(PROOF_TYPE);
    expect(vc.proof.cryptosuite).toBe(PROOF_CRYPTOSUITE);
    expect(vc.proof.proofPurpose).toBe("assertionMethod");
    expect(vc.proof.verificationMethod).toBe("did:web:school.example#key-1");
    expect(vc.proof.proofValue.length).toBeGreaterThan(0);

    const result = await verifyCredential(vc);
    expect(result.ok).toBe(true);
  });

  it("rejects a VC whose credentialSubject was tampered with", async () => {
    const vc = await issueVerifiableCredential({
      attestation: fakeAttestation(),
      issuerDid: "did:web:school.example",
      signer: testSigner,
    });
    const tampered: VerifiableCredential = {
      ...vc,
      credentialSubject: {
        ...vc.credentialSubject,
        claim: "DemonstratedMasteryWithSupport",
      },
    };
    const result = await verifyCredential(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("bad_signature");
  });

  it("rejects a VC with swapped proof value", async () => {
    const vc = await issueVerifiableCredential({
      attestation: fakeAttestation(),
      issuerDid: "did:web:school.example",
      signer: testSigner,
    });
    const tampered: VerifiableCredential = {
      ...vc,
      proof: { ...vc.proof, proofValue: "AAAAAAAAAAAAAAAAAAAA" },
    };
    const result = await verifyCredential(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(["bad_signature", "verify_threw"]).toContain(result.reason);
    }
  });
});

// ─── checkCredentialShape ──────────────────────────────────────────────────

describe("checkCredentialShape", () => {
  function baseCred(): VerifiableCredential {
    return {
      "@context": [VC_V2_CONTEXT],
      id: "urn:test:1",
      type: ["VerifiableCredential", EVEN_KEEL_CREDENTIAL_TYPE],
      issuer: "did:web:x",
      validFrom: "2026-05-02T09:00:00Z",
      credentialSubject: {
        id: "urn:evenkeel:learner:alex-01",
        type: "Learner",
        claim: "DemonstratedMastery",
        demonstratedSpecPoints: [
          { framework: "AQA", code: "A18", claimVocabularyVersion: 1 },
        ],
        evidenceContentDigestB64url: "d",
        problemId: "p",
      },
      proof: {
        type: PROOF_TYPE,
        cryptosuite: PROOF_CRYPTOSUITE,
        created: "2026-05-02T09:00:01Z",
        verificationMethod: "did:web:x#key-1",
        proofPurpose: "assertionMethod",
        proofValue: "sig",
        publicKeyB64url: "pk",
      },
    };
  }

  it("accepts a well-formed credential", () => {
    expect(checkCredentialShape(baseCred()).ok).toBe(true);
  });

  it("rejects null", () => {
    const r = checkCredentialShape(null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_an_object");
  });

  it("rejects missing @context", () => {
    const c = baseCred() as Record<string, unknown>;
    delete c["@context"];
    const r = checkCredentialShape(c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_context");
  });

  it("rejects wrong @context first item", () => {
    const c = baseCred();
    (c["@context"] as string[])[0] = "https://example.com/wrong";
    const r = checkCredentialShape(c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("wrong_context");
  });

  it("rejects missing VerifiableCredential type", () => {
    const c = baseCred();
    (c as unknown as Record<string, unknown>).type = [EVEN_KEEL_CREDENTIAL_TYPE];
    const r = checkCredentialShape(c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("wrong_type");
  });

  it("rejects missing issuer", () => {
    const c = baseCred();
    (c as unknown as Record<string, unknown>).issuer = "";
    const r = checkCredentialShape(c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_issuer");
  });

  it("rejects missing validFrom", () => {
    const c = baseCred() as unknown as Record<string, unknown>;
    delete c.validFrom;
    const r = checkCredentialShape(c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_validFrom");
  });

  it("rejects missing credentialSubject", () => {
    const c = baseCred() as unknown as Record<string, unknown>;
    delete c.credentialSubject;
    const r = checkCredentialShape(c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_credentialSubject");
  });

  it("rejects bad spec point", () => {
    const c = baseCred();
    c.credentialSubject.demonstratedSpecPoints = [
      { framework: "", code: "A", claimVocabularyVersion: 1 },
    ];
    const r = checkCredentialShape(c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_spec_point");
  });

  it("rejects future vocabulary version when verifier is older", () => {
    const c = baseCred();
    c.credentialSubject.demonstratedSpecPoints = [
      { framework: "X", code: "A", claimVocabularyVersion: 5 as 1 },
    ];
    const r = checkCredentialShape(c, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_spec_point");
  });

  it("rejects missing proof", () => {
    const c = baseCred() as unknown as Record<string, unknown>;
    delete c.proof;
    const r = checkCredentialShape(c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_proof");
  });

  it("rejects wrong cryptosuite", () => {
    const c = baseCred();
    c.proof.cryptosuite = "ed25519-2020" as typeof PROOF_CRYPTOSUITE;
    const r = checkCredentialShape(c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("wrong_cryptosuite");
  });

  it("rejects wrong proof purpose", () => {
    const c = baseCred();
    c.proof.proofPurpose = "authentication" as "assertionMethod";
    const r = checkCredentialShape(c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("wrong_proof_purpose");
  });

  it("rejects missing public key in proof", () => {
    const c = baseCred();
    c.proof.publicKeyB64url = "";
    const r = checkCredentialShape(c);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_public_key");
  });
});
