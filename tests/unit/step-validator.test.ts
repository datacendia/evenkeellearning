// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/step-validator.test.ts
//
// Pins the observable contract of `lib/validation/step-validator.ts`.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";

import { validateDerivation } from "@/lib/validation/step-validator";

describe("validateDerivation", () => {
  it("accepts a clean linear-equation derivation", () => {
    const report = validateDerivation(
      [
        "2x + 5 = 17",
        "2x = 12",
        "x = 6",
      ].join("\n"),
    );
    expect(report.allValid).toBe(true);
    expect(report.firstProblemLine).toBeNull();
    expect(report.steps.map((s) => s.status)).toEqual(["first", "valid", "valid"]);
  });

  it("accepts an expanded-then-factored derivation", () => {
    const report = validateDerivation(
      [
        "(x + 1)(x + 2) = 0",
        "x^2 + 3*x + 2 = 0",
      ].join("\n"),
    );
    expect(report.allValid).toBe(true);
  });

  it("flags the exact line where a sign flip is introduced", () => {
    const report = validateDerivation(
      [
        "2x + 5 = 17",
        "2x = 12",
        "x = -6", // illegal: divided and also flipped sign
      ].join("\n"),
    );
    expect(report.allValid).toBe(false);
    expect(report.firstProblemLine).toBe(3);
    expect(report.steps[2]!.status).toBe("invalid");
    expect(report.hint).toContain("line 3");
    // Information-leakage pin: the hint must not reveal the expected
    // numeric value or its sign.
    expect(report.hint).not.toMatch(/6|-6/);
  });

  it("flags an unparseable line and stops caring about subsequent moves", () => {
    const report = validateDerivation(
      [
        "2x + 5 = 17",
        "this is not an equation",
        "x = 6",
      ].join("\n"),
    );
    expect(report.allValid).toBe(false);
    expect(report.firstProblemLine).toBe(2);
    expect(report.steps[1]!.status).toBe("unparseable");
    expect(report.hint).toContain("line 2");
    expect(report.hint).toMatch(/can't read|equation/i);
  });

  it("handles blank lines and extra whitespace cleanly", () => {
    const report = validateDerivation(
      [
        "",
        "  2x + 5 = 17  ",
        "",
        "2x = 12",
        "",
        "x = 6",
        "",
      ].join("\n"),
    );
    expect(report.allValid).toBe(true);
    expect(report.steps).toHaveLength(3);
  });

  it("returns an empty report for empty input", () => {
    const report = validateDerivation("");
    expect(report.steps).toEqual([]);
    expect(report.allValid).toBe(false);
    expect(report.firstProblemLine).toBeNull();
  });

  it("checks the final step against an expected bare expression", () => {
    const ok = validateDerivation(
      [
        "2x + 5 = 17",
        "2x = 12",
        "x = 6",
      ].join("\n"),
      { expectedFinal: "6" },
    );
    expect(ok.allValid).toBe(true);
    expect(ok.reachedExpectedFinal).toBe(true);

    const incomplete = validateDerivation(
      [
        "2x + 5 = 17",
        "2x = 12",
      ].join("\n"),
      { expectedFinal: "6" },
    );
    expect(incomplete.allValid).toBe(false);
    expect(incomplete.reachedExpectedFinal).toBe(false);
    expect(incomplete.hint).toMatch(/simplest form|continue|isolating/i);
    expect(incomplete.hint).not.toMatch(/6/);
  });

  it("checks the final step against an expected full equation", () => {
    const report = validateDerivation(
      [
        "2x + 5 = 17",
        "2x = 12",
        "x = 6",
      ].join("\n"),
      { expectedFinal: "x = 6" },
    );
    expect(report.allValid).toBe(true);
    expect(report.reachedExpectedFinal).toBe(true);
  });

  it("normalises `==` to `=` so learners copying from code don't trip it", () => {
    const report = validateDerivation(
      [
        "2x + 5 == 17",
        "x == 6",
      ].join("\n"),
    );
    expect(report.allValid).toBe(true);
  });

  it("never reveals the expected final form in the returned hint", () => {
    const report = validateDerivation(
      [
        "2x + 5 = 17",
        "2x = 12",
      ].join("\n"),
      { expectedFinal: "x = 42" }, // hypothetical wrong expected (test pins leakage discipline, not correctness)
    );
    // The hint must not reveal "42" even if we (as test authors) deliberately
    // provided a misleading expected-final-form.
    expect(report.hint).not.toMatch(/42/);
  });
});
