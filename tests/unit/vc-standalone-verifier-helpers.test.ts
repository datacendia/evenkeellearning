import { describe, it, expect } from "vitest";
import {
  parseCredentialFromPaste,
  extractEncodedListFromPaste,
  summarizeCredentialForDisplay,
  describeReason,
  describePasteReason,
} from "@/lib/vc/standalone-verifier-helpers";
import type { VerifiableCredential } from "@/lib/vc/issuer";

// ─── Fixture ───────────────────────────────────────────────────────────────

function fixtureCredential(): VerifiableCredential {
  return {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    id: "urn:evenkeel:vc:demo-1",
    type: ["VerifiableCredential", "EvenKeelAttestationCredential"],
    issuer: "did:web:demo.evenkeel.org",
    validFrom: "2026-05-11T10:00:00Z",
    credentialSubject: {
      id: "urn:evenkeel:learner:alex-01",
      type: "Learner",
      claim: "DemonstratedMastery",
      demonstratedSpecPoints: [
        {
          framework: "AQA-GCSE-9-1-Maths",
          code: "A18",
          label: "Solve quadratic equations",
          claimVocabularyVersion: 1,
        },
      ],
      evidenceContentDigestB64url: "abcdefghijklmnop_extra_bytes",
      problemId: "alg-quad-01",
      reviewerNote: "Strong reasoning chain.",
    },
    proof: {
      type: "DataIntegrityProof",
      cryptosuite: "ecdsa-jcs-2019",
      created: "2026-05-11T10:00:00Z",
      verificationMethod: "did:web:demo.evenkeel.org#key-1",
      proofPurpose: "assertionMethod",
      proofValue: "AAAA",
      publicKeyB64url: "BBBB",
    },
  };
}

// ─── parseCredentialFromPaste ──────────────────────────────────────────────

describe("parseCredentialFromPaste", () => {
  it("accepts a structurally valid credential", () => {
    const r = parseCredentialFromPaste(JSON.stringify(fixtureCredential()));
    expect(r.ok).toBe(true);
  });

  it("trims surrounding whitespace", () => {
    const r = parseCredentialFromPaste(
      `   ${JSON.stringify(fixtureCredential())}\n\n`,
    );
    expect(r.ok).toBe(true);
  });

  it("rejects empty input", () => {
    const r = parseCredentialFromPaste("   ");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("empty");
  });

  it("rejects non-JSON", () => {
    const r = parseCredentialFromPaste("this is not json");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("not_json");
      expect(r.detail).toBeTruthy();
    }
  });

  it("rejects a JSON value that is not an object", () => {
    const r = parseCredentialFromPaste("[1,2,3]");
    // arrays parse but the @context check trips next; either is acceptable.
    expect(r.ok).toBe(false);
  });

  it("rejects when @context is missing", () => {
    const c = fixtureCredential() as Record<string, unknown>;
    delete c["@context"];
    const r = parseCredentialFromPaste(JSON.stringify(c));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_context");
  });

  it("rejects when @context first entry is wrong", () => {
    const c = { ...fixtureCredential(), "@context": ["https://example.org/wrong"] };
    const r = parseCredentialFromPaste(JSON.stringify(c));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("wrong_context_first");
  });

  it("rejects when type is missing", () => {
    const c = fixtureCredential() as Record<string, unknown>;
    delete c.type;
    const r = parseCredentialFromPaste(JSON.stringify(c));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_type");
  });

  it("rejects when type does not include EvenKeelAttestationCredential", () => {
    const c = { ...fixtureCredential(), type: ["VerifiableCredential"] };
    const r = parseCredentialFromPaste(JSON.stringify(c));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("wrong_type");
  });

  it("rejects when type does not include VerifiableCredential", () => {
    const c = { ...fixtureCredential(), type: ["EvenKeelAttestationCredential"] };
    const r = parseCredentialFromPaste(JSON.stringify(c));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("wrong_type");
  });

  it("rejects when credentialSubject is missing", () => {
    const c = fixtureCredential() as Record<string, unknown>;
    delete c.credentialSubject;
    const r = parseCredentialFromPaste(JSON.stringify(c));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_credential_subject");
  });

  it("rejects when proof is missing", () => {
    const c = fixtureCredential() as Record<string, unknown>;
    delete c.proof;
    const r = parseCredentialFromPaste(JSON.stringify(c));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_proof");
  });
});

// ─── extractEncodedListFromPaste ───────────────────────────────────────────

describe("extractEncodedListFromPaste", () => {
  it("returns the raw string when input does not start with {", () => {
    const r = extractEncodedListFromPaste("H4sIAAAAAAAAA-some-base64url");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("H4sIAAAAAAAAA-some-base64url");
  });

  it("trims surrounding whitespace from a raw string", () => {
    const r = extractEncodedListFromPaste("  H4sIAAAAAAAAA  \n");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("H4sIAAAAAAAAA");
  });

  it("returns empty when input is whitespace only", () => {
    const r = extractEncodedListFromPaste("   ");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("empty");
  });

  it("digs encodedList out of a StatusList2021Credential JSON", () => {
    const sl = {
      "@context": ["https://www.w3.org/ns/credentials/v2"],
      type: ["VerifiableCredential", "StatusList2021Credential"],
      credentialSubject: {
        id: "https://issuer/sl/1#list",
        type: "StatusList2021",
        statusPurpose: "revocation",
        encodedList: "H4sIAAAAAAAAA-extracted-from-json",
      },
    };
    const r = extractEncodedListFromPaste(JSON.stringify(sl));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("H4sIAAAAAAAAA-extracted-from-json");
  });

  it("rejects malformed JSON beginning with {", () => {
    const r = extractEncodedListFromPaste("{ not valid json");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_json");
  });

  it("rejects JSON without credentialSubject.encodedList", () => {
    const r = extractEncodedListFromPaste('{ "credentialSubject": { "id": "x" } }');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_credential_subject");
  });

  it("rejects JSON without credentialSubject", () => {
    const r = extractEncodedListFromPaste('{ "foo": "bar" }');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_credential_subject");
  });

  it("rejects JSON with empty encodedList", () => {
    const sl = {
      credentialSubject: { id: "x", type: "StatusList2021", encodedList: "" },
    };
    const r = extractEncodedListFromPaste(JSON.stringify(sl));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_credential_subject");
  });
});

