// ─────────────────────────────────────────────────────────────────────────────
// lib/validation/step-validator.ts
//
// Step-by-step derivation validator (v1.5.1). Takes a multi-line derivation
// written as a chain of equations and checks, for each consecutive pair,
// that the *relation* encoded by the pair is algebraically preserved —
// i.e., that the step is a valid transformation of the previous one.
//
// Algorithm
// ─────────
// Each non-blank line is parsed as an equation `lhs = rhs`. For
// consecutive lines `line_i` and `line_{i+1}` we test:
//
//     symbolicEquivalent( lhs_i - rhs_i , lhs_{i+1} - rhs_{i+1} )
//
// i.e. both equations encode the same constraint on the variables. This
// catches standard isolating moves ("add 7 to both sides", "divide by 3",
// "expand", "factor") and rejects sign flips, arithmetic slips, and
// illegal moves that change the solution set.
//
// What it does NOT do (and we're honest about it)
// ────────────────────────────────────────────────
// • Check that the move was *made in the stated direction* (learner said
//   "divide by 2" but actually multiplied). That's a v1.5.2+ concern
//   requiring a move-vocabulary and a richer parser.
// • Validate proofs that aren't equational-chain shaped (induction,
//   contradiction, case analysis). Those remain qualitative at v1.5.x.
// • Accept LaTeX directly — the parser is math.js syntax (`x^2`, `*`,
//   `/`). Authoring-time tooling will normalise LaTeX to math.js on a
//   later pass; the validator's contract is the expression-string form.
//
// Contract
// ────────
// • Deterministic. No LLM. No remote call. Same input → same output.
// • `validateDerivation(text, expected?)` returns a structured report:
//   every step classified, the first invalid step's index surfaced,
//   an overall pass/fail.
// • When the expected final form is supplied, the *last* line is also
//   checked for algebraic equivalence to it. This covers the common
//   "show your working, ending at this form" marking contract.
// • No hint text ever leaks the expected form — the same information-
//   leakage pin the `diagnose`-family exports carry.
// ─────────────────────────────────────────────────────────────────────────────

import { evaluate, parse } from "mathjs";

import { symbolicEquivalent } from "./answer-checker";
import {
  type Move,
  type MoveVerification,
  moveMismatchHint,
  stripMoveAnnotation,
  verifyMove,
} from "./move-vocabulary";

/**
 * Per-step classification.
 *
 * - `valid`: the step preserves the relation of the previous line
 *   AND (if a move annotation was provided) the annotated move
 *   matches what actually happened.
 * - `invalid`: the step parses but does not preserve the relation (the
 *   learner made an illegal move — sign flip, dropped term, wrong
 *   coefficient).
 * - `unparseable`: the line is not a well-formed equation (missing `=`,
 *   parse failure). The engine treats this as "learner still writing"
 *   rather than a hard fail.
 * - `move-mismatch`: the relation IS preserved (the working is
 *   algebraically correct) but the learner annotated a move whose
 *   stated kind doesn't match the actual transformation (e.g. said
 *   "divide by 2" while actually multiplying by something else).
 *   The engine surfaces this as a soft pedagogical correction rather
 *   than a hard fail.
 * - `first`: the initial line of the derivation; nothing to compare to.
 */
export type StepStatus =
  | "first"
  | "valid"
  | "invalid"
  | "unparseable"
  | "move-mismatch";

export interface DerivationStep {
  /** 1-based line number in the source text (blank lines are skipped). */
  lineNumber: number;
  /** The source text of the step, trimmed. */
  source: string;
  /** The status of this step relative to its predecessor. */
  status: StepStatus;
  /**
   * The parsed move annotation (v1.5.2) if one was attached to the
   * step, e.g. `2x = 12 | divide by 2`. Null when no annotation was
   * provided or it couldn't be parsed.
   */
  move?: Move | null;
  /**
   * Result of verifying the annotated move against the actual
   * transformation. Only populated when `move` is non-null.
   */
  moveCheck?: MoveVerification;
}

export interface DerivationReport {
  /** All non-blank steps in source order. */
  steps: DerivationStep[];
  /**
   * The 1-based line number of the first invalid or unparseable step,
   * or null if the whole chain is valid.
   */
  firstProblemLine: number | null;
  /** Overall pass/fail — every step must be `first` or `valid`. */
  allValid: boolean;
  /**
   * True when the last step algebraically matches `expectedFinal`
   * (if provided). Null when no `expectedFinal` was supplied.
   */
  reachedExpectedFinal: boolean | null;
  /**
   * Short, non-leaking diagnostic for the engine to surface. Empty
   * string when the chain is fully valid.
   */
  hint: string;
}

