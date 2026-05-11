import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  REGISTRY_SCHEMA_VERSION,
  SKILL_URI_BASE,
  buildFramework,
  buildRegistry,
  crossValidateAgainstRegistry,
  lookupSpecPoint,
  resolveSkillUri,
  uriFor,
  type CurriculumRegistry,
  type FrameworkInput,
} from "@/lib/curriculum/registry";

// ─── uriFor ────────────────────────────────────────────────────────────────

describe("uriFor", () => {
  it("slugs the framework and percent-encodes the code", () => {
    expect(uriFor("AQA-GCSE-9-1-Maths", "A18")).toBe(
      "https://evenkeel.org/curricula/aqa-gcse-9-1-maths/A18",
    );
  });

  it("preserves casing in the code (semantic)", () => {
    expect(uriFor("CCSS-Math", "HSA-REI.B.4.b")).toBe(
      "https://evenkeel.org/curricula/ccss-math/HSA-REI.B.4.b",
    );
  });

  it("collapses runs of non-alphanumeric chars in the framework", () => {
    expect(uriFor("Edexcel  --  GCSE !! Maths", "1.3")).toBe(
      "https://evenkeel.org/curricula/edexcel-gcse-maths/1.3",
    );
  });

  it("uses the documented base", () => {
    expect(SKILL_URI_BASE).toBe("https://evenkeel.org/curricula");
  });
});

// ─── buildFramework / buildRegistry ────────────────────────────────────────

describe("buildFramework", () => {
  function input(over: Partial<FrameworkInput> = {}): FrameworkInput {
    return {
      id: "TEST-Framework",
      name: "Test Framework",
      awardingBody: "Test Body",
      jurisdiction: "UK-EN",
      yearStart: 7,
      yearEnd: 11,
      specPoints: [
        { code: "A1", label: "First spec point" },
        { code: "A2", label: "Second", topic: "Algebra" },
      ],
      ...over,
    };
  }

  it("populates skillUri on every spec-point", () => {
    const f = buildFramework(input());
    expect(f.specPoints).toHaveLength(2);
    expect(f.specPoints[0]?.skillUri).toBe(
      "https://evenkeel.org/curricula/test-framework/A1",
    );
    expect(f.specPoints[1]?.skillUri).toBe(
      "https://evenkeel.org/curricula/test-framework/A2",
    );
  });

  it("threads framework id back onto each spec-point", () => {
    const f = buildFramework(input());
    for (const sp of f.specPoints) {
      expect(sp.framework).toBe("TEST-Framework");
    }
  });

  it("throws on duplicate codes within a framework", () => {
    expect(() =>
      buildFramework(
        input({
          specPoints: [
            { code: "X", label: "first" },
            { code: "X", label: "second" },
          ],
        }),
      ),
    ).toThrow(/duplicate_code/);
  });

  it("preserves optional topic + references", () => {
    const f = buildFramework(
      input({
        specPoints: [
          {
            code: "A1",
            label: "x",
            topic: "Number",
            references: ["https://example.org/spec#a1"],
          },
        ],
      }),
    );
    expect(f.specPoints[0]?.topic).toBe("Number");
    expect(f.specPoints[0]?.references).toEqual([
      "https://example.org/spec#a1",
    ]);
  });
});

describe("buildRegistry", () => {
  it("composes multiple frameworks keyed by id", () => {
    const reg = buildRegistry([
      {
        id: "F1",
        name: "F1",
        awardingBody: "X",
        jurisdiction: "UK-EN",
        yearStart: 0,
        yearEnd: 0,
        specPoints: [{ code: "a", label: "x" }],
      },
      {
        id: "F2",
        name: "F2",
        awardingBody: "Y",
        jurisdiction: "US",
        yearStart: 0,
        yearEnd: 0,
        specPoints: [{ code: "b", label: "y" }],
      },
    ]);
    expect(reg.schemaVersion).toBe(REGISTRY_SCHEMA_VERSION);
    expect(Object.keys(reg.frameworks)).toEqual(["F1", "F2"]);
  });

  it("throws on duplicate framework ids", () => {
    const dup = {
      id: "F1",
      name: "F1",
      awardingBody: "X",
      jurisdiction: "UK-EN",
      yearStart: 0,
      yearEnd: 0,
      specPoints: [{ code: "a", label: "x" }],
    };
    expect(() => buildRegistry([dup, dup])).toThrow(/duplicate_framework_id/);
  });
});

// ─── lookup / resolveSkillUri ──────────────────────────────────────────────

