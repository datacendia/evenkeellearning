import { describe, it, expect } from "vitest";
import {
  getAllParallelProblems,
  getFamilyParallels,
  pickSafeParallel,
  renderParallelMessage,
} from "@/lib/eke/parallel-problems";
import { hintContainsAnswer } from "@/lib/eke/tiered-hints";

describe("parallel-problems: corpus invariants", () => {
  const all = getAllParallelProblems();

  it("the corpus is non-empty", () => {
    expect(all.length).toBeGreaterThan(0);
  });

  it("every entry has a non-empty id, family, problem, workedSolution and finite expectedAnswer", () => {
    for (const p of all) {
      expect(p.id.length).toBeGreaterThan(0);
      expect(p.skillFamily.length).toBeGreaterThan(0);
      expect(p.problem.length).toBeGreaterThan(0);
      expect(p.workedSolution.length).toBeGreaterThan(0);
      expect(Number.isFinite(p.expectedAnswer)).toBe(true);
    }
  });

  it("every id is unique", () => {
    const ids = all.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("the linear-eq-1var family covers the /student demo (multiple distinct expectedAnswers)", () => {
    const fam = getFamilyParallels("linear-eq-1var");
    expect(fam.length).toBeGreaterThanOrEqual(2);
    const distinct = new Set(fam.map((p) => p.expectedAnswer));
    // Distinct expected values across the family give the engine room to
    // pick a leak-safe candidate regardless of the original's answer.
    expect(distinct.size).toBeGreaterThanOrEqual(2);
  });

  it("the linear-eq-1var family does not leak the /student demo expected value (6)", () => {
    // The demo problem has expectedAnswer = 6. At least one parallel in
    // the family must survive the leak guard against "6"; ideally every
    // parallel in the family does.
    const fam = getFamilyParallels("linear-eq-1var");
    const safe = fam.filter(
      (p) =>
        !hintContainsAnswer(`${p.problem}\n${p.workedSolution}`, "6"),
    );
    expect(safe.length).toBeGreaterThanOrEqual(1);
    // Stronger: the corpus is hand-curated. We pin that the entire family
    // is leak-safe for the demo so the cofounder-demo path is stable.
    expect(safe.length).toBe(fam.length);
  });
});

describe("parallel-problems: pickSafeParallel", () => {
  it("returns null for a family with no entries", () => {
    expect(pickSafeParallel("not-a-real-family", 6)).toBeNull();
  });

  it("returns the first entry when no expected value is supplied", () => {
    const fam = getFamilyParallels("linear-eq-1var");
    const picked = pickSafeParallel("linear-eq-1var", null);
    expect(picked).not.toBeNull();
    expect(picked!.id).toBe(fam[0]!.id);
  });

  it("returns the first leak-safe entry when an expected value is supplied", () => {
    const picked = pickSafeParallel("linear-eq-1var", 6);
    expect(picked).not.toBeNull();
    const corpus = `${picked!.problem}\n${picked!.workedSolution}`;
    expect(hintContainsAnswer(corpus, "6")).toBe(false);
  });

  it("rejects every candidate whose worked solution would leak the original's expected value", () => {
    // Pick a family member's own expected as the "original" — by
    // construction at least that one member's worked solution writes its
    // own answer, so the engine must skip it. We don't pin a specific id
    // because the safe pick depends on the corpus order; we pin only the
    // structural guarantee: whatever is returned does not contain the
    // original expected.
    const fam = getFamilyParallels("linear-eq-1var");
    for (const original of fam) {
      const picked = pickSafeParallel("linear-eq-1var", original.expectedAnswer);
      if (picked) {
        const corpus = `${picked.problem}\n${picked.workedSolution}`;
        expect(hintContainsAnswer(corpus, String(original.expectedAnswer))).toBe(
          false,
        );
      }
      // It's acceptable to return null if no candidate survives the
      // guard — the engine then falls back to the "every hint" line.
    }
  });

  it("returns null when no entry in the family survives the leak guard", () => {
    // Force a guard hit by passing a value that appears literally in
    // every parallel of the family. The digits "2" or "4" appear in
    // most worked solutions; "1" appears via "Step 1." in every entry.
    const picked = pickSafeParallel("linear-eq-1var", 1);
    expect(picked).toBeNull();
  });
});

describe("parallel-problems: renderParallelMessage", () => {
  it("includes the parallel's problem statement and worked solution", () => {
    const fam = getFamilyParallels("linear-eq-1var");
    const rendered = renderParallelMessage(fam[0]!);
    expect(rendered).toContain(fam[0]!.problem);
    expect(rendered).toContain(fam[0]!.workedSolution);
  });

  it("frames the parallel as a sister problem, not the original", () => {
    const fam = getFamilyParallels("linear-eq-1var");
    const rendered = renderParallelMessage(fam[0]!);
    expect(rendered.toLowerCase()).toContain("sister problem");
  });
});
