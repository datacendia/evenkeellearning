import { describe, it, expect } from "vitest";
import {
  validateSpecPointClaim,
  canonicalClaimId,
  claimsEqual,
  withSkillUri,
  CLAIM_VOCABULARY_VERSION,
  type SpecPointClaim,
} from "@/lib/vc/claim-vocabulary";

const valid: SpecPointClaim = {
  framework: "AQA-GCSE-9-1-Maths",
  code: "A18",
  claimVocabularyVersion: 1,
};

describe("validateSpecPointClaim", () => {
  it("accepts a minimal valid claim", () => {
    const r = validateSpecPointClaim(valid);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.claim).toEqual(valid);
  });

  it("accepts a claim with optional label and skillUri", () => {
    const r = validateSpecPointClaim({
      ...valid,
      label: "Solving quadratic equations",
      skillUri: "https://registry.example.org/aqa/A18",
    });
    expect(r.ok).toBe(true);
  });

  it("accepts did: and urn: schemes for skillUri", () => {
    const r1 = validateSpecPointClaim({
      ...valid,
      skillUri: "did:web:registry.example.org:aqa:A18",
    });
    const r2 = validateSpecPointClaim({
      ...valid,
      skillUri: "urn:isbn:0451450523",
    });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
  });

  it("rejects non-object input", () => {
    expect(validateSpecPointClaim(null).ok).toBe(false);
    expect(validateSpecPointClaim("string").ok).toBe(false);
    expect(validateSpecPointClaim(42).ok).toBe(false);
  });

  it("rejects missing framework", () => {
    const r = validateSpecPointClaim({ code: "A18", claimVocabularyVersion: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_framework");
  });

  it("rejects empty framework", () => {
    const r = validateSpecPointClaim({ ...valid, framework: "   " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_framework");
  });

  it("rejects missing code", () => {
    const r = validateSpecPointClaim({
      framework: "X",
      claimVocabularyVersion: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_code");
  });

  it("rejects framework too long", () => {
    const r = validateSpecPointClaim({ ...valid, framework: "x".repeat(100) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("framework_too_long");
  });

  it("rejects code too long", () => {
    const r = validateSpecPointClaim({ ...valid, code: "x".repeat(40) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("code_too_long");
  });

  it("rejects label too long", () => {
    const r = validateSpecPointClaim({ ...valid, label: "x".repeat(200) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("label_too_long");
  });

  it("rejects invalid skillUri", () => {
    const r = validateSpecPointClaim({ ...valid, skillUri: "not a url" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_skill_uri");
  });

  it("rejects non-string skillUri", () => {
    const r = validateSpecPointClaim({ ...valid, skillUri: 42 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_skill_uri");
  });

  it("rejects missing vocabulary version", () => {
    const r = validateSpecPointClaim({ framework: "X", code: "A18" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_vocabulary_version");
  });

  it("rejects non-numeric vocabulary version", () => {
    const r = validateSpecPointClaim({ ...valid, claimVocabularyVersion: "1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_vocabulary_version");
  });

  it("rejects future vocabulary version", () => {
    const r = validateSpecPointClaim({ ...valid, claimVocabularyVersion: 99 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unsupported_vocabulary_version");
  });

  it("accepts a v1 claim when verifier supports v2", () => {
    const r = validateSpecPointClaim(valid, 2);
    expect(r.ok).toBe(true);
  });

  it("rejects a v2 claim when verifier only supports v1", () => {
    const r = validateSpecPointClaim(
      { ...valid, claimVocabularyVersion: 2 },
      1,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unsupported_vocabulary_version");
  });

  it("does not retain attacker-controlled extra properties", () => {
    const r = validateSpecPointClaim({
      ...valid,
      __proto__: { malicious: true },
      extraField: "ignored",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.claim).sort()).toEqual([
        "claimVocabularyVersion",
        "code",
        "framework",
      ]);
    }
  });
});

describe("canonicalClaimId", () => {
  it("produces stable framework::code identity", () => {
    expect(canonicalClaimId(valid)).toBe("AQA-GCSE-9-1-Maths::A18");
  });

  it("is invariant under label change", () => {
    const id1 = canonicalClaimId({ ...valid, label: "one label" });
    const id2 = canonicalClaimId({ ...valid, label: "different label" });
    expect(id1).toBe(id2);
  });

  it("is invariant under skillUri back-fill", () => {
    const id1 = canonicalClaimId(valid);
    const id2 = canonicalClaimId(withSkillUri(valid, "https://x.test/a18"));
    expect(id1).toBe(id2);
  });
});

describe("claimsEqual", () => {
  it("compares only on framework + code", () => {
    expect(
      claimsEqual(valid, { ...valid, label: "other", skillUri: "https://x.test" }),
    ).toBe(true);
  });

  it("returns false for different code", () => {
    expect(claimsEqual(valid, { ...valid, code: "A19" })).toBe(false);
  });

  it("returns false for different framework", () => {
    expect(claimsEqual(valid, { ...valid, framework: "CCSS-Math" })).toBe(false);
  });
});

describe("withSkillUri", () => {
  it("returns a new object with the URI set", () => {
    const out = withSkillUri(valid, "https://registry.test/a18");
    expect(out.skillUri).toBe("https://registry.test/a18");
    expect(out).not.toBe(valid);
    expect(valid.skillUri).toBeUndefined();
  });

  it("preserves the label when present", () => {
    const labeled = { ...valid, label: "Quadratics" };
    const out = withSkillUri(labeled, "https://x.test/a");
    expect(out.label).toBe("Quadratics");
  });
});

describe("CLAIM_VOCABULARY_VERSION", () => {
  it("is 1 in this release", () => {
    expect(CLAIM_VOCABULARY_VERSION).toBe(1);
  });
});
