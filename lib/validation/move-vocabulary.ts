// ─────────────────────────────────────────────────────────────────────────────
// lib/validation/move-vocabulary.ts
//
// Move annotation parser + verifier for the v1.5.2 step validator.
//
// Background
// ──────────
// The v1.5.1 validator checks that every step in a derivation preserves
// the solution set. That catches arithmetic slips and sign flips, but
// it does NOT catch the case where a learner *says* one thing and
// *does* another — e.g.:
//
//     2x = 12       | divide by 2
//     x = 24        ← actually multiplied
//
// Both `2x = 12` and `x = 24` have different solutions (so v1.5.1
// would already reject it), but consider a self-consistent fake:
//
//     2x = 12       | multiply by 2     ← claim
//     x = 6         ← actually divided  (still correct, but misnamed)
//
// The v1.5.1 algorithm accepts that — the relation is preserved.
// The annotation, however, is *wrong*. For pedagogical purposes we
// want to flag the mismatch so the learner internalises the correct
// vocabulary.
//
// What this file does
// ───────────────────
// • Strips a move annotation from a learner-written step line.
// • Parses the annotation into a structured Move.
// • Provides `verifyMove(prev, curr, move)` which checks that applying
//   `move` to `prev`'s difference form produces `curr`'s difference
//   form, by sampling at the same irrational seeds the proportionality
//   check uses.
//
// Scope (v1.5.3)
// ──────────────
// • Arithmetic moves with NUMERIC or VARIABLE operands:
//     - add / subtract an expression from both sides
//     - multiply / divide both sides by an expression (incl. variables)
// • Self-applied moves (no operand):
//     - expand / factor / simplify
//     - square both sides
// • Apply-a-function moves with a unary function operand:
//     - take log / take ln, apply sin / cos / tan / exp / sqrt …
// • Out of scope (deferred to v1.5.4+): substitution moves
//   (`let u = …`), case-analysis moves, integration / differentiation
//   moves embedded inside a derivation step. Disclosed in HONESTY.md §4.4.
//
// Architecture note (v1.5.3 rewrite)
// ──────────────────────────────────
// The v1.5.2 verifier compared `prev_diff` and `curr_diff` by computing
// the actual ratio at sample points and matching it to a kind-derived
// constant. That worked for numeric-operand cases but couldn't express
// `multiply by x` (variable ratio) or `apply sin` (no ratio at all).
//
// v1.5.3 takes a different approach: for every move kind, given the
// previous equation `lhs_p = rhs_p` and the move, we CONSTRUCT the
// expected next equation `lhs_e = rhs_e`. We then compare it to what
// the learner actually wrote (`lhs_c = rhs_c`) by the same proportional
// equivalence test the validator uses elsewhere. That handles variable
// operands and irrational moves uniformly.
//
// Trust contract
// ──────────────
// • Pure function. No I/O, no LLM, no network.
// • Hints surfaced by the validator never leak the expected operand —
//   the verifier returns `mismatch` plus a category, the engine
//   composes a Socratic prompt, the prompt never echoes the learner's
//   wrong number back at them in a way that reveals the right one.
// ─────────────────────────────────────────────────────────────────────────────

import { evaluate, parse } from "mathjs";

export type MoveOp =
  | "add"
  | "sub"
  | "mul"
  | "div"
  | "expand"
  | "factor"
  | "simplify"
  | "square"
  | "apply-fn";

/**
 * Whitelist of unary functions the `apply-fn` move accepts. Anything
 * outside this list is rejected by `parseMoveText`. The list mirrors
 * math.js's built-in scalar functions; they all produce well-defined
 * sample-point evaluations, so verifyMove can sanity-check the move.
 */
export const APPLY_FN_WHITELIST: readonly string[] = [
  "sin", "cos", "tan", "asin", "acos", "atan",
  "sinh", "cosh", "tanh",
  "exp", "log", "log10", "log2", "ln",
  "sqrt", "cbrt",
  "abs",
];