export interface ValidateDerivationOptions {
  /**
   * Optional algebraic expression the final step should match (an
   * equation `x = 6` or a simplified form `x^2 + 3x + 2`). If omitted,
   * the report only checks step-to-step consistency.
   */
  expectedFinal?: string;
}

/**
 * Splits a multi-line derivation into cleaned, non-blank lines. Trims
 * each line, drops empty ones, and preserves 1-based line numbers for
 * error reporting.
 */
function extractLines(text: string): Array<{ lineNumber: number; source: string }> {
  if (typeof text !== "string" || text.length === 0) return [];
  const result: Array<{ lineNumber: number; source: string }> = [];
  const split = text.split(/\r?\n/);
  for (let i = 0; i < split.length; i++) {
    const line = split[i]!.trim();
    if (line.length === 0) continue;
    result.push({ lineNumber: i + 1, source: line });
  }
  return result;
}

/**
 * Parses a single line into its `{ lhs, rhs }` form.
 *
 * Strategy: split on the first `=` that is not part of `!=`, `==`,
 * `<=`, `>=`. math.js doesn't accept `=` inside an expression, so the
 * split must happen here.
 *
 * Returns null if the line has no `=` or produces an empty side.
 */
function parseEquation(line: string): { lhs: string; rhs: string } | null {
  // Normalise "==" to "=" (learners sometimes copy from code).
  const normalised = line.replace(/==/g, "=");
  const idx = normalised.indexOf("=");
  if (idx === -1) return null;
  const lhs = normalised.slice(0, idx).trim();
  const rhs = normalised.slice(idx + 1).trim();
  if (lhs.length === 0 || rhs.length === 0) return null;
  return { lhs, rhs };
}

/**
 * Validates a multi-line derivation.
 *
 * Example input:
 *   2x + 5 = 17
 *   2x = 12
 *   x = 6
 *
 * Returns a per-step report plus an overall pass/fail flag.
 */
