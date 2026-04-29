// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/answer-checker.test.ts
//
// Pin the observable contract of `lib/validation/answer-checker.ts`:
//
//   1. `extractNumericAttempt` finds an assertion in common phrasings
//      ("x = 6", "I think it's 6.", "so 6.", "answer: 6").
//   2. `extractNumericAttempt` returns null when no numeric value is
//      present.
//   3. `diagnoseAttempt` categorises correct, off-by-one, sign-flip,
//      doubled, halved, and wrong — deterministically.
//   4. `diagnoseAttempt` never leaks the expected value through its
//      returned `hint` text — the structural safety guarantee.
//   5. Fractional assertions (`3/4`) and negatives are handled.
//   6. Empty / nonsense input is `no_attempt`, not a crash.
//
// These assertions back the CHANGELOG v1.4.0 entry and the "Answer
// validation" subsection of HONESTY.md.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import {
  diagnoseAttempt,
  extractNumericAttempt,
} from "@/lib/validation/answer-checker";

describe("extractNumericAttempt", () => {
  it("finds an explicit 'x = N' assertion", () => {
    expect(extractNumericAttempt("x = 6")).toBe(6);
    expect(extractNumericAttempt("I think x = 6, finally.")).toBe(6);
  });

  it("finds an 'answer: N' assertion", () => {
    expect(extractNumericAttempt("Answer: 6")).toBe(6);
    expect(extractNumericAttempt("So the answer is 6.")).toBe(6);
  });

  it("falls back to the LAST number in the message", () => {
    // Learner thinks aloud; the last number is the real assertion.
    expect(extractNumericAttempt("I tried 4, then 5, so 6.")).toBe(6);
  });

  it("handles negatives and unicode minus", () => {
    expect(extractNumericAttempt("x = -6")).toBe(-6);
    expect(extractNumericAttempt("x = \u22126")).toBe(-6);
  });

  it("parses simple fractions", () => {
    expect(extractNumericAttempt("x = 3/4")).toBeCloseTo(0.75, 10);
  });

  it("returns null for empty / non-numeric input", () => {
    expect(extractNumericAttempt("")).toBeNull();
    expect(extractNumericAttempt("I'm thinking about it")).toBeNull();
    expect(extractNumericAttempt("   ")).toBeNull();
  });
});

describe("diagnoseAttempt", () => {
  it("categorises a correct answer and offers self-verification", () => {
    const d = diagnoseAttempt("x = 6", 6);
    expect(d.category).toBe("correct");
    expect(d.attempt).toBe(6);
    expect(d.hint).toMatch(/verify|put the value back/i);
  });

  it("categorises off-by-one", () => {
    const d = diagnoseAttempt("x = 7", 6);
    expect(d.category).toBe("off_by_one");
    expect(d.attempt).toBe(7);
  });

  it("categorises a sign flip", () => {
    const d = diagnoseAttempt("x = -6", 6);
    expect(d.category).toBe("sign_flipped");
  });

  it("categorises doubled and halved", () => {
    expect(diagnoseAttempt("x = 12", 6).category).toBe("doubled");
    expect(diagnoseAttempt("x = 3", 6).category).toBe("halved");
  });

  it("categorises plainly wrong", () => {
    const d = diagnoseAttempt("x = 42", 6);
    expect(d.category).toBe("wrong");
    expect(d.attempt).toBe(42);
  });

  it("returns no_attempt when the message has no number", () => {
    const d = diagnoseAttempt("I'm still thinking.", 6);
    expect(d.category).toBe("no_attempt");
    expect(d.attempt).toBeNull();
    expect(d.hint).toBe("");
  });

  it("never leaks the expected value in the hint string", () => {
    // Brute-force check: for every category the engine can emit, the
    // expected numeric value must NOT appear verbatim in the hint. This
    // is the structural safety guarantee that we surface to schools.
    const expected = 6;
    const messages = [
      "x = 6", // correct
      "x = 7", // off_by_one
      "x = -6", // sign_flipped
      "x = 12", // doubled
      "x = 3", // halved
      "x = 42", // wrong
    ];
    for (const m of messages) {
      const d = diagnoseAttempt(m, expected);
      expect(d.hint).not.toMatch(new RegExp(`\\b${expected}\\b`));
    }
  });

  it("treats non-finite expected as no_attempt (safe default)", () => {
    const d = diagnoseAttempt("x = 6", Number.NaN);
    expect(d.category).toBe("no_attempt");
  });
});
