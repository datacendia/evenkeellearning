import { describe, it, expect } from "vitest";
import { computeCoverage } from "@/lib/curriculum/coverage";
import { buildRegistry } from "@/lib/curriculum/registry";

const REG = buildRegistry([
  {
    id: "F-Alpha",
    name: "Alpha",
    awardingBody: "Body A",
    jurisdiction: "UK-EN",
    yearStart: 7,
    yearEnd: 11,
    specPoints: [
      { code: "A1", label: "first", topic: "Number" },
      { code: "A2", label: "second" },
      { code: "A10", label: "tenth" },
    ],
  },
  {
    id: "F-Beta",
    name: "Beta",
    awardingBody: "Body B",
    jurisdiction: "US",
    yearStart: 0,
    yearEnd: 12,
    specPoints: [{ code: "b1", label: "x" }],
  },
]);

describe("computeCoverage", () => {
  it("computes per-framework totals and ratio", () => {
    const r = computeCoverage(REG, [
      { framework: "F-Alpha", code: "A1", source: "p1/i1" },
      { framework: "F-Alpha", code: "A1", source: "p1/i2" },
      { framework: "F-Alpha", code: "A2", source: "p1/i3" },
      { framework: "F-Beta", code: "b1", source: "p2/i1" },
    ]);
    expect(r.frameworks).toHaveLength(2);
    const alpha = r.frameworks.find((f) => f.framework === "F-Alpha")!;
    expect(alpha.totalSpecPoints).toBe(3);
    expect(alpha.coveredSpecPoints).toBe(2);
    expect(alpha.coverageRatio).toBeCloseTo(2 / 3);
    const beta = r.frameworks.find((f) => f.framework === "F-Beta")!;
    expect(beta.coveredSpecPoints).toBe(1);
    expect(beta.coverageRatio).toBe(1);
  });

  it("authoredCount reflects multiple references to the same spec-point", () => {
    const r = computeCoverage(REG, [
      { framework: "F-Alpha", code: "A1", source: "p1/i1" },
      { framework: "F-Alpha", code: "A1", source: "p1/i2" },
      { framework: "F-Alpha", code: "A1", source: "p1/i3" },
    ]);
    const a1 = r.frameworks
      .find((f) => f.framework === "F-Alpha")!
      .rows.find((row) => row.code === "A1")!;
    expect(a1.authoredCount).toBe(3);
    expect(a1.covered).toBe(true);
  });

  it("collects unknown refs separately, never miscounted as covered", () => {
    const r = computeCoverage(REG, [
      { framework: "F-Alpha", code: "A1", source: "p1/i1" },
      { framework: "F-Alpha", code: "MISSING", source: "p1/i2" },
      { framework: "Unknown", code: "X", source: "p1/i3" },
    ]);
    expect(r.unknownRefs).toEqual([
      { framework: "F-Alpha", code: "MISSING", source: "p1/i2" },
      { framework: "Unknown", code: "X", source: "p1/i3" },
    ]);
    const alpha = r.frameworks.find((f) => f.framework === "F-Alpha")!;
    expect(alpha.coveredSpecPoints).toBe(1);
  });

  it("empty refs → zero covered, full unknown reported, frameworks still listed", () => {
    const r = computeCoverage(REG, []);
    expect(r.unknownRefs).toEqual([]);
    for (const f of r.frameworks) {
      expect(f.coveredSpecPoints).toBe(0);
      expect(f.coverageRatio).toBe(0);
      expect(f.rows.every((row) => row.authoredCount === 0)).toBe(true);
    }
  });

  it("rows are sorted by code with numeric awareness (A1 < A2 < A10)", () => {
    const r = computeCoverage(REG, []);
    const alpha = r.frameworks.find((f) => f.framework === "F-Alpha")!;
    expect(alpha.rows.map((row) => row.code)).toEqual(["A1", "A2", "A10"]);
  });

  it("frameworks are alphabetically ordered by id", () => {
    const r = computeCoverage(REG, []);
    expect(r.frameworks.map((f) => f.framework)).toEqual([
      "F-Alpha",
      "F-Beta",
    ]);
  });
});