// ─── summarizeCredentialForDisplay ─────────────────────────────────────────

describe("summarizeCredentialForDisplay", () => {
  it("flattens the salient fields", () => {
    const s = summarizeCredentialForDisplay(fixtureCredential());
    expect(s.issuer).toBe("did:web:demo.evenkeel.org");
    expect(s.validFrom).toBe("2026-05-11T10:00:00Z");
    expect(s.subjectId).toBe("urn:evenkeel:learner:alex-01");
    expect(s.claim).toBe("DemonstratedMastery");
    expect(s.problemId).toBe("alg-quad-01");
    expect(s.reviewerNote).toBe("Strong reasoning chain.");
    expect(s.specPoints).toHaveLength(1);
    expect(s.specPoints[0]).toEqual({
      framework: "AQA-GCSE-9-1-Maths",
      code: "A18",
      label: "Solve quadratic equations",
    });
  });

  it("evidence digest is truncated to a 16-char prefix", () => {
    const s = summarizeCredentialForDisplay(fixtureCredential());
    expect(s.evidenceContentDigestPrefix).toBe("abcdefghijklmnop");
    expect(s.evidenceContentDigestPrefix.length).toBe(16);
  });

  it("hasRevocationPointer is false when credentialStatus is absent", () => {
    const s = summarizeCredentialForDisplay(fixtureCredential());
    expect(s.hasRevocationPointer).toBe(false);
    expect(s.revocationListUrl).toBe(null);
    expect(s.revocationListIndex).toBe(null);
  });

  it("hasRevocationPointer is true and fields populated when credentialStatus is present", () => {
    const c: VerifiableCredential = {
      ...fixtureCredential(),
      credentialStatus: {
        id: "https://issuer/sl/1#42",
        type: "StatusList2021Entry",
        statusPurpose: "revocation",
        statusListIndex: "42",
        statusListCredential: "https://issuer/sl/1",
      },
    };
    const s = summarizeCredentialForDisplay(c);
    expect(s.hasRevocationPointer).toBe(true);
    expect(s.revocationListUrl).toBe("https://issuer/sl/1");
    expect(s.revocationListIndex).toBe(42);
  });

  it("reviewerNote is null when absent", () => {
    const c = fixtureCredential();
    delete (c.credentialSubject as { reviewerNote?: string }).reviewerNote;
    const s = summarizeCredentialForDisplay(c);
    expect(s.reviewerNote).toBe(null);
  });

  it("specPoints with no label produce label=null", () => {
    const c = fixtureCredential();
    c.credentialSubject.demonstratedSpecPoints = [
      {
        framework: "AQA-GCSE-9-1-Maths",
        code: "A18",
        claimVocabularyVersion: 1,
      },
    ];
    const s = summarizeCredentialForDisplay(c);
    expect(s.specPoints[0]?.label).toBe(null);
  });
});

// ─── describeReason / describePasteReason ──────────────────────────────────

describe("describeReason", () => {
  it("returns a non-empty string for every reason code", () => {
    const reasons = [
      "not_an_object",
      "missing_context",
      "wrong_context",
      "missing_type",
      "wrong_type",
      "missing_issuer",
      "missing_validFrom",
      "missing_credentialSubject",
      "missing_proof",
      "wrong_proof_type",
      "wrong_cryptosuite",
      "wrong_proof_purpose",
      "missing_proof_value",
      "missing_public_key",
      "invalid_spec_point",
      "bad_public_key",
      "bad_signature",
      "verify_threw",
      "credential_revoked",
      "credential_suspended",
      "status_resolver_failed",
      "status_index_out_of_range",
      "wrong_status_list_url",
    ] as const;
    for (const r of reasons) {
      const text = describeReason(r);
      expect(typeof text).toBe("string");
      expect(text.length).toBeGreaterThan(10);
    }
  });

  it("highlights the credential_revoked case with strong wording", () => {
    expect(describeReason("credential_revoked")).toMatch(/REVOKED/);
  });

  it("flags bad_signature as tampering", () => {
    expect(describeReason("bad_signature")).toMatch(/tamper/i);
  });
});

describe("describePasteReason", () => {
  it("returns a non-empty string for every paste reason", () => {
    const reasons = [
      "empty",
      "not_json",
      "not_an_object",
      "missing_context",
      "wrong_context_first",
      "missing_type",
      "wrong_type",
      "missing_credential_subject",
      "missing_proof",
    ] as const;
    for (const r of reasons) {
      const text = describePasteReason(r);
      expect(typeof text).toBe("string");
      expect(text.length).toBeGreaterThan(5);
    }
  });
});
