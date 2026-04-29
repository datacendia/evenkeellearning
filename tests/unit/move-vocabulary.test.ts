// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/move-vocabulary.test.ts
//
// Pins:
//   1. parseMoveText recognises the documented phrasings.
//   2. stripMoveAnnotation correctly separates equation from annotation
//      across pipe / arrow / parenthetical styles, and never strips a
//      maths-internal `(x+1)` parenthesis.
//   3. verifyMove returns `ok` when the stated move matches the actual
//      transformation, and a structured mismatch otherwise.
//   4. The full validateDerivation pipeline correctly:
//      - accepts `2x = 12 | divide by 2 → x = 6`,
//      - flags `2x = 12 | multiply by 2 → x = 6` as `move-mismatch`
//        (relation preserved, but the verb is wrong),
//      - flags `2x = 12 | divide by 3 → x = 6` as `move-mismatch`
//        (the operand is wrong, even though the kind is right).
//   5. Hints surfaced for move mismatches never echo the expected
//      operand or the right answer (information-leakage pin).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";

import {
  parseMoveText,
  stripMoveAnnotation,
  verifyMove,
} from "@/lib/validation/move-vocabulary";
import { validateDerivation } from "@/lib/validation/step-validator";

describe("parseMoveText", () => {
  it("recognises additive moves", () => {
    expect(parseMoveText("add 5")?.op).toBe("add");
    expect(parseMoveText("plus 5")?.op).toBe("add");
    expect(parseMoveText("+5")?.op).toBe("add");
    expect(parseMoveText("subtract 5")?.op).toBe("sub");
    expect(parseMoveText("minus 5")?.op).toBe("sub");
    expect(parseMoveText("take 5")?.op).toBe("sub");
    expect(parseMoveText("-5")?.op).toBe("sub");
  });

  it("recognises multiplicative moves", () => {
    expect(parseMoveText("multiply by 2")?.op).toBe("mul");
    expect(parseMoveText("times 2")?.op).toBe("mul");
    expect(parseMoveText("×2")?.op).toBe("mul");
    expect(parseMoveText("*2")?.op).toBe("mul");
    expect(parseMoveText("divide by 2")?.op).toBe("div");
    expect(parseMoveText("÷2")?.op).toBe("div");
    expect(parseMoveText("/2")?.op).toBe("div");
    expect(parseMoveText("over 2")?.op).toBe("div");
  });

  it("preserves the operand text verbatim", () => {
    expect(parseMoveText("divide by 3/2")?.operand).toBe("3/2");
    expect(parseMoveText("multiply by 2.5")?.operand).toBe("2.5");
  });

  it("recognises no-operand moves (expand / factor / simplify)", () => {
    expect(parseMoveText("expand")?.op).toBe("expand");
    expect(parseMoveText("expanded")?.op).toBe("expand");
    expect(parseMoveText("factor")?.op).toBe("factor");
    expect(parseMoveText("factorise")?.op).toBe("factor");
    expect(parseMoveText("simplify")?.op).toBe("simplify");
    expect(parseMoveText("tidy up")?.op).toBe("simplify");
  });

  it("returns null for unrecognised text", () => {
    expect(parseMoveText("waffle")).toBeNull();
    expect(parseMoveText("")).toBeNull();
    expect(parseMoveText("   ")).toBeNull();
  });

  it("strips trailing 'from both sides' / 'on both sides' boilerplate", () => {
    expect(parseMoveText("subtract 5 from both sides")?.operand).toBe("5");
    expect(parseMoveText("divide by 2 on both sides")?.operand).toBe("2");
  });
});

describe("stripMoveAnnotation", () => {
  it("splits on `|`", () => {
    const r = stripMoveAnnotation("2x = 12 | divide by 2");
    expect(r.equation).toBe("2x = 12");
    expect(r.move?.op).toBe("div");
    expect(r.move?.operand).toBe("2");
  });

  it("splits on trailing parenthetical", () => {
    const r = stripMoveAnnotation("2x = 12  (÷ 2)");
    expect(r.equation).toBe("2x = 12");
    expect(r.move?.op).toBe("div");
  });

  it("does NOT strip a maths-internal parenthesis", () => {
    // `(x+1)(x+2) = 0` must stay intact — the trailing `(x+2)` is
    // part of the maths, not a move annotation.
    const r = stripMoveAnnotation("(x+1)(x+2) = 0");
    expect(r.equation).toBe("(x+1)(x+2) = 0");
    expect(r.move).toBeNull();
  });

  it("splits on arrow `->`", () => {
    const r = stripMoveAnnotation("2x = 12 -> /2");
    expect(r.equation).toBe("2x = 12");
    expect(r.move?.op).toBe("div");
    expect(r.move?.operand).toBe("2");
  });

  it("returns null move when there's no annotation", () => {
    const r = stripMoveAnnotation("2x = 12");
    expect(r.move).toBeNull();
    expect(r.unparseableAnnotation).toBe(false);
  });

  it("flags an annotation present but unparseable", () => {
    const r = stripMoveAnnotation("2x = 12 | totally unrecognised verb");
    expect(r.equation).toBe("2x = 12");
    expect(r.move).toBeNull();
    expect(r.unparseableAnnotation).toBe(true);
  });
});

