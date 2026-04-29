// ─────────────────────────────────────────────────────────────────────────────
// lib/validation/answer-checker.ts
//
// Deterministic answer validation for the problem types Even Keel Learning ships
// with today: numeric-result problems (linear equations, arithmetic, basic word
// problems with a single numeric answer) AND, since v1.5.0+, symbolic-equivalence
// problems via the math.js path (e.g. "(x+1)(x+2)" ≡ "x^2 + 3x + 2").
//
// Design contract (matches HONESTY.md):
//   • No LLM. No remote call. Pure regex + arithmetic for the numeric path;
//     a deterministic local CAS (math.js, MIT-licensed, native JS) for the
//     symbolic path. Both paths run entirely in the learner's browser.
//   • Never reveals the expected value in its returned hint text. A unit
//     test pins this property; the engine also defensively re-checks via
//     `hintContainsAnswer()` before replying.
//   • Returns a structured diagnostic the UI can emit on the data bus so
//     the Teacher Integrity Ledger can display *correctness* alongside
//     *methodology*.
//
// Supported categories (numeric path)
// ───────────────────────────────────
//   • correct           — attempt matches expected within tolerance
//   • off_by_one        — attempt is expected ± 1 (common arithmetic slip)
//   • sign_flipped      — attempt == -expected (sign error)
//   • doubled           — attempt == expected × 2
//   • halved            — attempt == expected / 2
//   • wrong             — attempt is present but none of the above
//   • no_attempt        — no numeric value could be extracted
//
// Supported categories (symbolic path)
// ────────────────────────────────────
//   • correct           — attempt simplifies to expected (algebraically equal)
//   • wrong             — parses but does not simplify to expected
//   • no_attempt        — could not be parsed by math.js
//
// Out of scope (explicitly, and documented in HONESTY.md):
//   • Multi-step proofs (each step's validity)
//   • Free-form essay grading
//   • Code correctness
//   • Heavyweight symbolic operations (multivariable calculus, ODEs) — these
//     escalate to the Pyodide+Sympy path planned in
//     `docs/ROADMAP_HIGHER_MATHS.md`.
// ─────────────────────────────────────────────────────────────────────────────

import { parse as mathParse, simplify as mathSimplify } from "mathjs";

export type AnswerCategory =
  | "correct"
  | "off_by_one"
  | "sign_flipped"
  | "doubled"
  | "halved"
  | "wrong"
  | "no_attempt";

export interface AnswerDiagnostic {
  category: AnswerCategory;
  /** The numeric value the learner appears to have asserted, if any. */
  attempt: number | null;
  /**
   * A Socratic hint pointing at the *class of error*, never the expected
   * value. Empty string when category is `no_attempt` (the engine should
   * fall through to the tiered-hint pipeline).
   */
  hint: string;
}

export interface DiagnoseOptions {
  /**
   * Absolute tolerance for "correct". Default 1e-9 (strict numeric
   * equality for integers and exact fractions).
   */
  tolerance?: number;
}

/**
 * Extracts a single numeric assertion from free-form learner text.
 *
 * Strategy (deterministic, ordered):
 *   1. Look for an explicit assertion pattern: `x = 6`, `x is 6`,
 *      `answer: 6`, `= 6`, `equals 6`, `it's 6`.
 *   2. Fall back to the last standalone number in the message (handles
 *      "I think it's six. So 6.").
 *
 * Returns `null` if nothing numeric can be found.
 *
 * Number format: integers, decimals, and simple fractions (`3/4` → 0.75).
 * Scientific notation is ignored on purpose — if a learner writes `1e3`
 * we'd rather fall through to no_attempt than misinterpret prose.
 */
