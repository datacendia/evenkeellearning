// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/curriculum-registry.test.ts
//
// v1.8.0 — Tests for the Phase-A curriculum registry.
//
// COVERAGE
// ────────
//   • Framework lookup: known + unknown
//   • Spec-point lookup: known + unknown framework + unknown code
//   • Registry-wide listing and stats
//   • Skill URI building (deterministic, URI-encoded)
//   • Validation result codes (ok / unknown_framework / unknown_code)
//   • Forward-compat property: registry never rejects a claim, only
//     enriches or marks unknown
//   • Cross-check against shipped content packs: every (framework, code)
//     referenced in `content/packs-raw/*.mjs` must resolve to "ok"
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  CURRICULUM_FRAMEWORKS,
  CURRICULUM_SPEC_POINTS,
  buildSkillUri,
  findFramework,
  findSpecPoint,
  listFrameworks,
  listSpecPointsForFramework,
  registryStats,
  validateAgainstRegistry,
} from "../../lib/curriculum/registry";

describe("curriculum registry — frameworks", () => {
  it("exposes a non-empty framework list", () => {
    expect(CURRICULUM_FRAMEWORKS.length).toBeGreaterThan(0);
  });

  it("returns a framework by id (AQA)", () => {
    const fw = findFramework("AQA-GCSE-9-1-Maths");
    expect(fw).not.toBeNull();
    expect(fw?.name).toContain("AQA");
    expect(fw?.jurisdiction).toBe("GB");
    expect(fw?.subject).toBe("maths");
  });

  it("returns a framework by id (DES)", () => {
    const fw = findFramework("DES-JC-Maths-2024");
    expect(fw).not.toBeNull();
    expect(fw?.jurisdiction).toBe("IE");
  });

  it("returns a framework by id (CCSS)", () => {
    const fw = findFramework("CCSS-Math");
    expect(fw).not.toBeNull();
    expect(fw?.jurisdiction).toBe("US");
  });

  it("returns null for an unknown framework", () => {
    expect(findFramework("MADE-UP-FRAMEWORK")).toBeNull();
  });

  it("framework ids are unique", () => {
    const ids = CURRICULUM_FRAMEWORKS.map((f) => f.id);
    const set = new Set(ids);
    expect(set.size).toBe(ids.length);
  });

  it("framework ids match a stable identifier pattern", () => {
    // Stable identifier: ASCII letters, digits, hyphens.
    const pattern = /^[A-Za-z0-9-]+$/;
    for (const fw of CURRICULUM_FRAMEWORKS) {
      expect(fw.id).toMatch(pattern);
    }
  });

  it("listFrameworks returns all frameworks", () => {
    expect(listFrameworks().length).toBe(CURRICULUM_FRAMEWORKS.length);
  });
});