describe("lookupSpecPoint / resolveSkillUri", () => {
  const reg = buildRegistry([
    {
      id: "F1",
      name: "F1",
      awardingBody: "X",
      jurisdiction: "UK-EN",
      yearStart: 0,
      yearEnd: 0,
      specPoints: [{ code: "a1", label: "x" }],
    },
  ]);

  it("finds an existing spec-point", () => {
    const sp = lookupSpecPoint(reg, "F1", "a1");
    expect(sp).not.toBe(null);
    expect(sp?.skillUri).toBe("https://evenkeel.org/curricula/f1/a1");
  });

  it("returns null for unknown framework", () => {
    expect(lookupSpecPoint(reg, "F99", "a1")).toBe(null);
    expect(resolveSkillUri(reg, "F99", "a1")).toBe(null);
  });

  it("returns null for unknown code", () => {
    expect(lookupSpecPoint(reg, "F1", "missing")).toBe(null);
    expect(resolveSkillUri(reg, "F1", "missing")).toBe(null);
  });

  it("is case-sensitive on code", () => {
    expect(lookupSpecPoint(reg, "F1", "A1")).toBe(null);
    expect(lookupSpecPoint(reg, "F1", "a1")).not.toBe(null);
  });
});

// ─── crossValidateAgainstRegistry ──────────────────────────────────────────

describe("crossValidateAgainstRegistry", () => {
  const reg = buildRegistry([
    {
      id: "F1",
      name: "F1",
      awardingBody: "X",
      jurisdiction: "UK-EN",
      yearStart: 0,
      yearEnd: 0,
      specPoints: [
        { code: "a", label: "x" },
        { code: "b", label: "y" },
      ],
    },
  ]);

  it("counts known and reports unknowns", () => {
    const r = crossValidateAgainstRegistry(reg, [
      { framework: "F1", code: "a", source: "pack-1/item-1" },
      { framework: "F1", code: "missing", source: "pack-1/item-2" },
      { framework: "F2", code: "z", source: "pack-2/item-1" },
      { framework: "F1", code: "b", source: "pack-2/item-2" },
    ]);
    expect(r.knownCount).toBe(2);
    expect(r.unknown).toEqual([
      { framework: "F1", code: "missing", source: "pack-1/item-2" },
      { framework: "F2", code: "z", source: "pack-2/item-1" },
    ]);
  });

  it("returns empty when every ref is known", () => {
    const r = crossValidateAgainstRegistry(reg, [
      { framework: "F1", code: "a", source: "x" },
      { framework: "F1", code: "b", source: "y" },
    ]);
    expect(r.knownCount).toBe(2);
    expect(r.unknown).toEqual([]);
  });

  it("returns empty when input is empty", () => {
    const r = crossValidateAgainstRegistry(reg, []);
    expect(r.knownCount).toBe(0);
    expect(r.unknown).toEqual([]);
  });
});

// ─── public/curriculum/registry.json self-consistency ──────────────────────

describe("compiled registry.json (public/)", () => {
  it("loads and is structurally valid", () => {
    const raw = readFileSync(
      join(process.cwd(), "public", "curriculum", "registry.json"),
      "utf8",
    );
    const reg = JSON.parse(raw) as CurriculumRegistry;
    expect(reg.schemaVersion).toBe(REGISTRY_SCHEMA_VERSION);
    expect(typeof reg.generatedAtIso).toBe("string");
    expect(Object.keys(reg.frameworks).length).toBeGreaterThan(0);
  });

  it("every spec-point has a well-formed skillUri matching uriFor()", () => {
    const reg = JSON.parse(
      readFileSync(
        join(process.cwd(), "public", "curriculum", "registry.json"),
        "utf8",
      ),
    ) as CurriculumRegistry;
    for (const f of Object.values(reg.frameworks)) {
      for (const sp of f.specPoints) {
        expect(sp.framework).toBe(f.id);
        expect(sp.skillUri).toBe(uriFor(sp.framework, sp.code));
      }
    }
  });

  it("includes every framework referenced by content/packs-raw/*", () => {
    const reg = JSON.parse(
      readFileSync(
        join(process.cwd(), "public", "curriculum", "registry.json"),
        "utf8",
      ),
    ) as CurriculumRegistry;
    const required = [
      "AQA-GCSE-9-1-Maths",
      "Edexcel-GCSE-9-1-Maths",
      "OCR-GCSE-9-1-Maths",
      "DES-JC-Maths-2024",
      "CCSS-Math",
      "NC-KS3-Maths-England",
      "AQA-GCSE-English-Language-8700",
    ];
    for (const id of required) {
      expect(
        reg.frameworks[id],
        `missing framework ${id} in registry`,
      ).toBeDefined();
    }
  });
});
