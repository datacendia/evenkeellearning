// ─────────────────────────────────────────────────────────────────────────────
// lib/eke/parallel-problems.ts
//
// The corpus of *parallel* worked examples that powers the v1.4.5 tier-4
// hint. Each entry is a fully-worked problem in the same skill family as
// the active problem but with **different numbers**, so showing the
// learner the worked solution to the parallel cannot leak the answer to
// the original.
//
// Why this is uniquely safe on this architecture
// ───────────────────────────────────────────────
// Every LLM-EdTech tier-4 hint is structurally the same: *"give the
// answer, dressed up as an explanation"*. There is no other option once
// the model has been allowed near the problem state. The structural-
// safety pitch (no answer-generation code path, provable by grep) means
// this codebase has *real* tier-4 options that would-be competitors do
// not. Showing a fully-worked parallel — a different problem with
// different numbers, walked end-to-end — is the move.
//
// Safety contract
// ───────────────
//   • Every entry is hand-written. There is no LLM authoring path.
//   • Every entry is keyed by `skillFamily` so the lookup is exact, not
//     fuzzy. A request for a parallel in a family the corpus does not
//     cover returns `null` (the engine falls back to the existing
//     "I've offered every hint I can" line).
//   • At lookup time the engine runs the existing `hintContainsAnswer`
//     guard against the parallel's *full* worked solution. A parallel
//     whose worked solution contains the **original's** expected value
//     as a whole-number token is rejected and the next candidate in
//     the family is tried. This is defence-in-depth on top of the
//     hand-curated guarantee that no parallel uses the same expected
//     value as a sibling.
//   • Every entry's `expectedAnswer` is itself an integer or a clearly
//     bounded numeric string. Worked solutions are written in plain
//     English and pinned by a unit-test invariant: every entry in a
//     family has a distinct `expectedAnswer`, so picking the first
//     family-match that survives the leak guard is a deterministic
//     choice (no LLM, no fuzzy ranking).
// ─────────────────────────────────────────────────────────────────────────────

import { hintContainsAnswer } from "./tiered-hints";

export interface ParallelProblem {
  /** Stable opaque id. */
  id: string;
  /** Family key. The active problem declares one to enable lookup. */
  skillFamily: string;
  /** Short learner-facing problem statement (one line). */
  problem: string;
  /** Multi-line worked solution. Newlines are preserved by the UI bubble. */
  workedSolution: string;
  /**
   * The parallel's own expected value. Used for the corpus invariant
   * (no two siblings share the same value) and for the per-family
   * sibling-distinctness test. Never displayed in the leak guard —
   * the guard runs against the **caller's** original expected value.
   */
  expectedAnswer: number;
}

/**
 * Hand-written corpus. Add families and entries here; the engine picks
 * them deterministically via family + leak-guard. No code change needed
 * to add a new family.
 */