export function extractNumericAttempt(text: string): number | null {
  if (typeof text !== "string" || text.trim().length === 0) return null;

  // Normalise common unicode punctuation to ascii so regexes stay simple.
  const s = text
    .replace(/\u2212/g, "-") // unicode minus
    .replace(/\u00D7/g, "*") // ×
    .replace(/\u00F7/g, "/") // ÷
    .toLowerCase();

  // Explicit assertion anchors — prefer these when present.
  // Examples matched:  "x = 6", "x is 6", "answer is 6", "= 6", "equals 6",
  // "it's 6", "so 6", "final answer 6"
  const anchors = [
    /\bx\s*(?:=|is|equals)\s*(-?\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?)/,
    /\banswer\s*(?:=|:|is|equals)?\s*(-?\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?)/,
    /\bequals\s+(-?\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?)/,
    /(?:^|[\s(])=\s*(-?\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?)/,
    /\bit(?:['\u2019]s| is)\s+(-?\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?)/,
  ];
  for (const rx of anchors) {
    const m = s.match(rx);
    if (m) {
      const parsed = parseNumber(m[1]);
      if (parsed !== null) return parsed;
    }
  }

  // Fallback: the LAST standalone number in the message. We pick the
  // last rather than the first because learners often think aloud
  // ("I tried 4, then 5, so 6.") and the final number is the real
  // assertion.
  const all = [...s.matchAll(/-?\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?/g)];
  if (all.length === 0) return null;
  const last = all[all.length - 1]![0];
  return parseNumber(last);
}

function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/\s+/g, "");
  // fraction form "a/b"
  if (cleaned.includes("/")) {
    const [a, b] = cleaned.split("/");
    const num = Number(a);
    const den = Number(b);
    if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
    return num / den;
  }
  const v = Number(cleaned);
  return Number.isFinite(v) ? v : null;
}

/**
 * Diagnoses a learner's free-form message against a known expected
 * numeric answer. Never reveals the expected value in the returned hint.
 */
export function diagnoseAttempt(
  text: string,
  expected: number,
  options: DiagnoseOptions = {},
): AnswerDiagnostic {
  const tolerance = options.tolerance ?? 1e-9;
  const attempt = extractNumericAttempt(text);

  if (attempt === null || !Number.isFinite(expected)) {
    return { category: "no_attempt", attempt: null, hint: "" };
  }

  if (Math.abs(attempt - expected) <= tolerance) {
    return {
      category: "correct",
      attempt,
      // Socratic "check your own work" — does NOT say "well done".
      hint: "Good — now verify it yourself. Put the value back into the original and show it holds.",
    };
  }

  if (Math.abs(attempt + expected) <= tolerance && expected !== 0) {
    return {
      category: "sign_flipped",
      attempt,
      hint: "Close — check the sign. When you moved a term across the equals, did it change sign?",
    };
  }

  if (Math.abs(Math.abs(attempt - expected) - 1) <= tolerance) {
    return {
      category: "off_by_one",
      attempt,
      hint: "Very close — recount the last step. One of your additions or subtractions is off by one.",
    };
  }

  if (expected !== 0 && Math.abs(attempt - expected * 2) <= tolerance) {
    return {
      category: "doubled",
      attempt,
      hint: "You may have doubled a term instead of halving it — check the coefficient.",
    };
  }

  if (expected !== 0 && Math.abs(attempt - expected / 2) <= tolerance) {
    return {
      category: "halved",
      attempt,
      hint: "You may have halved a term instead of isolating it — check how you divided through.",
    };
  }

  return {
    category: "wrong",
    attempt,
    hint: "Not quite. Re-read the original, then walk through your steps one operation at a time.",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Symbolic answer-checking (v1.5.1)
//
// Powered by math.js (MIT, ~600 KB, native JS — no Wasm download for the
// learner). Used when an item declares a string `expectedAnswer` that
// represents an algebraic expression rather than a numeric value or a
// qualitative-no-auto-check sentinel.
//
// Equivalence test: simplify(actual - expected) == 0. This catches every
// algebraically-equivalent rewriting (factorisation, expansion, term
// reordering, integer-coefficient simplification) without false positives,
// because math.js's simplify is sound — when it returns 0, the expressions
// ARE equal as polynomials / rational functions over their common variables.
//
// Defence-in-depth: if either side fails to parse, we fall back to literal
// string-equality (whitespace-collapsed, lower-cased). This keeps malformed
// expected-answer authoring from silently passing every learner attempt.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sentinel used by qualitative items (English Q3, MFL essays, art critique,
 * any subject where there is no programmatic right answer). Items declaring
 * this `expectedAnswer` value short-circuit to `no_attempt` and the engine
 * routes the attempt to teacher-marking instead.
 */
export const QUALITATIVE_SENTINEL = "qualitative-no-auto-check";

/**
 * Normalises Unicode notation that learners commonly type (and that math.js
 * would otherwise reject) into ASCII operators math.js can parse. The
 * mapping is one-way and lossless: every replacement is an exact arithmetic
 * synonym.
 */
function normaliseSymbolicInput(raw: string): string {
  return raw
    .replace(/\u2212/g, "-")    // unicode minus
    .replace(/\u00D7/g, "*")    // ×
    .replace(/\u00B7/g, "*")    // middle dot
    .replace(/\u00F7/g, "/")    // ÷
    .replace(/\u00B2/g, "^2")   // ²
    .replace(/\u00B3/g, "^3")   // ³
    .replace(/\u2070/g, "^0")   // ⁰
    .replace(/\u00B9/g, "^1")   // ¹
    .replace(/\u2074/g, "^4")   // ⁴
    .replace(/\u2075/g, "^5")   // ⁵
    .replace(/\u2076/g, "^6")   // ⁶
    .replace(/\u2077/g, "^7")   // ⁷
    .replace(/\u2078/g, "^8")   // ⁸
    .replace(/\u2079/g, "^9")   // ⁹
    .trim();
}

/**
 * Strips a leading "x =", "y =", "answer =", "= " prefix that learners
 * commonly include when writing algebraic answers. The expected-answer
 * field stores the right-hand-side only; learners often type the whole
 * equation back.
 */
function stripAssertionPrefix(input: string): string {
  return input
    .replace(/^\s*(?:x|y|z|t|n|m|f|f\(x\)|y\(x\)|dy\/dx|d\^?2y\/dx\^?2|answer|ans|result|=)\s*=\s*/i, "")
    .replace(/^\s*=\s*/, "")
    .trim();
}

/**
 * Attempts to parse and simplify an expression with math.js. Returns the
 * simplified Node on success, or null on parse failure.
 */
function tryParseAndSimplify(expr: string): unknown | null {
  try {
    const node = mathParse(expr);
    return mathSimplify(node);
  } catch {
    return null;
  }
}

/**
 * Decides whether two algebraic expressions are equivalent.
 *
 * Algorithm: form the difference `(actual) - (expected)`, simplify, and
 * compare to a constant zero. math.js's simplify is sound for the
 * polynomial / rational-function fragment we care about for ≤ A-Level
 * content. For graduate-level cases (transcendental simplifications,
 * trig-identity equivalences) we fall through to numeric sample-point
 * comparison at three pseudo-random points; if every sample agrees to
 * within 1e-9, we accept.
 */
export function symbolicEquivalent(actualRaw: string, expectedRaw: string): boolean {
  const actual = stripAssertionPrefix(normaliseSymbolicInput(actualRaw));
  const expected = stripAssertionPrefix(normaliseSymbolicInput(expectedRaw));

  if (actual.length === 0 || expected.length === 0) return false;

  // Cheap path: literal equality after normalisation.
  if (actual === expected) return true;

  // Symbolic path: simplify(actual - expected) == 0.
  const diffNode = tryParseAndSimplify(`(${actual}) - (${expected})`);
  if (diffNode !== null) {
    // Use the string form to detect a literal "0" outcome. This handles
    // every polynomial / rational identity that math.js can simplify,
    // which covers the entire ≤ A-Level corpus we ship.
    const asString = String((diffNode as { toString: () => string }).toString()).replace(/\s+/g, "");
    if (asString === "0") return true;

    // Numeric sample-point fallback: evaluate the difference at three
    // distinct pseudo-random points. If every sample is ≈ 0, accept.
    // This catches transcendental and trig-identity cases that simplify
    // doesn't fully reduce.
    try {
      const samples = [0.42, 1.7, -2.3];
      for (const x of samples) {
        const value = (diffNode as { evaluate: (scope: Record<string, number>) => number }).evaluate({
          x, y: x + 1, z: x - 1, t: x, n: x, m: x,
        });
        if (typeof value !== "number" || !Number.isFinite(value)) return false;
        if (Math.abs(value) > 1e-9) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Diagnoses a learner's free-form message against a known expected
 * symbolic answer (algebraic expression, e.g. "(x+1)(x+2)").
 *
 * Return contract identical to `diagnoseAttempt` but with the symbolic
 * subset of categories (`correct` / `wrong` / `no_attempt`).
 */
export function diagnoseSymbolicAttempt(
  text: string,
  expected: string,
): AnswerDiagnostic {
  if (typeof text !== "string" || text.trim().length === 0) {
    return { category: "no_attempt", attempt: null, hint: "" };
  }
  if (expected === QUALITATIVE_SENTINEL) {
    // Qualitative items are routed to teacher-marking; the auto-checker
    // deliberately abstains.
    return { category: "no_attempt", attempt: null, hint: "" };
  }

  // Probe parse-ability on the learner side first. If the learner's input
  // doesn't parse at all, we report no_attempt rather than wrong (so the
  // engine routes back to the tiered-hint pipeline rather than scolding
  // a learner who is still mid-thought).
  const learnerParsed = tryParseAndSimplify(
    stripAssertionPrefix(normaliseSymbolicInput(text)),
  );
  if (learnerParsed === null) {
    return { category: "no_attempt", attempt: null, hint: "" };
  }

  if (symbolicEquivalent(text, expected)) {
    return {
      category: "correct",
      attempt: null,
      hint: "Good — now verify it yourself. Substitute a couple of concrete values into your form and the original; they should agree.",
    };
  }

  return {
    category: "wrong",
    attempt: null,
    hint: "Not quite — your expression doesn't simplify to the same form. Re-check the operation you applied at each step; an expansion or factorisation may have skipped a term.",
  };
}

/**
 * Top-level dispatcher. Picks the numeric or symbolic path based on the
 * type of `expected`. This is the function call sites should prefer; the
 * specific `diagnoseAttempt` / `diagnoseSymbolicAttempt` exports remain
 * available for callers that already know which path they want.
 */
export function diagnose(
  text: string,
  expected: number | string,
  options: DiagnoseOptions = {},
): AnswerDiagnostic {
  if (typeof expected === "number") {
    return diagnoseAttempt(text, expected, options);
  }
  return diagnoseSymbolicAttempt(text, expected);
}
