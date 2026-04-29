// ─────────────────────────────────────────────────────────────────────────────
// content/packs-raw/maths.linear-eq-1var.mjs
//
// v1.5.0 — Seed content pack: linear equations of the form ax + b = c.
// This is the *raw, editable* source for the pack. The build script
// `scripts/build-content-manifest.mjs` reads it, validates each item against
// the schema, signs it with the trusted-reviewer key, and emits the signed
// JSON pack at `content/packs/maths.linear-eq-1var.json` plus an updated
// `content/manifest.json`.
//
// AUTHORING NOTE
// ──────────────
// These four problems are the migration of the v1.4.5 hand-written corpus
// in `lib/eke/parallel-problems.ts`. They were not LLM-drafted; the `draft`
// block records "manual-migration-v1.5.0" so the audit trail is honest. New
// items added by the LLM drafter pipeline will carry real `model` /
// `provider` / `promptHashB64url` values.
//
// EVERY field here is reviewed plain English authored at this desk. No
// runtime model touches it. The build script's only job is to validate
// shape, hash, and sign — not to generate or rewrite content.
// ─────────────────────────────────────────────────────────────────────────────

/** @type {import("../../lib/content/schema.ts").SchemaContentPack} */
export const pack = {
  schemaVersion: "1.0.0",
  id: "maths.linear-eq-1var",
  title: "Linear equations: one variable, two operations",
  subject: "maths",
  skillFamily: "linear-eq-1var",
  metadata: {
    version: "1.0.0",
    builtAtIso: "PLACEHOLDER_BUILT_AT", // replaced by build script
    description:
      "Linear equations of the form ax + b = c, solvable in two inverse operations. Migrated from the v1.4.5 hand-written parallel-problem corpus and enriched with explanations, misconceptions, and curriculum spec-point alignment.",
  },
  items: [
    {
      schemaVersion: "1.0.0",
      id: "ie-jc-maths-linear-eq-001",
      skillFamily: "linear-eq-1var",
      subject: "maths",
      jurisdictions: ["IE", "UK-EN", "UK-NI", "UK-SC", "UK-WL", "INTL"],
      difficulty: "core",
      prerequisites: ["arithmetic-integers", "inverse-operations"],
      specPoints: [
        {
          framework: "DES-JC-Maths-2024",
          code: "AF.1",
          label: "Solve linear equations in one variable",
        },
        {
          framework: "AQA-GCSE-9-1-Maths",
          code: "A17",
          label: "Solve linear equations in one unknown algebraically",
        },
      ],
      problem: "Solve for x:  2x + 5 = 17.  Show your reasoning, not just the answer.",
      expectedAnswer: 6,
      hints: [
        { tier: 1, text: "What's the very first move you'd make to get x on its own?" },
        { tier: 2, text: "Could you undo the +5 first, then deal with the 2 multiplying x?" },
        { tier: 3, text: "Two inverse operations in the right order isolate the variable. Which operation undoes addition? Which undoes multiplication?" },
      ],
      explanation: [
        "The aim is to get x by itself on one side of the equals sign.",
        "Two things are currently being done to x: it is being multiplied by 2, then 5 is being added.",
        "To undo them we apply the inverse operations in reverse order: first subtract 5 (undoing the +5), then divide by 2 (undoing the ×2).",
        "Subtract 5 from both sides:  2x = 12.",
        "Divide both sides by 2:  x = 6.",
        "Check by substitution:  2 × 6 + 5 = 12 + 5 = 17 ✓.",
      ].join(" "),
      misconceptions: [
        {
          id: "off-by-one-arithmetic-slip",
          trigger: "off_by_one",
          explanation: "An off-by-one usually means a small arithmetic slip when subtracting on one side. The method is right; check 17 − 5 carefully.",
          nudge: "Re-do the subtraction step on a fresh line and compare.",
        },
        {
          id: "sign-flipped-direction",
          trigger: "sign_flipped",
          explanation: "A flipped sign usually means the inverse operation went the wrong way — adding instead of subtracting, or vice versa. The clue is in the original equation: there is +5, so to undo it you subtract.",
          nudge: "Write the operation you're applying in words next to each step.",
        },
        {
          id: "doubled-skipped-divide",
          trigger: "doubled",
          explanation: "An answer of double the expected value usually means the division-by-2 step was skipped. After subtracting 5 you have 2x = 12, not x = 12.",
          nudge: "What's still attached to x after the subtraction step?",
        },
        {
          id: "halved-divided-too-early",
          trigger: "halved",
          explanation: "A half-of-expected answer usually means dividing by 2 was applied to one side only, or applied before the subtraction. Inverse operations must be applied to *both* sides, in the right order.",
          nudge: "Apply each step to the whole left side AND the whole right side.",
        },
      ],
      workedExamples: [
        // ─────────────────────────────────────────────────────────────────
        // Difficulty-banded parallels (v1.5.0).
        //
        // The problem with serving an `ax + b = c` parallel to a learner
        // who has just failed all three Socratic hints on `2x + 5 = 17` is
        // that the *process* hasn't landed — different numbers won't help.
        // What helps is dropping a step: a one-inverse-operation variant
        // that walks the algorithm end-to-end on the simplest possible
        // case before scaling back up. The "simpler" example below is
        // served first when the engine sees a 3-hints-failed evidence
        // pattern; same-band examples follow.
        //
        // The convention used at v1.5.0 is `id` prefix:
        //   `linear-eq-1var-simpler-NNN`  — drops one inverse operation
        //   `linear-eq-1var-NNN`          — same shape, different numbers
        //   `linear-eq-1var-stretch-NNN`  — adds an extra structural step
        //
        // v1.5.1 will lift this convention into an explicit `band` field
        // on the worked-example schema and teach the engine's parallel
        // selector to honour it. Documented in HONESTY.md §4.3.
        // ─────────────────────────────────────────────────────────────────
        {
          id: "linear-eq-1var-simpler-001",
          problem: "Solve for x:  x + 5 = 12  (one-step warm-up)",
          workedSolution: [
            "This is the SAME shape as 2x + 5 = 17, but with the multiplication-by-2 removed so we can focus on the inverse-operation idea by itself.",
            "Step 1. Subtract 5 from both sides to undo the +5.",
            "        x + 5 − 5 = 12 − 5",
            "        x = 7",
            "Check: 7 + 5 = 12 ✓",
            "Now the original problem (2x + 5 = 17) adds ONE more step on top: after subtracting 5 from both sides you get 2x = 12, and then you divide by 2.",
          ].join("\n"),
          expectedAnswer: 7,
        },
        {
          id: "linear-eq-1var-simpler-002",
          problem: "Solve for x:  2x = 14  (one-step warm-up)",
          workedSolution: [
            "This is also the same shape as 2x + 5 = 17, but with the +5 removed so we can focus on the divide-by-the-coefficient idea by itself.",
            "Step 1. Divide both sides by 2 to undo the ×2.",
            "        2x ÷ 2 = 14 ÷ 2",
            "        x = 7",
            "Check: 2 × 7 = 14 ✓",
            "Putting both warm-ups together gives the full method for 2x + 5 = 17: first undo the +5 (subtract 5), then undo the ×2 (divide by 2).",
          ].join("\n"),
          expectedAnswer: 7,
        },
        {
          id: "linear-eq-1var-001",
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
      ],
      // ─────────────────────────────────────────────────────────────────
      // First authored figure (v1.5.3).
      //
      // We show the graph of y = 2x + 5 — the LEFT-hand side of the
      // equation as a function of x. We DO NOT mark the y = 17 line or
      // the intersection point. Why: the figure must not leak the
      // expected answer (x = 6) to a learner staring at the problem.
      // The surface is free to render this alongside the problem; a
      // bright learner who wants to *graphically estimate* the solution
      // can intersect mentally with y = 17 and arrive at x ≈ 6, which
      // is a legitimate cross-check method, not a leak.
      //
      // Rendered by `<GeometryFigure spec={...} />` (lazy-loads
      // JSXGraph from CDN). Validated at build time by
      // `validateFigureSpec`; re-validated on load by the registry as
      // defence in depth.
      // ─────────────────────────────────────────────────────────────────
      figures: [
        {
          id: "linear-eq-001-figure-lhs-graph",
          title: "Graph of y = 2x + 5",
          alt:
            "A coordinate plane showing the line y equals two x plus five. " +
            "The line slopes upward, crossing the y-axis at five and rising " +
            "steeply through the visible window.",
          boundingBox: [-2, 22, 10, -2],
          axes: true,
          grid: true,
          keepAspectRatio: false,
          readOnly: true,
          elements: [
            {
              kind: "graph",
              expr: "2*x + 5",
              label: "y = 2x + 5",
              color: "#2a64bd",
              domain: [-2, 10],
            },
          ],
        },
      ],
      draft: {
        model: "manual-migration-v1.5.0",
        provider: "human-author",
        promptHashB64url: "MIGRATION_NO_PROMPT",
        draftedAtIso: "2026-04-28T00:00:00.000Z",
        drafterVersion: "1.5.0",
      },
      // Approval block is FILLED IN by build-content-manifest.mjs at sign time.
      // Defined here as null so the validator catches any forgotten signing step.
      approval: null,
    },
    // ─────────────────────────────────────────────────────────────────────────
    // Item 2 — stretch difficulty. Negative coefficient + negative constant.
    // ─────────────────────────────────────────────────────────────────────────
    {
      schemaVersion: "1.0.0",
      id: "ie-jc-maths-linear-eq-002",
      skillFamily: "linear-eq-1var",
      subject: "maths",
      jurisdictions: ["IE", "UK-EN", "UK-NI", "UK-SC", "UK-WL", "INTL"],
      difficulty: "stretch",
      prerequisites: ["arithmetic-integers", "inverse-operations", "negative-numbers"],
      specPoints: [
        { framework: "DES-JC-Maths-2024", code: "AF.1", label: "Solve linear equations in one variable" },
        { framework: "AQA-GCSE-9-1-Maths", code: "A17", label: "Solve linear equations in one unknown algebraically" },
      ],
      problem: "Solve for x:  −3x − 7 = 5.  Show your reasoning, not just the answer.",
      expectedAnswer: -4,
      hints: [
        { tier: 1, text: "What's currently being done to x, and in what order?" },
        { tier: 2, text: "There are two things attached to x — a multiplication and a subtraction. Which inverse goes first?" },
        { tier: 3, text: "When the coefficient is negative, dividing by a negative flips the sign. The order is: undo the constant, then undo the coefficient." },
      ],
      explanation: [
        "Two operations are happening to x: it is being multiplied by −3, then 7 is being subtracted.",
        "Undo them in reverse order. First add 7 to both sides:  −3x = 12.",
        "Now divide both sides by −3:  x = 12 ÷ (−3) = −4.",
        "Negative ÷ negative = positive; positive ÷ negative = negative. Here we are dividing positive 12 by negative 3, so the result is negative.",
        "Check by substitution:  −3 × (−4) − 7 = 12 − 7 = 5 ✓.",
      ].join(" "),
      misconceptions: [
        {
          id: "sign-flipped-negative-coefficient",
          trigger: "sign_flipped",
          explanation: "When the coefficient is negative, it is easy to forget that dividing by a negative changes the sign of the result. 12 ÷ (−3) is −4, not 4.",
          nudge: "After you isolate the −3x, write the division step out in full and pay attention to the sign rules.",
        },
        {
          id: "off-by-one-arithmetic-slip",
          trigger: "off_by_one",
          explanation: "An off-by-one usually means a small arithmetic slip. Re-check the addition step: 5 + 7 = 12, not 11 or 13.",
          nudge: "Re-do the addition on a fresh line and compare.",
        },
        {
          id: "doubled-skipped-divide",
          trigger: "doubled",
          explanation: "An answer of double the expected magnitude usually means the division-by-(−3) step was skipped. After adding 7 you have −3x = 12, not x = 12.",
          nudge: "What's still attached to x after the addition step?",
        },
        {
          id: "wrong-direction-subtracted",
          trigger: "wrong",
          explanation: "Subtracting 7 instead of adding 7 is a common slip when the constant is itself negative. The original equation has −7 on the left; to undo it we add 7 to both sides.",
          nudge: "Write the inverse operation in words next to each step before doing the arithmetic.",
        },
      ],
      workedExamples: [
        {
          id: "linear-eq-1var-stretch-001",
          problem: "Solve for x:  −2x + 3 = −5",
          workedSolution: [
            "Step 1. Subtract 3 from both sides.",
            "        −2x + 3 − 3 = −5 − 3",
            "        −2x = −8",
            "Step 2. Divide both sides by −2. Negative ÷ negative = positive.",
            "        −2x ÷ (−2) = −8 ÷ (−2)",
            "        x = 4",
            "Check: −2 × 4 + 3 = −8 + 3 = −5 ✓",
          ].join("\n"),
          expectedAnswer: 4,
        },
        {
          id: "linear-eq-1var-stretch-002",
          problem: "Solve for y:  −5y − 2 = 13",
          workedSolution: [
            "Step 1. Add 2 to both sides.",
            "        −5y − 2 + 2 = 13 + 2",
            "        −5y = 15",
            "Step 2. Divide both sides by −5. Positive ÷ negative = negative.",
            "        −5y ÷ (−5) = 15 ÷ (−5)",
            "        y = −3",
            "Check: −5 × (−3) − 2 = 15 − 2 = 13 ✓",
          ].join("\n"),
          expectedAnswer: -3,
        },
      ],
      draft: {
        model: "manual-migration-v1.5.0",
        provider: "human-author",
        promptHashB64url: "MIGRATION_NO_PROMPT",
        draftedAtIso: "2026-04-28T00:00:00.000Z",
        drafterVersion: "1.5.0",
      },
      approval: null,
    },
  ],
};