export function validateDerivation(
  text: string,
  options: ValidateDerivationOptions = {},
): DerivationReport {
  const lines = extractLines(text);
  const steps: DerivationStep[] = [];
  let firstProblemLine: number | null = null;

  if (lines.length === 0) {
    return {
      steps: [],
      firstProblemLine: null,
      allValid: false,
      reachedExpectedFinal: options.expectedFinal === undefined ? null : false,
      hint: "",
    };
  }

  // Strip move annotations BEFORE equation parsing. Each entry retains
  // the cleaned equation source, the parsed move (if any), and the
  // 1-based line number.
  const stripped = lines.map((l) => ({
    lineNumber: l.lineNumber,
    source: l.source,
    annotation: stripMoveAnnotation(l.source),
  }));

  let firstMoveMismatchLine: number | null = null;
  let firstMoveMismatchVerification: MoveVerification | null = null;

  const firstEq = parseEquation(stripped[0]!.annotation.equation);
  steps.push({
    lineNumber: stripped[0]!.lineNumber,
    source: stripped[0]!.source,
    status: firstEq === null ? "unparseable" : "first",
    move: stripped[0]!.annotation.move,
  });
  if (firstEq === null) firstProblemLine = stripped[0]!.lineNumber;

  for (let i = 1; i < stripped.length; i++) {
    const prev = stripped[i - 1]!;
    const curr = stripped[i]!;
    const prevEq = parseEquation(prev.annotation.equation);
    const currEq = parseEquation(curr.annotation.equation);

    if (prevEq === null || currEq === null) {
      steps.push({
        lineNumber: curr.lineNumber,
        source: curr.source,
        status: "unparseable",
        move: curr.annotation.move,
      });
      if (firstProblemLine === null) firstProblemLine = curr.lineNumber;
      continue;
    }

    // The relation encoded by `lhs = rhs` is `lhs - rhs = 0`. Two
    // equations are equivalent (encode the same solution set) iff their
    // difference forms differ by a non-zero constant multiplier — i.e.,
    // they are *proportional*. Plain algebraic equivalence is too
    // strict: dividing both sides of `2x = 12` by 2 yields `x = 6`,
    // whose difference form `x - 6` is half of `2x - 12` — same
    // solution, not algebraically identical. See proportional() below.
    const prevDiff = `(${prevEq.lhs}) - (${prevEq.rhs})`;
    const currDiff = `(${currEq.lhs}) - (${currEq.rhs})`;
    const relationPreserved = relationsEquivalent(prevDiff, currDiff);

    if (!relationPreserved) {
      steps.push({
        lineNumber: curr.lineNumber,
        source: curr.source,
        status: "invalid",
        move: curr.annotation.move,
      });
      if (firstProblemLine === null) firstProblemLine = curr.lineNumber;
      continue;
    }

    // Relation IS preserved. If the learner annotated a move, verify
    // that the *kind* of move they claimed matches what actually
    // happened. This is a softer signal than the relation check — a
    // mismatch flags a vocabulary / metacognition slip, not a maths
    // error — but we still surface it so the learner can self-correct.
    if (curr.annotation.move !== null) {
      const vars = collectVariables(prevDiff, currDiff);
      const verdict = verifyMove(
        prevEq.lhs,
        prevEq.rhs,
        currEq.lhs,
        currEq.rhs,
        curr.annotation.move,
        vars,
      );
      if (verdict.kind !== "ok") {
        if (firstMoveMismatchLine === null) {
          firstMoveMismatchLine = curr.lineNumber;
          firstMoveMismatchVerification = verdict;
        }
        steps.push({
          lineNumber: curr.lineNumber,
          source: curr.source,
          status: "move-mismatch",
          move: curr.annotation.move,
          moveCheck: verdict,
        });
        continue;
      }
      steps.push({
        lineNumber: curr.lineNumber,
        source: curr.source,
        status: "valid",
        move: curr.annotation.move,
        moveCheck: verdict,
      });
      continue;
    }

    // No annotation, relation preserved — simple valid step.
    steps.push({
      lineNumber: curr.lineNumber,
      source: curr.source,
      status: "valid",
    });
  }

  // Optional terminal check against the expected final form.
  let reachedExpectedFinal: boolean | null = null;
  if (options.expectedFinal !== undefined) {
    const last = stripped[stripped.length - 1]!;
    const lastEq = parseEquation(last.annotation.equation);
    if (lastEq === null) {
      reachedExpectedFinal = false;
    } else {
      // We accept either a matching rhs (learner wrote `x = 6`, expected
      // also `6`) OR a full-equation equivalence (expected is itself an
      // equation).
      const expectedEq = parseEquation(options.expectedFinal);
      if (expectedEq === null) {
        // Expected is a bare expression — compare against the rhs.
        reachedExpectedFinal = symbolicEquivalent(lastEq.rhs, options.expectedFinal);
      } else {
        // Expected is an equation — compare relations via the same
        // proportionality test used for chain steps. This means a
        // learner who finishes at `2x = 12` is accepted when the
        // expected form is `x = 6` (same solution set).
        const expectedDiff = `(${expectedEq.lhs}) - (${expectedEq.rhs})`;
        const actualDiff = `(${lastEq.lhs}) - (${lastEq.rhs})`;
        reachedExpectedFinal = relationsEquivalent(expectedDiff, actualDiff);
      }
    }
  }

  const allValid =
    firstProblemLine === null && firstMoveMismatchLine === null;
  const reachedGoal = reachedExpectedFinal !== false; // null or true passes
  const hint = composeHint(
    steps,
    firstProblemLine,
    reachedExpectedFinal,
    firstMoveMismatchLine,
    firstMoveMismatchVerification,
  );

  return {
    steps,
    firstProblemLine,
    allValid: allValid && reachedGoal,
    reachedExpectedFinal,
    hint,
  };
}

/**
 * Returns true iff two difference-form expressions encode the same
 * solution set — i.e., they are proportional by a non-zero constant.
 *
 * Strategy
 * ────────
 * We sample both expressions at a small set of test points and check
 * that the ratio `prev(p) / curr(p)` is the same finite, non-zero
 * constant across all points where both are non-zero.
 *
 * Edge cases handled:
 *  - Both identically zero → equivalent.
 *  - One identically zero, the other not → not equivalent.
 *  - At a sample point one side is zero and the other isn't → not
 *    equivalent (the zero set is different at that point).
 *  - Different ratios across sample points → not equivalent (the
 *    relations differ in shape, not just by a scalar).
 *  - Parse failures → false (we err on the side of flagging unclear
 *    moves rather than silently passing them).
 *
 * Sample points are deliberately irrational and varied so polynomials
 * up to degree ~4 can't accidentally hit a coincidental zero set.
 * For higher degrees authors should rely on the symbolic check via
 * `symbolicEquivalent` directly; the validator's proportionality
 * model is calibrated for school-level linear, quadratic, and
 * factor-step work.
 */