describe("verifyMove (v1.5.3 lhs/rhs signature)", () => {
  // Canonical test pair: 2x = 12 → x = 6  (divide both sides by 2)
  const prevLhs = "2*x";
  const prevRhs = "12";
  const currLhs = "x";
  const currRhs = "6";

  it("accepts the correct divide-by-2 claim", () => {
    const v = verifyMove(prevLhs, prevRhs, currLhs, currRhs, { op: "div", operand: "2", raw: "÷2" }, ["x"]);
    expect(v.kind).toBe("ok");
  });

  it("rejects a divide-by-3 claim (right kind, wrong operand)", () => {
    const v = verifyMove(prevLhs, prevRhs, currLhs, currRhs, { op: "div", operand: "3", raw: "÷3" }, ["x"]);
    expect(v.kind).toBe("expected-ratio-mismatch");
  });

  it("rejects a multiply-by-2 claim when the learner divided", () => {
    // Both multiply and divide produce constant-ratio diffs, so the
    // algorithm classifies this as `expected-ratio-mismatch` — right
    // family of move, wrong operand. The engine surfaces a "re-check
    // the scaling" hint either way.
    const v = verifyMove(prevLhs, prevRhs, currLhs, currRhs, { op: "mul", operand: "2", raw: "×2" }, ["x"]);
    expect(v.kind).toBe("expected-ratio-mismatch");
  });

  it("rejects an expand claim when the relation actually scaled", () => {
    const v = verifyMove(prevLhs, prevRhs, currLhs, currRhs, { op: "expand", raw: "expand" }, ["x"]);
    expect(v.kind).toBe("no-op-mismatch");
  });

  it("rejects a divide-by-zero operand", () => {
    const v = verifyMove(prevLhs, prevRhs, currLhs, currRhs, { op: "div", operand: "0", raw: "/0" }, ["x"]);
    expect(v.kind).toBe("operand-not-numeric");
  });
});

describe("verifyMove — variable-operand moves (v1.5.3)", () => {
  it("accepts `multiply by x` when both sides were genuinely scaled by x", () => {
    // x = 5  | multiply by x  →  x^2 = 5*x
    const v = verifyMove(
      "x",
      "5",
      "x^2",
      "5*x",
      { op: "mul", operand: "x", raw: "multiply by x" },
      ["x"],
    );
    expect(v.kind).toBe("ok");
  });

  it("rejects `multiply by x` when the learner actually multiplied by 2", () => {
    // x = 5  | claimed: multiply by x  | actually: multiply by 2  →  2x = 10
    const v = verifyMove(
      "x",
      "5",
      "2*x",
      "10",
      { op: "mul", operand: "x", raw: "multiply by x" },
      ["x"],
    );
    expect(v.kind).not.toBe("ok");
  });

  it("accepts `divide by (x+1)` when both sides were genuinely divided by (x+1)", () => {
    // (x+1)*y = 3*(x+1)  | divide by (x+1)  →  y = 3
    const v = verifyMove(
      "(x+1)*y",
      "3*(x+1)",
      "y",
      "3",
      { op: "div", operand: "(x+1)", raw: "divide by (x+1)" },
      ["x", "y"],
    );
    expect(v.kind).toBe("ok");
  });
});

describe("verifyMove — square both sides (v1.5.3)", () => {
  it("accepts a clean squaring", () => {
    // x = 3  | square  →  x^2 = 9
    const v = verifyMove(
      "x",
      "3",
      "x^2",
      "9",
      { op: "square", raw: "square both sides" },
      ["x"],
    );
    expect(v.kind).toBe("ok");
  });

  it("rejects a squaring claim when the learner actually doubled", () => {
    // x = 3  | claimed: square  | actually: x*2 = 6 (wrong move)
    const v = verifyMove(
      "x",
      "3",
      "2*x",
      "6",
      { op: "square", raw: "square both sides" },
      ["x"],
    );
    expect(v.kind).not.toBe("ok");
  });
});

