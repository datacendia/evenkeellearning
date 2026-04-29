// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/symbolic-checker.test.ts
//
// Exercises the v1.5.1 symbolic-equivalence path in
// `lib/validation/answer-checker.ts`. The numeric path is covered by the
// existing `tests/unit/answer-checker.test.ts`; this file pins ONLY the
// new behaviour and the dispatcher contract.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";

import {
  diagnose,
  diagnoseSymbolicAttempt,
  QUALITATIVE_SENTINEL,
  symbolicEquivalent,
} from "@/lib/validation/answer-checker";

describe("symbolicEquivalent", () => {
  it("treats expanded and factored forms of the same polynomial as equivalent", () => {
    expect(symbolicEquivalent("(x+1)(x+2)", "x^2 + 3x + 2")).toBe(true);
    expect(symbolicEquivalent("x^2 + 3*x + 2", "(x+1) * (x+2)")).toBe(true);
  });

  it("treats reorderings as equivalent", () => {
    expect(symbolicEquivalent("3x + 2 + x^2", "x^2 + 3x + 2")).toBe(true);
    expect(symbolicEquivalent("2 + x^2 + 3x", "x^2 + 3x + 2")).toBe(true);
  });

  it("rejects expressions that differ by a constant", () => {
    expect(symbolicEquivalent("x^2 + 3x + 2", "x^2 + 3x + 3")).toBe(false);
  });

  it("rejects expressions with the wrong sign", () => {
    expect(symbolicEquivalent("-(x+1)(x+2)", "(x+1)(x+2)")).toBe(false);
  });

  it("normalises Unicode operators and superscripts before comparing", () => {
    // ² → ^2, × → *, − → -
    expect(symbolicEquivalent("x² + 3×x + 2", "(x+1)(x+2)")).toBe(true);
    expect(symbolicEquivalent("x − 1", "x - 1")).toBe(true);
  });

  it("strips a learner's leading 'x =' / 'answer =' prefix", () => {
    expect(symbolicEquivalent("y = 2x + 1", "2x + 1")).toBe(true);
    expect(symbolicEquivalent("answer = (x+1)(x+2)", "x^2 + 3x + 2")).toBe(true);
  });

  it("returns false when either side fails to parse", () => {
    expect(symbolicEquivalent("(((", "x")).toBe(false);
    expect(symbolicEquivalent("x", "@@@")).toBe(false);
  });

  it("returns false for empty inputs", () => {
    expect(symbolicEquivalent("", "x")).toBe(false);
    expect(symbolicEquivalent("x", "")).toBe(false);
  });

  it("recognises trivial trig identities via the numeric-sample fallback", () => {
    // simplify() doesn't reduce sin^2 + cos^2 - 1 to 0 in math.js,
    // but the three-sample numeric fallback does.
    expect(symbolicEquivalent("sin(x)^2 + cos(x)^2", "1")).toBe(true);
  });
});

describe("diagnoseSymbolicAttempt", () => {
  it("returns no_attempt for empty learner input", () => {
    const r = diagnoseSymbolicAttempt("", "x^2 + 3x + 2");
    expect(r.category).toBe("no_attempt");
    expect(r.attempt).toBeNull();
    expect(r.hint).toBe("");
  });

  it("returns no_attempt when the learner's input cannot be parsed", () => {
    const r = diagnoseSymbolicAttempt("(((", "x^2 + 3x + 2");
    expect(r.category).toBe("no_attempt");
  });

  it("abstains for the qualitative sentinel", () => {
    const r = diagnoseSymbolicAttempt("structure shifts at the midpoint", QUALITATIVE_SENTINEL);
    expect(r.category).toBe("no_attempt");
    expect(r.hint).toBe("");
  });

  it("returns correct for an algebraically-equivalent learner answer", () => {
    const r = diagnoseSymbolicAttempt("(x+1)(x+2)", "x^2 + 3x + 2");
    expect(r.category).toBe("correct");
    expect(r.hint).toContain("Substitute");
  });

  it("returns wrong for a parseable but inequivalent expression", () => {
    const r = diagnoseSymbolicAttempt("(x+1)(x+3)", "x^2 + 3x + 2");
    expect(r.category).toBe("wrong");
    expect(r.hint).toMatch(/simplify|factorisation|expansion/i);
  });

  it("never reveals the expected expression in its returned hint text", () => {
    const expected = "x^2 + 3x + 2";
    const wrong = diagnoseSymbolicAttempt("(x+1)(x+3)", expected);
    const correct = diagnoseSymbolicAttempt("(x+1)(x+2)", expected);
    // Neither hint may leak the expected expression or the canonical
    // factored form. (We don't pin the hint content; we pin the
    // information-leakage property.)
    expect(wrong.hint).not.toMatch(/x\^2|x \+ 2|\(x ?\+ ?1\)/);
    expect(correct.hint).not.toMatch(/x\^2|x \+ 2|\(x ?\+ ?1\)/);
  });
});

describe("diagnose dispatcher", () => {
  it("routes a number-typed expected to the numeric path", () => {
    const r = diagnose("the answer is 6", 6);
    expect(r.category).toBe("correct");
    // numeric path returns a populated `attempt`
    expect(r.attempt).toBe(6);
  });

  it("routes a string-typed expected to the symbolic path", () => {
    const r = diagnose("(x+1)(x+2)", "x^2 + 3x + 2");
    expect(r.category).toBe("correct");
    // symbolic path returns null `attempt` (no single numeric value)
    expect(r.attempt).toBeNull();
  });

  it("preserves the numeric off-by-one diagnostic via the dispatcher", () => {
    const r = diagnose("I think 7", 6);
    expect(r.category).toBe("off_by_one");
  });

  it("preserves the qualitative sentinel via the dispatcher", () => {
    const r = diagnose("anything", QUALITATIVE_SENTINEL);
    expect(r.category).toBe("no_attempt");
  });
});