function relationsEquivalent(prevDiff: string, currDiff: string): boolean {
  // Fast path: literally the same expression after simplify.
  if (symbolicEquivalent(prevDiff, currDiff)) return true;

  // Discover free variables by parsing once and walking symbol nodes.
  let freeVars: string[];
  try {
    const node = parse(`(${prevDiff}) + (${currDiff})`);
    const seen = new Set<string>();
    node.traverse((n: { type: string; name?: string }) => {
      if (n.type === "SymbolNode" && typeof n.name === "string") {
        // Filter math.js built-ins (constants, functions). We want only
        // user-introduced variables.
        const name = n.name;
        if (!/^[a-zA-Z]$/.test(name)) return; // restrict to single-letter vars (the school-maths convention)
        seen.add(name);
      }
    });
    freeVars = Array.from(seen).sort();
  } catch {
    return false;
  }

  if (freeVars.length === 0) {
    // Both are constants: equivalent iff both are zero or both non-zero
    // and equal-signed (a zero-equation reduces to a constant equation;
    // 0 = 0 is trivially preserved, anything else is contradictory).
    try {
      const a = Number(evaluate(prevDiff));
      const b = Number(evaluate(currDiff));
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      if (Math.abs(a) < 1e-12 && Math.abs(b) < 1e-12) return true;
      return false;
    } catch {
      return false;
    }
  }

  // Sample points: irrational seeds that won't accidentally vanish
  // common low-degree polynomial expressions.
  const seeds = [0.7239, 1.318, -0.4612, 2.7182, -3.1415];
  const tolerance = 1e-9;

  let firstRatio: number | null = null;
  let bothZeroEverywhere = true;

  for (const seed of seeds) {
    const scope: Record<string, number> = {};
    for (let i = 0; i < freeVars.length; i++) {
      // De-correlate the free variables across dimensions so multi-var
      // expressions don't get a degenerate sample.
      scope[freeVars[i]!] = seed + 0.137 * (i + 1);
    }

    let a: number;
    let b: number;
    try {
      a = Number(evaluate(prevDiff, scope));
      b = Number(evaluate(currDiff, scope));
    } catch {
      return false;
    }
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;

    const aZero = Math.abs(a) < tolerance;
    const bZero = Math.abs(b) < tolerance;
    if (aZero && bZero) continue;
    if (aZero !== bZero) return false; // zero sets disagree
    bothZeroEverywhere = false;
    const ratio = a / b;
    if (firstRatio === null) {
      if (Math.abs(ratio) < tolerance) return false; // ratio == 0 means a is zero, contradiction
      firstRatio = ratio;
    } else if (Math.abs(ratio - firstRatio) > 1e-6 * Math.max(1, Math.abs(firstRatio))) {
      return false;
    }
  }

  if (bothZeroEverywhere) return true;
  return firstRatio !== null;
}

/**
 * Short Socratic diagnostic for the engine to surface. Never names the
 * expected value or the expected final form — identical leakage
 * discipline to `diagnoseAttempt` / `diagnoseSymbolicAttempt`.
 */
function composeHint(
  steps: DerivationStep[],
  firstProblemLine: number | null,
  reachedExpectedFinal: boolean | null,
  firstMoveMismatchLine: number | null,
  firstMoveMismatchVerification: MoveVerification | null,
): string {
  if (firstProblemLine !== null) {
    const bad = steps.find((s) => s.lineNumber === firstProblemLine);
    if (bad && bad.status === "unparseable") {
      return `Check line ${firstProblemLine} — I can't read it as an equation yet. Make sure both sides of the = are written out.`;
    }
    return `Re-check line ${firstProblemLine}. The move from the line above doesn't preserve the equation — one of the operations wasn't applied to both sides, or a sign flipped.`;
  }
  if (firstMoveMismatchLine !== null && firstMoveMismatchVerification !== null) {
    return moveMismatchHint(firstMoveMismatchLine, firstMoveMismatchVerification);
  }
  if (reachedExpectedFinal === false) {
    return "Every step is algebraically valid, but you haven't reached the simplest form yet. Continue isolating the variable.";
  }
  return "";
}

/**
 * Walks two expressions, collecting the set of single-letter symbol
 * names that appear in either. Used by `verifyMove` to know which
 * variables to substitute at sample points.
 */
function collectVariables(a: string, b: string): string[] {
  const seen = new Set<string>();
  for (const expr of [a, b]) {
    try {
      const node = parse(expr);
      node.traverse((n: { type: string; name?: string }) => {
        if (n.type === "SymbolNode" && typeof n.name === "string") {
          if (/^[a-zA-Z]$/.test(n.name)) seen.add(n.name);
        }
      });
    } catch {
      // Already-validated expressions; ignore.
    }
  }
  return Array.from(seen).sort();
}