describe("curriculum registry — spec points", () => {
  it("exposes a non-empty spec-point list", () => {
    expect(CURRICULUM_SPEC_POINTS.length).toBeGreaterThan(0);
  });

  it("returns a spec-point by (framework, code)", () => {
    const sp = findSpecPoint("AQA-GCSE-9-1-Maths", "A18");
    expect(sp).not.toBeNull();
    expect(sp?.label).toContain("quadratic");
  });

  it("returns null for an unknown framework", () => {
    expect(findSpecPoint("FAKE", "A18")).toBeNull();
  });

  it("returns null for an unknown code in a real framework", () => {
    expect(findSpecPoint("AQA-GCSE-9-1-Maths", "Z99")).toBeNull();
  });

  it("listSpecPointsForFramework returns entries for a known framework", () => {
    const list = listSpecPointsForFramework("AQA-GCSE-9-1-Maths");
    expect(list.length).toBeGreaterThan(0);
    for (const sp of list) {
      expect(sp.framework).toBe("AQA-GCSE-9-1-Maths");
    }
  });

  it("listSpecPointsForFramework returns empty array for unknown framework", () => {
    const list = listSpecPointsForFramework("UNKNOWN");
    expect(list).toEqual([]);
  });

  it("spec-point (framework, code) pairs are unique", () => {
    const seen = new Set<string>();
    for (const sp of CURRICULUM_SPEC_POINTS) {
      const k = `${sp.framework}::${sp.code}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });

  it("every spec-point belongs to a registered framework", () => {
    for (const sp of CURRICULUM_SPEC_POINTS) {
      expect(findFramework(sp.framework)).not.toBeNull();
    }
  });

  it("spec-point labels are non-empty", () => {
    for (const sp of CURRICULUM_SPEC_POINTS) {
      expect(sp.label.length).toBeGreaterThan(0);
    }
  });
});

describe("curriculum registry — buildSkillUri", () => {
  it("returns the canonical urn:evenkeel:skill: form", () => {
    expect(buildSkillUri("AQA-GCSE-9-1-Maths", "A18")).toBe(
      "urn:evenkeel:skill:AQA-GCSE-9-1-Maths:A18",
    );
  });

  it("is deterministic for identical inputs", () => {
    expect(buildSkillUri("CCSS-Math", "HSA-REI.B.4.b")).toBe(
      buildSkillUri("CCSS-Math", "HSA-REI.B.4.b"),
    );
  });

  it("URI-encodes framework and code components", () => {
    // Spaces should encode to %20.
    expect(buildSkillUri("X Y", "a b")).toBe("urn:evenkeel:skill:X%20Y:a%20b");
  });

  it("works for codes containing periods (CCSS style)", () => {
    const uri = buildSkillUri("CCSS-Math", "HSA-REI.B.4.b");
    expect(uri).toContain("HSA-REI.B.4.b");
  });
});

describe("curriculum registry — validateAgainstRegistry", () => {
  it("returns ok with enriched data for a known (framework, code)", () => {
    const r = validateAgainstRegistry("AQA-GCSE-9-1-Maths", "A18");
    expect(r.status).toBe("ok");
    expect(r.framework?.id).toBe("AQA-GCSE-9-1-Maths");
    expect(r.specPoint?.code).toBe("A18");
    expect(r.skillUri).toBe("urn:evenkeel:skill:AQA-GCSE-9-1-Maths:A18");
  });

  it("returns unknown_framework when the framework id is not registered", () => {
    const r = validateAgainstRegistry("MADE-UP", "A18");
    expect(r.status).toBe("unknown_framework");
    expect(r.framework).toBeUndefined();
    expect(r.specPoint).toBeUndefined();
  });

  it("returns unknown_code when framework is known but code is not", () => {
    const r = validateAgainstRegistry("AQA-GCSE-9-1-Maths", "Z99");
    expect(r.status).toBe("unknown_code");
    expect(r.framework?.id).toBe("AQA-GCSE-9-1-Maths");
    expect(r.specPoint).toBeUndefined();
  });

  it("never throws on adversarial input", () => {
    expect(() => validateAgainstRegistry("", "")).not.toThrow();
    expect(() => validateAgainstRegistry("a::b", "c::d")).not.toThrow();
  });
});

describe("curriculum registry — stats", () => {
  it("reports matching counts", () => {
    const s = registryStats();
    expect(s.frameworkCount).toBe(CURRICULUM_FRAMEWORKS.length);
    expect(s.specPointCount).toBe(CURRICULUM_SPEC_POINTS.length);
  });
});

describe("curriculum registry — coverage of shipped content packs", () => {
  // Every (framework, code) pair referenced by a shipped content pack
  // should resolve to "ok". This is the registry's reason for existing:
  // verifiers must never see an "unknown" claim coming out of our own
  // content. If this test fails, either the registry needs an entry or
  // a content pack has a typo.
  //
  // These are the pairs grep'd out of `content/packs-raw/*.mjs`.
  const shippedPairs: ReadonlyArray<[string, string]> = [
    // maths.quadratic-eq-1var
    ["AQA-GCSE-9-1-Maths", "A18"],
    ["AQA-GCSE-9-1-Maths", "A19"],
    ["Edexcel-GCSE-9-1-Maths", "2.4"],
    ["Edexcel-GCSE-9-1-Maths", "2.7"],
    ["OCR-GCSE-9-1-Maths", "6.02a"],
    ["OCR-GCSE-9-1-Maths", "6.02b"],
    ["DES-JC-Maths-2024", "AF.4"],
    ["CCSS-Math", "HSA-REI.B.4.b"],
    ["CCSS-Math", "HSA-CED.A.1"],
    // maths.linear-word-problems
    ["AQA-GCSE-9-1-Maths", "A21"],
    ["Edexcel-GCSE-9-1-Maths", "2.5"],
    ["DES-JC-Maths-2024", "AF.1"],
    ["DES-JC-Maths-2024", "AF.2"],
    ["OCR-GCSE-9-1-Maths", "6.05"],
    ["CCSS-Math", "HSA-CED.A.2"],
    // maths.percentages
    ["AQA-GCSE-9-1-Maths", "N12"],
    ["AQA-GCSE-9-1-Maths", "N13"],
    ["AQA-GCSE-9-1-Maths", "R9"],
    ["AQA-GCSE-9-1-Maths", "R16"],
    ["Edexcel-GCSE-9-1-Maths", "1.12"],
    ["Edexcel-GCSE-9-1-Maths", "1.13"],
    ["OCR-GCSE-9-1-Maths", "3.06a"],
    ["OCR-GCSE-9-1-Maths", "3.06b"],
    ["DES-JC-Maths-2024", "N.2"],
    ["CCSS-Math", "6.RP.A.3.c"],
    ["CCSS-Math", "7.RP.A.3"],
    ["CCSS-Math", "HSF-LE.A.2"],
  ];

  it.each(shippedPairs)(
    "registry recognises (%s, %s)",
    (framework, code) => {
      const r = validateAgainstRegistry(framework, code);
      expect(r.status).toBe("ok");
    },
  );
});