describe("verifyMove — apply-fn moves (v1.5.3)", () => {
  it("accepts `apply log` when both sides have log applied", () => {
    // exp(x) = 5  | apply log  →  x = log(5)
    const v = verifyMove(
      "exp(x)",
      "5",
      "x",
      "log(5)",
      { op: "apply-fn", operand: "log", raw: "take log" },
      ["x"],
    );
    expect(v.kind).toBe("ok");
  });

  it("accepts `apply sin` when both sides have sin applied", () => {
    // x = 1  | apply sin  →  sin(x) = sin(1)
    const v = verifyMove(
      "x",
      "1",
      "sin(x)",
      "sin(1)",
      { op: "apply-fn", operand: "sin", raw: "apply sin" },
      ["x"],
    );
    expect(v.kind).toBe("ok");
  });

  it("rejects `apply log` when the learner actually applied sin", () => {
    const v = verifyMove(
      "exp(x)",
      "5",
      "sin(exp(x))",
      "sin(5)",
      { op: "apply-fn", operand: "log", raw: "take log" },
      ["x"],
    );
    expect(v.kind).not.toBe("ok");
  });

  it("rejects an unsupported function operand", () => {
    const v = verifyMove(
      "x",
      "1",
      "f(x)",
      "f(1)",
      { op: "apply-fn", operand: "wormhole", raw: "apply wormhole" },
      ["x"],
    );
    expect(v.kind).toBe("operand-not-numeric");
  });
});

describe("parseMoveText — v1.5.3 vocabulary", () => {
  it("recognises `square both sides`", () => {
    expect(parseMoveText("square both sides")?.op).toBe("square");
    expect(parseMoveText("squared")?.op).toBe("square");
  });

  it("recognises `take log`, `take ln`, `apply sin`", () => {
    expect(parseMoveText("take log")?.op).toBe("apply-fn");
    expect(parseMoveText("take log")?.operand).toBe("log");
    expect(parseMoveText("take ln")?.operand).toBe("log"); // ln normalised
    expect(parseMoveText("apply sin")?.operand).toBe("sin");
    expect(parseMoveText("sin both sides")?.operand).toBe("sin");
  });

  it("rejects an unsupported function name", () => {
    expect(parseMoveText("apply wormhole")).toBeNull();
  });

  it("recognises a variable-operand multiplication", () => {
    const m = parseMoveText("multiply by x");
    expect(m?.op).toBe("mul");
    expect(m?.operand).toBe("x");
  });
});

describe("validateDerivation with move annotations", () => {
  it("accepts annotated valid moves end-to-end", () => {
    const r = validateDerivation(
      [
        "2x + 5 = 17",
        "2x = 12 | -5",
        "x = 6 | divide by 2",
      ].join("\n"),
    );
    expect(r.allValid).toBe(true);
    expect(r.steps[1]!.move?.op).toBe("sub");
    expect(r.steps[2]!.move?.op).toBe("div");
    expect(r.steps[2]!.moveCheck?.kind).toBe("ok");
  });

  it("flags `multiply by 2` when the learner actually divided", () => {
    const r = validateDerivation(
      [
        "2x = 12",
        "x = 6 | multiply by 2",
      ].join("\n"),
    );
    expect(r.allValid).toBe(false);
    expect(r.steps[1]!.status).toBe("move-mismatch");
    expect(r.hint).toContain("line 2");
    expect(r.hint).toMatch(/multiply|scaling/i);
    // Information-leakage pin: never echo the right operand.
    expect(r.hint).not.toMatch(/\b2\b.*divide|divide.*\b2\b/);
  });

  it("flags `divide by 3` when the learner actually divided by 2", () => {
    const r = validateDerivation(
      [
        "2x = 12",
        "x = 6 | divide by 3",
      ].join("\n"),
    );
    expect(r.allValid).toBe(false);
    expect(r.steps[1]!.status).toBe("move-mismatch");
    expect(r.hint).toContain("line 2");
    // The right operand (2) must not appear in the hint as an operand.
    // ("line 2" is the line number, which is unavoidable.)
    expect(r.hint).not.toMatch(/by\s*2\b/);
    expect(r.hint).not.toMatch(/\bdivide.*\b2\b/);
  });

  it("does NOT flag a step with no annotation", () => {
    const r = validateDerivation(
      [
        "2x = 12",
        "x = 6",
      ].join("\n"),
    );
    expect(r.allValid).toBe(true);
    expect(r.steps[1]!.move).toBeUndefined();
  });

  it("strips parenthetical annotations before equation parsing", () => {
    const r = validateDerivation(
      [
        "2x = 12",
        "x = 6  (÷ 2)",
      ].join("\n"),
    );
    expect(r.allValid).toBe(true);
    expect(r.steps[1]!.move?.op).toBe("div");
  });

  it("preserves a maths-internal `(x+1)` parenthesis (no false annotation strip)", () => {
    const r = validateDerivation(
      [
        "(x+1)(x+2) = 0",
        "x^2 + 3*x + 2 = 0",
      ].join("\n"),
    );
    expect(r.allValid).toBe(true);
  });

  it("hint for a wrong-operand mismatch never echoes the right answer", () => {
    const r = validateDerivation(
      [
        "3x = 21",
        "x = 7 | divide by 5",
      ].join("\n"),
    );
    expect(r.allValid).toBe(false);
    // Both 3 (right operand) and 7 (right answer) must be absent.
    expect(r.hint).not.toMatch(/\b3\b/);
    expect(r.hint).not.toMatch(/\b7\b/);
  });
});