/**
 * A parsed move annotation. `operand` is the literal operand text
 * (e.g. `"5"`, `"3/2"`); only present for arithmetic moves.
 */
export interface Move {
  op: MoveOp;
  operand?: string;
  /** The verbatim annotation source for round-trip / error messages. */
  raw: string;
}

/**
 * Result of stripping an annotation off a step line.
 */
export interface StrippedLine {
  /** The equation portion, with annotation removed. */
  equation: string;
  /** Parsed move, or null if no recognisable annotation was present. */
  move: Move | null;
  /** True iff some annotation text was found but couldn't be parsed. */
  unparseableAnnotation: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Splits a step line into its equation and (optional) move annotation.
 *
 * Recognises three annotation styles:
 *   1. Pipe-separated:        `2x = 12 | divide by 2`
 *   2. Trailing parenthesis:  `2x = 12  (÷ 2)`
 *   3. Trailing arrow:        `2x = 12  → /2`
 *
 * The pipe form takes precedence — a line containing both a `|` and
 * a parenthetical is split on the pipe so the parenthetical can carry
 * authored prose ("divide by 2 (both sides)").
 */
export function stripMoveAnnotation(line: string): StrippedLine {
  if (typeof line !== "string") {
    return { equation: "", move: null, unparseableAnnotation: false };
  }
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return { equation: "", move: null, unparseableAnnotation: false };
  }

  // Style 1: pipe.
  const pipeIdx = trimmed.indexOf("|");
  if (pipeIdx !== -1) {
    return splitAt(trimmed, pipeIdx, 1);
  }

  // Style 3: arrow `→` (single char) or `->`.
  const arrowMatch = trimmed.match(/(\s)(?:→|->)\s*/);
  if (arrowMatch && typeof arrowMatch.index === "number") {
    const idx = arrowMatch.index + arrowMatch[1]!.length;
    const skip = arrowMatch[0]!.length - arrowMatch[1]!.length;
    return splitAt(trimmed, idx, skip);
  }

  // Style 2: trailing parenthetical at end-of-line. Only consume if it's
  // truly trailing (avoid stripping a parenthetical that's part of the
  // equation itself, e.g. `(x+1)(x+2) = 0`).
  const parenMatch = trimmed.match(/\s+\(([^()]+)\)\s*$/);
  if (parenMatch) {
    const inside = parenMatch[1]!.trim();
    const move = parseMoveText(inside);
    if (move !== null) {
      return {
        equation: trimmed.slice(0, parenMatch.index!).trim(),
        move,
        unparseableAnnotation: false,
      };
    }
    // Couldn't parse — leave the parenthetical attached to the equation
    // (it's probably part of the maths, e.g. `f(x) = 0`).
  }

  return { equation: trimmed, move: null, unparseableAnnotation: false };
}

function splitAt(line: string, idx: number, skipLen: number): StrippedLine {
  const equation = line.slice(0, idx).trim();
  const annotation = line.slice(idx + skipLen).trim();
  if (annotation.length === 0) {
    return { equation, move: null, unparseableAnnotation: false };
  }
  const move = parseMoveText(annotation);
  return {
    equation,
    move,
    unparseableAnnotation: move === null,
  };
}

/**
 * Parses a free-text annotation into a `Move`. Returns null on failure.
 *
 * Recognised phrasings (case-insensitive, generously whitespace-tolerant):
 *   - `add 5` / `+5` / `plus 5`
 *   - `subtract 5` / `-5` / `minus 5` / `take 5` / `take away 5`
 *   - `multiply by 2` / `×2` / `*2` / `times 2`
 *   - `divide by 2` / `÷2` / `/2` / `over 2`
 *   - `expand` / `expanding` / `expanded`
 *   - `factor` / `factorise` / `factorize` / `factored`
 *   - `simplify` / `simplifying` / `simplified` / `tidy up`
 */