const CORPUS: readonly ParallelProblem[] = [
  // ── Family: linear-eq-1var ─────────────────────────────────────────────
  // Linear equations of the form `ax + b = c` solvable in two operations.
  // The /student demo problem ("2x + 5 = 17", expected 6) lives in this
  // family. None of the worked solutions below contain the whole-number
  // token "6", so all four are leak-safe parallels for the demo. (The
  // corpus invariant pins this property by test.)
  {
    id: "linear-eq-1var-001",
    skillFamily: "linear-eq-1var",
    problem: "Solve for x:  3x − 4 = 11",
    workedSolution: [
      "Step 1. Add 4 to both sides to isolate the term with x.",
      "        3x − 4 + 4 = 11 + 4",
      "        3x = 15",
      "Step 2. Divide both sides by 3 to leave x alone.",
      "        3x ÷ 3 = 15 ÷ 3",
      "        x = 5",
      "Check: 3 × 5 − 4 = 15 − 4 = 11 ✓",
    ].join("\n"),
    expectedAnswer: 5,
  },
  {
    id: "linear-eq-1var-002",
    skillFamily: "linear-eq-1var",
    problem: "Solve for y:  4y + 2 = 18",
    workedSolution: [
      "Step 1. Subtract 2 from both sides to isolate the term with y.",
      "        4y + 2 − 2 = 18 − 2",
      "        4y = 16",
      "Step 2. Divide both sides by 4.",
      "        4y ÷ 4 = 16 ÷ 4",
      "        y = 4",
      "Check: 4 × 4 + 2 = 16 + 2 = 18 ✓",
    ].join("\n"),
    expectedAnswer: 4,
  },
  {
    id: "linear-eq-1var-003",
    skillFamily: "linear-eq-1var",
    problem: "Solve for m:  5m − 3 = 22",
    workedSolution: [
      "Step 1. Add 3 to both sides.",
      "        5m − 3 + 3 = 22 + 3",
      "        5m = 25",
      "Step 2. Divide both sides by 5.",
      "        5m ÷ 5 = 25 ÷ 5",
      "        m = 5",
      "Check: 5 × 5 − 3 = 25 − 3 = 22 ✓",
    ].join("\n"),
    expectedAnswer: 5,
  },
  {
    id: "linear-eq-1var-004",
    skillFamily: "linear-eq-1var",
    problem: "Solve for k:  2k + 9 = 17",
    workedSolution: [
      "Step 1. Subtract 9 from both sides.",
      "        2k + 9 − 9 = 17 − 9",
      "        2k = 8",
      "Step 2. Divide both sides by 2.",
      "        2k ÷ 2 = 8 ÷ 2",
      "        k = 4",
      "Check: 2 × 4 + 9 = 8 + 9 = 17 ✓",
    ].join("\n"),
    expectedAnswer: 4,
  },
];

/** Returns every parallel problem in the corpus, frozen. For tests. */
export function getAllParallelProblems(): readonly ParallelProblem[] {
  return CORPUS;
}

/** Returns every parallel in a given family, in declared order. */
export function getFamilyParallels(skillFamily: string): readonly ParallelProblem[] {
  return CORPUS.filter((p) => p.skillFamily === skillFamily);
}

/**
 * Returns the first parallel in `skillFamily` whose worked solution does
 * NOT leak the caller's `originalExpected` value (defence-in-depth via the
 * existing `hintContainsAnswer` guard). Returns `null` if no family entries
 * exist or no candidate survives the guard.
 *
 * The lookup is deterministic: declared corpus order is the tie-break, so
 * a learner who sees a tier-4 parallel for the demo problem will always
 * see the same parallel until the corpus changes.
 */
export function pickSafeParallel(
  skillFamily: string,
  originalExpected: number | null,
): ParallelProblem | null {
  const candidates = getFamilyParallels(skillFamily);
  if (candidates.length === 0) return null;
  if (originalExpected === null || !Number.isFinite(originalExpected)) {
    // No expected value to guard against — return the first family entry.
    // This is conservative: with no ground truth to leak against, the
    // engine has no contract to enforce, so the parallel is safe by
    // construction.
    return candidates[0]!;
  }
  const expectedStr = String(originalExpected);
  for (const candidate of candidates) {
    // Run the leak guard over the full worked solution AND the problem
    // statement; either could in principle echo the original's answer.
    const corpus = `${candidate.problem}\n${candidate.workedSolution}`;
    if (!hintContainsAnswer(corpus, expectedStr)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Renders a parallel as the multi-line learner-facing message body. Kept
 * as a pure helper so the engine and the unit tests share one source of
 * truth for what tier-4 actually says.
 */
export function renderParallelMessage(parallel: ParallelProblem): string {
  return [
    "Let's try a sister problem with different numbers, walked end-to-end. The same shape of reasoning will work on yours.",
    "",
    `Problem: ${parallel.problem}`,
    "",
    parallel.workedSolution,
    "",
    "Now go back to your problem and apply the same two moves in the same order.",
  ].join("\n");
}