export function parseMoveText(text: string): Move | null {
  if (typeof text !== "string") return null;
  const raw = text.trim();
  if (raw.length === 0) return null;

  // No-operand moves first — fastest match.
  const lower = raw.toLowerCase();
  if (/\b(?:expand(?:ed|ing)?)\b/.test(lower)) return { op: "expand", raw };
  if (/\b(?:factor(?:ed|ise|ize|ising|izing)?|factorise|factorize)\b/.test(lower)) {
    return { op: "factor", raw };
  }
  if (/\b(?:simplif(?:y|ied|ying)|tidy(?:\s+up)?|collect(?:\s+terms)?)\b/.test(lower)) {
    return { op: "simplify", raw };
  }
  // Square both sides (no operand).
  if (/\b(?:square(?:d|s)?(?:\s+both\s+sides)?|both\s+sides\s+squared|\^?\s*2\s+both\s+sides)\b/.test(lower)) {
    return { op: "square", raw };
  }

  // Apply-function moves: `take log`, `take ln`, `apply sin`, `sin both sides`,
  // `log both sides`. Operand is the function name (mathjs identifier).
  // Note `ln` is normalised to `log` — math.js's `log(x)` is the natural log.
  const applyMatch = raw.match(
    /^(?:(?:take|apply)\s+)?([a-zA-Z][a-zA-Z0-9]*)(?:\s+(?:on\s+)?both\s+sides)?$/,
  );
  if (applyMatch) {
    const fn = applyMatch[1]!.toLowerCase();
    const normalised = fn === "ln" ? "log" : fn;
    if (APPLY_FN_WHITELIST.includes(normalised)) {
      return { op: "apply-fn", operand: normalised, raw };
    }
  }

  // Arithmetic. Strategy: a single-pass loop of (regex → op) tuples.
  // Each regex captures the operand in group 1.
  const arith: Array<[RegExp, MoveOp]> = [
    [/^(?:add|plus|\+)\s*(.+?)(?:\s+(?:to|from)\s+both\s+sides)?$/i, "add"],
    [/^(?:subtract|sub|minus|take(?:\s+away)?|−|-)\s*(.+?)(?:\s+from\s+both\s+sides)?$/i, "sub"],
    [/^(?:multiply\s+by|times|×|\*|x|by)\s*(.+?)(?:\s+(?:on\s+)?both\s+sides)?$/i, "mul"],
    [/^(?:divide\s+by|over|÷|\/)\s*(.+?)(?:\s+(?:on\s+)?both\s+sides)?$/i, "div"],
  ];

  for (const [re, op] of arith) {
    const m = raw.match(re);
    if (m) {
      const operand = (m[1] ?? "").trim();
      if (operand.length === 0) continue;
      // Reject obvious non-operand text that slipped through.
      try {
        parse(operand);
      } catch {
        continue;
      }
      return { op, operand, raw };
    }
  }

  // Standalone signed-numeric annotations like `+5` or `-3/2`. Handled
  // by the general add/sub patterns above via the `+` / `-` alternatives.
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Verifier
// ─────────────────────────────────────────────────────────────────────────────

export type MoveVerification =
  | { kind: "ok" }
  | { kind: "operand-not-numeric"; reason: string }
  | { kind: "expected-ratio-mismatch"; expectedKind: MoveOp }
  | { kind: "no-op-mismatch"; expectedKind: MoveOp }
  | { kind: "parse-error"; reason: string };

/**
 * Verifies that the move the learner claimed (`move`) actually
 * transforms `(prevLhs, prevRhs)` into `(currLhs, currRhs)`.
 *
 * Strategy
 * ────────
 * For each move kind we CONSTRUCT the expected next equation
 * `(lhs_e, rhs_e)` from the previous one and the move:
 *
 *   • add k:        lhs_e = prevLhs + k,    rhs_e = prevRhs + k
 *   • sub k:        lhs_e = prevLhs - k,    rhs_e = prevRhs - k
 *   • mul k:        lhs_e = prevLhs * k,    rhs_e = prevRhs * k
 *   • div k:        lhs_e = prevLhs / k,    rhs_e = prevRhs / k
 *   • square:       lhs_e = (prevLhs)^2,    rhs_e = (prevRhs)^2
 *   • apply-fn f:   lhs_e = f(prevLhs),     rhs_e = f(prevRhs)
 *   • expand        lhs_e = prevLhs,        rhs_e = prevRhs
 *   • factor        (these don't change the relation; the learner's
 *   • simplify       working should equal the previous form algebraically)
 *
 * `k` may be a constant or a variable expression (e.g. `multiply by x`).
 *
 * We then compare `(lhs_e - rhs_e)` to `(currLhs - currRhs)` at sample
 * points. The move is `ok` iff the two diff forms match within
 * tolerance with NO scaling — strict scalar equality, not the looser
 * proportionality used for the relation-preservation check.
 *
 * Failure-mode classification:
 *   • If the diffs are proportional but with a constant ratio ≠ 1 →
 *     `expected-ratio-mismatch` (right kind, wrong operand).
 *   • Otherwise (different shape) → `no-op-mismatch`.
 */
export function verifyMove(
  prevLhs: string,
  prevRhs: string,
  currLhs: string,
  currRhs: string,
  move: Move,
  variables: string[],
): MoveVerification {
  // 1. Validate operand for arithmetic moves. Constant operands trip
  //    the divide-by-zero guard; variable operands are accepted as-is
  //    but must parse cleanly.
  if (move.op === "add" || move.op === "sub" || move.op === "mul" || move.op === "div") {
    if (typeof move.operand !== "string" || move.operand.length === 0) {
      return { kind: "operand-not-numeric", reason: "missing operand" };
    }
    let constantValue: number | null = null;
    try {
      const v = Number(evaluate(move.operand));
      if (Number.isFinite(v)) constantValue = v;
    } catch {
      // Not a constant — fall through to the structural-parse check below.
    }
    if (constantValue !== null) {
      if ((move.op === "mul" || move.op === "div") && Math.abs(constantValue) < 1e-12) {
        return {
          kind: "operand-not-numeric",
          reason: "cannot multiply / divide both sides by zero",
        };
      }
    } else {
      // Variable expression: must at least parse.
      try {
        parse(move.operand);
      } catch {
        return {
          kind: "operand-not-numeric",
          reason: `operand "${move.operand}" is not a valid expression`,
        };
      }
    }
  }

  // 2. Build expected (lhs_e, rhs_e). All operations are wrapped in
  //    parentheses so the resulting expression always parses.
  let expectedLhs: string;
  let expectedRhs: string;
  switch (move.op) {
    case "add":
      expectedLhs = `(${prevLhs}) + (${move.operand})`;
      expectedRhs = `(${prevRhs}) + (${move.operand})`;
      break;
    case "sub":
      expectedLhs = `(${prevLhs}) - (${move.operand})`;
      expectedRhs = `(${prevRhs}) - (${move.operand})`;
      break;
    case "mul":
      expectedLhs = `(${prevLhs}) * (${move.operand})`;
      expectedRhs = `(${prevRhs}) * (${move.operand})`;
      break;
    case "div":
      expectedLhs = `(${prevLhs}) / (${move.operand})`;
      expectedRhs = `(${prevRhs}) / (${move.operand})`;
      break;
    case "square":
      expectedLhs = `(${prevLhs})^2`;
      expectedRhs = `(${prevRhs})^2`;
      break;
    case "apply-fn": {
      const fn = move.operand;
      if (typeof fn !== "string" || !APPLY_FN_WHITELIST.includes(fn)) {
        return {
          kind: "operand-not-numeric",
          reason: `unsupported function "${String(fn)}"`,
        };
      }
      expectedLhs = `${fn}(${prevLhs})`;
      expectedRhs = `${fn}(${prevRhs})`;
      break;
    }
    case "expand":
    case "factor":
    case "simplify":
      expectedLhs = prevLhs;
      expectedRhs = prevRhs;
      break;
  }

  // 3. Sample both diff forms at irrational seeds. We track:
  //      - exact equality (predicted ≈ actual): move is ok
  //      - constant non-1 ratio: right kind, wrong operand
  //      - non-constant ratio / different zero set: wrong kind
  const seeds = [0.7239, 1.318, -0.4612, 2.7182, -3.1415];
  const tolerance = 1e-7;
  const ratios: number[] = [];
  let allEqual = true;
  let anyMismatch = false;

  for (const seed of seeds) {
    const scope: Record<string, number> = {};
    for (let i = 0; i < variables.length; i++) {
      scope[variables[i]!] = seed + 0.137 * (i + 1);
    }
    let predictedDiff: number;
    let actualDiff: number;
    try {
      const eL = Number(evaluate(expectedLhs, scope));
      const eR = Number(evaluate(expectedRhs, scope));
      const cL = Number(evaluate(currLhs, scope));
      const cR = Number(evaluate(currRhs, scope));
      predictedDiff = eL - eR;
      actualDiff = cL - cR;
    } catch (e) {
      return { kind: "parse-error", reason: (e as Error).message };
    }
    if (!Number.isFinite(predictedDiff) || !Number.isFinite(actualDiff)) {
      // Skip degenerate samples (e.g. log(negative) at this seed).
      continue;
    }

    const scale = Math.max(1, Math.abs(predictedDiff), Math.abs(actualDiff));
    if (Math.abs(predictedDiff - actualDiff) > tolerance * scale) {
      allEqual = false;
      // Track ratio for proportionality classification.
      if (Math.abs(predictedDiff) > tolerance) {
        ratios.push(actualDiff / predictedDiff);
      } else if (Math.abs(actualDiff) > tolerance) {
        // Predicted is zero, actual isn't → different zero set.
        anyMismatch = true;
      }
    } else {
      // Sample matches; ratio is effectively 1.
      ratios.push(1);
    }
  }

  if (allEqual) return { kind: "ok" };

  // Constant-ratio across all sampled points = same kind, wrong operand.
  if (!anyMismatch && ratios.length >= 2) {
    const r0 = ratios[0]!;
    const isConstant = ratios.every(
      (r) => Math.abs(r - r0) <= 1e-6 * Math.max(1, Math.abs(r0)),
    );
    if (isConstant && Math.abs(r0 - 1) > 1e-6) {
      // Ratio constant but != 1 → right kind, wrong operand.
      // (Specifically: the kind here is operand-bearing.)
      if (
        move.op === "add" || move.op === "sub" || move.op === "mul" ||
        move.op === "div" || move.op === "square" || move.op === "apply-fn"
      ) {
        return { kind: "expected-ratio-mismatch", expectedKind: move.op };
      }
    }
  }

  // Anything else: shape mismatch.
  return { kind: "no-op-mismatch", expectedKind: move.op };
}

/**
 * Composes a leakage-safe Socratic hint for a move-verification miss.
 * The hint never names the expected operand or the right answer; it
 * only points at the mismatch between the *stated* move and what the
 * working actually shows.
 */
export function moveMismatchHint(line: number, v: MoveVerification): string {
  switch (v.kind) {
    case "operand-not-numeric":
      return `On line ${line} you annotated a move I can't pin to a number. ${v.reason}. Re-state the move with a numeric operand or remove the annotation.`;
    case "expected-ratio-mismatch":
      if (v.expectedKind === "mul") {
        return `On line ${line} you said you'd multiply, but the working shows a different scaling. Re-check whether you actually multiplied — and by what.`;
      }
      return `On line ${line} you said you'd divide, but the working shows a different scaling. Re-check whether you actually divided — and by what.`;
    case "no-op-mismatch":
      return `On line ${line} you annotated "${v.expectedKind}" but the equation has changed shape. The annotated move should leave the relation unchanged; something else happened.`;
    case "parse-error":
      return `On line ${line} I couldn't evaluate the expressions to verify the annotated move (${v.reason}).`;
    case "ok":
      return "";
  }
}
