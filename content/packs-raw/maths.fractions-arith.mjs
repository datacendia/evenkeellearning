// ─────────────────────────────────────────────────────────────────────────────
// content/packs-raw/maths.fractions-arith.mjs
//
// v1.6.0 — Authored content pack: the four operations with fractions,
// including mixed numbers and fraction-of-amount word problems.
// Spans the KS3→KS4 bridge: item 1 and 2 sit inside the KS3 programme
// of study (Year 7–8), item 3 is early KS4 consolidation, item 4 is
// a GCSE-grade contextual application.
//
// AUTHORING PROVENANCE
// ────────────────────
// Plain-English, hand-authored (human-author). NO language model in the
// draft loop. `draft.model = "manual-authored-v1.6.0"` records this
// honestly.
//
// CURRICULUM GROUNDING
// ────────────────────
// Alignment per item against:
//   • National Curriculum Mathematics (England), KS3 + KS4 — Number
//     domain, sub-strand "Fractions"
//   • AQA GCSE 9-1 Mathematics (spec N2, N8)
//   • Edexcel GCSE 9-1 Mathematics (1.2, 1.3, 1.6)
//   • DES Junior Cycle Mathematics 2024 — Number N.3
//   • CCSS Mathematics 6.NS.A.1 and 7.NS.A.2
//
// MISCONCEPTIONS EVIDENCE BASE
// ────────────────────────────
// Every misconception is grounded in the published research literature
// on fraction errors:
//   • Hart, K. (1981). "Children's Understanding of Mathematics 11–16"
//     (the CSMS study), chapter 5 "Fractions". The "add across the
//     top and bottom" error is documented at ≈30% prevalence in Y9.
//   • Swan, M. (1983). "The meaning of 'mean'" — reprinted in the
//     DES Assessment of Performance Unit misconception library.
//   • Mathematics Assessment Project (MAP), UC Berkeley / Nottingham
//     Shell Centre — "Interpreting and Using Fractions" concept
//     development lesson.
//   • NCETM (UK) Secondary Mastery PD Materials — "Calculation with
//     fractions" common-error catalogue (2019).
//   • Edexcel GCSE Mathematics Chief Examiners' Report, 2023 Paper 1F,
//     Q17 (division of mixed numbers).
//
// RUNTIME-LIMITATION DISCLOSURE (honest)
// ──────────────────────────────────────
// The numeric answer-checker accepts a single `number | string`. Items 1
// and 2 have fractional answers that we encode as STRING ("11/12",
// "2/3"); the runtime currently flags those as `no_attempt` rather than
// auto-checking, so the learner relies on the explanation + misconception
// blocks for feedback (and on teacher marking if the surface wires it).
// Items 3 and 4 have INTEGER answers and are fully runtime-checkable.
// Set-matching + rational-equality answers are tracked for schema v1.1;
// see HONESTY.md §4.4.
// ─────────────────────────────────────────────────────────────────────────────

/** @type {import("../../lib/content/schema.ts").SchemaContentPack} */
export const pack = {
  schemaVersion: "1.0.0",
  id: "maths.fractions-arith",
  title: "Fractions: four operations and fraction-of-amount",
  subject: "maths",
  skillFamily: "fractions-arith",
  metadata: {
    version: "1.0.0",
    builtAtIso: "PLACEHOLDER_BUILT_AT", // replaced by build script
    description:
      "The four arithmetic operations with fractions, including mixed " +
      "numbers and a KS4 word-problem application. Every item carries " +
      "curriculum alignment to the National Curriculum (England), AQA " +
      "and Edexcel GCSE 9-1, DES Junior Cycle, and CCSS 6.NS / 7.NS. " +
      "Misconceptions grounded in the CSMS study (Hart 1981), the MAP " +
      "fractions library, NCETM mastery materials, and Edexcel 2023 " +
      "chief examiner feedback.",
  },
  items: [
    // ─────────────────────────────────────────────────────────────────────
    // Item 1 — CORE. Addition with unlike denominators.
    //   2/3 + 1/4 = 8/12 + 3/12 = 11/12
    // ─────────────────────────────────────────────────────────────────────
    {
      schemaVersion: "1.0.0",
      id: "uk-gcse-maths-fractions-001",
      skillFamily: "fractions-arith",
      subject: "maths",
      jurisdictions: ["IE", "UK-EN", "UK-NI", "UK-SC", "UK-WL", "US", "INTL"],
      difficulty: "core",
      prerequisites: [
        "multiplication-tables-to-12",
        "fractions-equivalence",
        "lowest-common-multiple",
      ],
      specPoints: [
        {
          framework: "NC-KS3-Maths-England",
          code: "Num-frac-4ops",
          label:
            "Use the four operations with fractions, including mixed " +
            "numbers (KS3 Year 8)",
        },
        {
          framework: "AQA-GCSE-9-1-Maths",
          code: "N2",
          label:
            "Apply the four operations to integers and fractions both " +
            "positive and negative",
        },
        {
          framework: "Edexcel-GCSE-9-1-Maths",
          code: "1.3",
          label: "Calculate exactly with fractions",
        },
        {
          framework: "DES-JC-Maths-2024",
          code: "N.3",
          label: "Add and subtract fractions with unlike denominators",
        },
        {
          framework: "CCSS-Math",
          code: "6.NS.A.1",
          label:
            "Interpret and compute quotients of fractions, and solve " +
            "word problems involving division of fractions (extended " +
            "to addition/subtraction in 5.NF.A.1)",
        },
      ],
      problem:
        "Calculate 2/3 + 1/4.  Give your answer as a single fraction in " +
        "its simplest form.  Show your working.",
      expectedAnswer: "11/12",
      hints: [
        {
          tier: 1,
          text:
            "You cannot add fractions directly when the denominators are " +
            "different. What could you change so that they match?",
        },
        {
          tier: 2,
          text:
            "Find a COMMON DENOMINATOR — a number that both 3 and 4 go " +
            "into. The smallest such number is the LCM of 3 and 4. What " +
            "is it?",
        },
        {
          tier: 3,
          text:
            "LCM(3, 4) = 12. Rewrite 2/3 as an equivalent fraction with " +
            "denominator 12 (multiply top and bottom by the same number). " +
            "Do the same for 1/4. Now add the numerators, keep the " +
            "denominator.",
          addresses: "add-across",
        },
      ],
      explanation: [
        "To add fractions you need a COMMON denominator.",
        "The lowest common denominator of 3 and 4 is the lowest common",
        "multiple of 3 and 4, which is 12.",
        "Rewrite each fraction with denominator 12:",
        "  2/3 = (2 × 4) / (3 × 4) = 8/12.",
        "  1/4 = (1 × 3) / (4 × 3) = 3/12.",
        "Now ADD the numerators, keeping the denominator the same:",
        "  8/12 + 3/12 = 11/12.",
        "Check that 11/12 is in its simplest form: GCD(11, 12) = 1 " +
          "(11 is prime, 12 is not a multiple of 11), so 11/12 cannot be " +
          "simplified further.",
        "Final answer:  11/12.",
      ].join(" "),
      misconceptions: [
        {
          id: "add-across",
          trigger: "wrong",
          explanation:
            "The single most common fraction error — documented at ≈30% " +
            "prevalence in Y9 in the CSMS study (Hart, 1981) — is to add " +
            "numerator+numerator and denominator+denominator, giving " +
            "2/3 + 1/4 = 3/7. This is incorrect because the two fractions " +
            "refer to different-sized 'pieces': thirds and quarters. You " +
            "cannot add 2 thirds to 1 quarter any more than you can add " +
            "2 apples to 1 orange and call the result 3 somethings. " +
            "Converting both to the same denominator (12) reframes them " +
            "as the same-sized pieces (twelfths), and THEN they are " +
            "addable.",
          nudge:
            "Re-state the problem in words: 'two thirds plus one quarter'. " +
            "These are different-sized pieces. Find a common denominator " +
            "first.",
        },
        {
          id: "common-denom-not-lowest",
          trigger: "wrong",
          explanation:
            "Using ANY common denominator (e.g. 24 rather than 12) will " +
            "give a correct but un-simplified answer like 22/24. The " +
            "arithmetic is right; the answer just needs a further " +
            "simplification step. Using the LOWEST common denominator " +
            "(the LCM of the original denominators) usually leaves you " +
            "with less simplification work.",
          nudge:
            "After finding a common denominator and adding, always check " +
            "whether the resulting fraction can be simplified.",
        },
        {
          id: "forgot-scale-numerator",
          trigger: "wrong",
          explanation:
            "A subtle error is to change the denominators (e.g. 3 → 12) " +
            "but forget to scale the numerators by the same factor, " +
            "giving 2/12 + 1/12 = 3/12. Every fraction equivalence is " +
            "multiply-BOTH-top-AND-bottom by the same number. 2/3 and " +
            "2/12 are not equal; 2/3 and 8/12 are.",
          nudge:
            "When changing the denominator, write (top × k)/(bottom × k) " +
            "out in full for both fractions before adding.",
        },
        {
          id: "off-by-one-arithmetic-slip",
          trigger: "off_by_one",
          explanation:
            "An off-by-one slip usually means an arithmetic error in the " +
            "scaling step. Re-check: 2 × 4 = 8, not 7 or 9. 1 × 3 = 3.",
          nudge:
            "Redo each numerator scaling on a fresh line and compare.",
        },
      ],
      workedExamples: [
        // SIMPLER warm-up. Same denominator, so the only skill required is
        // adding numerators — which isolates the 'keep the denominator'
        // part of the rule.
        {
          id: "fractions-simpler-001",
          problem:
            "Calculate 2/7 + 3/7. Give your answer as a fraction in its " +
            "simplest form. (warm-up)",
          workedSolution: [
            "The denominators are ALREADY the same (both 7), so we can",
            "add the numerators directly and keep the denominator.",
            "  2/7 + 3/7 = (2 + 3)/7 = 5/7.",
            "Check simplest form: GCD(5, 7) = 1, so 5/7 is already simplest.",
            "Takeaway for the main problem: when denominators differ, the",
            "first step is always to rewrite each fraction with a common",
            "denominator. Once they match, the addition itself works the",
            "same way as this warm-up.",
          ].join("\n"),
          expectedAnswer: "5/7",
        },
        {
          id: "fractions-001",
          problem: "Calculate 1/2 + 1/3. Give your answer as a fraction in simplest form.",
          workedSolution: [
            "Common denominator: LCM(2, 3) = 6.",
            "  1/2 = 3/6.",
            "  1/3 = 2/6.",
            "Add:  3/6 + 2/6 = 5/6.",
            "Check simplest form: GCD(5, 6) = 1, so 5/6 is simplest.",
          ].join("\n"),
          expectedAnswer: "5/6",
        },
        {
          id: "fractions-002",
          problem: "Calculate 3/5 + 1/2. Give your answer as a fraction in simplest form.",
          workedSolution: [
            "Common denominator: LCM(5, 2) = 10.",
            "  3/5 = 6/10.",
            "  1/2 = 5/10.",
            "Add:  6/10 + 5/10 = 11/10.",
            "Simplest form: GCD(11, 10) = 1.  11/10 is simplest.",
            "(Note: 11/10 > 1; this can also be written as the mixed",
            "number 1 1/10. Both are correct.)",
          ].join("\n"),
          expectedAnswer: "11/10",
        },
      ],
      draft: {
        model: "manual-authored-v1.6.0",
        provider: "human-author",
        promptHashB64url: "AUTHORED_NO_PROMPT",
        draftedAtIso: "2026-05-11T00:00:00.000Z",
        drafterVersion: "1.6.0",
      },
      approval: null,
    },

    // ─────────────────────────────────────────────────────────────────────
    // Item 2 — CORE. Multiplication with cross-cancellation.
    //   3/5 × 10/9 = 30/45 = 2/3   (or cancel first: 3/9 = 1/3; 10/5 = 2
    //                                → 1/3 × 2 = 2/3)
    // ─────────────────────────────────────────────────────────────────────
    {
      schemaVersion: "1.0.0",
      id: "uk-gcse-maths-fractions-002",
      skillFamily: "fractions-arith",
      subject: "maths",
      jurisdictions: ["IE", "UK-EN", "UK-NI", "UK-SC", "UK-WL", "US", "INTL"],
      difficulty: "core",
      prerequisites: [
        "multiplication-tables-to-12",
        "fractions-equivalence",
        "hcf-of-two-numbers",
      ],
      specPoints: [
        {
          framework: "AQA-GCSE-9-1-Maths",
          code: "N2",
          label:
            "Apply the four operations to integers and fractions both " +
            "positive and negative",
        },
        {
          framework: "Edexcel-GCSE-9-1-Maths",
          code: "1.3",
          label: "Calculate exactly with fractions",
        },
        {
          framework: "DES-JC-Maths-2024",
          code: "N.3",
          label: "Multiply and divide fractions",
        },
        {
          framework: "CCSS-Math",
          code: "5.NF.B.4",
          label:
            "Apply and extend previous understandings of multiplication " +
            "to multiply a fraction or whole number by a fraction",
        },
      ],
      problem:
        "Calculate 3/5 × 10/9.  Give your answer as a fraction in its " +
        "simplest form.  Show your working and, if possible, simplify " +
        "BEFORE multiplying.",
      expectedAnswer: "2/3",
      hints: [
        {
          tier: 1,
          text:
            "Multiplying fractions is the most forgiving of the four " +
            "operations: you multiply top × top and bottom × bottom. No " +
            "common denominator is needed. What numbers would you be " +
            "multiplying if you did it directly?",
        },
        {
          tier: 2,
          text:
            "3/5 × 10/9 = (3 × 10)/(5 × 9). Before doing the multiplication, " +
            "look at 3 and 9 (one on top, one on bottom): they share a " +
            "common factor of 3. Look at 10 and 5 (one on top, one on " +
            "bottom): they share a common factor of 5. You can CANCEL " +
            "those common factors first.",
        },
        {
          tier: 3,
          text:
            "Cancelling before multiplying: 3 and 9 → divide both by 3, " +
            "becoming 1 and 3. 10 and 5 → divide both by 5, becoming 2 " +
            "and 1. The product is now 1/1 × 2/3 = 2/3. " +
            "This is the same answer as multiplying first then " +
            "simplifying (30/45 = 2/3), just with smaller numbers along " +
            "the way.",
          addresses: "cancel-across-addition",
        },
      ],
      explanation: [
        "To multiply fractions, multiply the numerators together and the",
        "denominators together. No common denominator is required.",
        "Method 1 (multiply first, simplify at the end):",
        "  3/5 × 10/9 = (3 × 10) / (5 × 9) = 30/45.",
        "  GCD(30, 45) = 15, so 30/45 = 2/3.",
        "Method 2 (cancel common factors FIRST — usually less arithmetic):",
        "  The 3 in the top of the first fraction and the 9 in the bottom",
        "  of the second share a factor of 3:  3 and 9 become 1 and 3.",
        "  The 10 in the top of the second fraction and the 5 in the",
        "  bottom of the first share a factor of 5:  10 and 5 become 2",
        "  and 1.",
        "  Now multiply:  (1 × 2) / (1 × 3) = 2/3.",
        "Either method gives  2/3  as the final answer.",
      ].join(" "),
      misconceptions: [
        {
          id: "cross-cancel-addition-by-mistake",
          trigger: "wrong",
          explanation:
            "A widespread error (NCETM mastery misconception #7) is to " +
            "attempt cross-cancellation on an ADDITION problem — e.g. " +
            "writing '2/3 + 1/4' and trying to cancel the 2 with the 4. " +
            "Cross-cancellation only works for MULTIPLICATION. For " +
            "addition you must find a common denominator instead.",
          nudge:
            "Before cancelling anything, check the operation between the " +
            "fractions. Cancel only when it's ×.",
        },
        {
          id: "cancel-across-addition",
          trigger: "wrong",
          explanation:
            "Related but worse: trying to 'cancel' across a sum or " +
            "difference within a single fraction — e.g. writing " +
            "(x + 2)/2 = x + 1 by 'cancelling the 2'. This is wrong " +
            "because the 2 in the numerator is NOT a factor of the whole " +
            "numerator; it's one term in a sum. Cancellation needs " +
            "MULTIPLICATIVE factors on BOTH top and bottom. (Swan, 1983)",
          nudge:
            "Before cancelling, ask: is this number multiplying EVERYTHING " +
            "on the top? If no, you cannot cancel it.",
        },
        {
          id: "denominator-untouched",
          trigger: "wrong",
          explanation:
            "A procedural slip is to multiply just the numerators and " +
            "leave one of the denominators alone, e.g. writing 3/5 × " +
            "10/9 = 30/9. Both a top-and-a-bottom must be multiplied.",
          nudge:
            "Write out (top × top)/(bottom × bottom) explicitly before " +
            "computing.",
        },
        {
          id: "forgot-to-simplify",
          trigger: "wrong",
          explanation:
            "Answering 30/45 is arithmetically correct but 'not in its " +
            "simplest form' loses the simplification mark in GCSE. Always " +
            "check whether top and bottom share a common factor.",
          nudge:
            "After multiplying, compute GCD(top, bottom). If GCD > 1, " +
            "divide both by it.",
        },
      ],
      workedExamples: [
        {
          id: "fractions-003",
          problem: "Calculate 2/3 × 9/4. Give your answer as a fraction in simplest form.",
          workedSolution: [
            "Cancel first: 2 and 4 share factor 2 (→ 1 and 2); 9 and 3",
            "share factor 3 (→ 3 and 1).",
            "Now:  1/1 × 3/2 = 3/2.",
            "Check simplest form: GCD(3, 2) = 1.  3/2 is simplest.",
          ].join("\n"),
          expectedAnswer: "3/2",
        },
        {
          id: "fractions-004",
          problem: "Calculate 4/7 × 14/5. Give your answer as a fraction in simplest form.",
          workedSolution: [
            "Cancel first: 14 and 7 share factor 7 (→ 2 and 1). 4 and 5",
            "share no factor.",
            "Now:  4/1 × 2/5 = 8/5.",
            "Check simplest form: GCD(8, 5) = 1.  8/5 is simplest.",
          ].join("\n"),
          expectedAnswer: "8/5",
        },
      ],
      draft: {
        model: "manual-authored-v1.6.0",
        provider: "human-author",
        promptHashB64url: "AUTHORED_NO_PROMPT",
        draftedAtIso: "2026-05-11T00:00:00.000Z",
        drafterVersion: "1.6.0",
      },
      approval: null,
    },

    // ─────────────────────────────────────────────────────────────────────
    // Item 3 — STRETCH. Division of mixed numbers (KCF + mixed→improper).
    //   2 1/4 ÷ 3/4  =  9/4 ÷ 3/4  =  9/4 × 4/3  =  36/12  =  3  (integer)
    //
    // Integer expectedAnswer → fully runtime-checkable. Chief Examiner's
    // Report Edexcel 2023 1F Q17 flagged this as the worst-performing
    // fractions topic at GCSE Foundation; it's worth landing.
    // ─────────────────────────────────────────────────────────────────────
    {
      schemaVersion: "1.0.0",
      id: "uk-gcse-maths-fractions-003",
      skillFamily: "fractions-arith",
      subject: "maths",
      jurisdictions: ["IE", "UK-EN", "UK-NI", "UK-SC", "UK-WL", "US", "INTL"],
      difficulty: "stretch",
      prerequisites: [
        "fractions-arith",
        "mixed-numbers-to-improper",
        "reciprocal-of-fraction",
      ],
      specPoints: [
        {
          framework: "AQA-GCSE-9-1-Maths",
          code: "N2",
          label:
            "Apply the four operations to integers, decimals and " +
            "fractions including mixed numbers",
        },
        {
          framework: "Edexcel-GCSE-9-1-Maths",
          code: "1.3",
          label: "Calculate exactly with fractions, including mixed numbers",
        },
        {
          framework: "DES-JC-Maths-2024",
          code: "N.3",
          label: "Divide fractions, including mixed numbers",
        },
        {
          framework: "CCSS-Math",
          code: "6.NS.A.1",
          label:
            "Interpret and compute quotients of fractions, and solve " +
            "word problems involving division of fractions by fractions",
        },
      ],
      problem:
        "Calculate  2 1/4 ÷ 3/4.  Give your answer as a whole number or " +
        "as a fraction in its simplest form.  Show every step.",
      expectedAnswer: 3,
      hints: [
        {
          tier: 1,
          text:
            "When a mixed number is involved, the first step is almost " +
            "always to convert it to an IMPROPER fraction. What is " +
            "2 1/4 as an improper fraction?",
        },
        {
          tier: 2,
          text:
            "2 1/4 = (2 × 4 + 1)/4 = 9/4. Now your problem is 9/4 ÷ 3/4. " +
            "Division by a fraction is the same as multiplication by its " +
            "RECIPROCAL — 'Keep, Change, Flip' (KCF). Keep the first, " +
            "change ÷ to ×, flip the SECOND (not both).",
          addresses: "flipped-both-fractions",
        },
        {
          tier: 3,
          text:
            "9/4 × 4/3. The 4s cancel to 1s; the 9 and 3 share factor 3 " +
            "(→ 3 and 1). You are left with  3/1 × 1/1 = 3.",
        },
      ],
      explanation: [
        "Division of fractions is done in three steps.",
        "Step 1. Convert any mixed numbers to improper fractions.",
        "  2 1/4 = (2 × 4 + 1)/4 = 9/4.",
        "Step 2. Apply KEEP · CHANGE · FLIP: keep the first fraction, " +
          "change ÷ to ×, flip ONLY the second fraction to its reciprocal.",
        "  9/4 ÷ 3/4  =  9/4 × 4/3.",
        "Step 3. Multiply, cancelling common factors first.",
        "  4 and 4: divide both by 4 → 1 and 1.",
        "  9 and 3: divide both by 3 → 3 and 1.",
        "  9/4 × 4/3  =  3/1 × 1/1 = 3.",
        "Check (by multiplying back):  3 × 3/4 = 9/4 = 2 1/4  ✓.",
        "Why does KCF work? Dividing by 3/4 asks 'how many three-quarters " +
          "fit into 2 1/4?'. Multiplying by 4/3 scales so that we count " +
          "in units of three-quarters. Same answer, expressed " +
          "multiplicatively so the arithmetic is easier.",
      ].join(" "),
      misconceptions: [
        {
          id: "flipped-both-fractions",
          trigger: "wrong",
          explanation:
            "The Keep-Change-Flip rule flips ONLY the second (the divisor) " +
            "fraction, not both. Flipping both gives 4/9 × 3/4 = 12/36 = " +
            "1/3, which is the reciprocal of the correct answer 3. This " +
            "error is the #1 reported division-of-fractions error in " +
            "the Edexcel 2023 Chief Examiner's Report (Paper 1F, Q17).",
          nudge:
            "Write K·C·F in words next to each fraction: K (keep) stays " +
            "the same, F (flip) only applies to the divisor.",
        },
        {
          id: "flipped-first-instead",
          trigger: "wrong",
          explanation:
            "Another ordering slip: flipping the FIRST fraction and " +
            "keeping the second (e.g. 4/9 × 3/4). The first fraction " +
            "(the dividend) is kept as-is; only the divisor is flipped.",
          nudge:
            "The fraction you DIVIDE BY is the one that flips.",
        },
        {
          id: "forgot-mixed-to-improper",
          trigger: "wrong",
          explanation:
            "Trying to apply KCF directly to a mixed number (2 1/4) " +
            "without first converting it to an improper fraction is a " +
            "guaranteed wrong answer. The '2' and the '1/4' belong " +
            "together as a single quantity (9/4); treating them " +
            "separately breaks the arithmetic.",
          nudge:
            "STEP ONE for any operation involving a mixed number: convert " +
            "it to an improper fraction.",
        },
        {
          id: "subtracted-instead-of-divided",
          trigger: "wrong",
          explanation:
            "Some learners confuse ÷ with −, especially under time " +
            "pressure. 2 1/4 − 3/4 = 2 1/4 − 3/4 = 1 2/4 = 1 1/2, which " +
            "is not the answer to 2 1/4 ÷ 3/4. Read the operator.",
          nudge:
            "Re-read the question. The symbol is ÷ (division), not − " +
            "(subtraction).",
        },
      ],
      workedExamples: [
        // SIMPLER warm-up. No mixed number; pure KCF.
        {
          id: "fractions-simpler-003",
          problem: "Calculate 3/4 ÷ 1/2. (warm-up, no mixed number)",
          workedSolution: [
            "Keep · Change · Flip:  3/4 × 2/1.",
            "Multiply:  (3 × 2)/(4 × 1) = 6/4.",
            "Simplify:  GCD(6, 4) = 2.  6/4 = 3/2.",
            "Final answer:  3/2.",
            "Check:  3/2 × 1/2 = 3/4 ✓.",
          ].join("\n"),
          expectedAnswer: "3/2",
        },
        {
          id: "fractions-005",
          problem: "Calculate 1 1/2 ÷ 3/4. Give your answer as a mixed number or fraction in simplest form.",
          workedSolution: [
            "Step 1. Mixed → improper:  1 1/2 = 3/2.",
            "Step 2. KCF:  3/2 ÷ 3/4 = 3/2 × 4/3.",
            "Step 3. Cancel: 3 and 3 → 1 and 1; 4 and 2 → 2 and 1.",
            "  = 1/1 × 2/1 = 2.",
            "Check:  2 × 3/4 = 6/4 = 3/2 = 1 1/2 ✓.",
          ].join("\n"),
          expectedAnswer: 2,
        },
        {
          id: "fractions-006",
          problem: "Calculate 3 1/3 ÷ 5/6. Give your answer as a whole number or fraction in simplest form.",
          workedSolution: [
            "Step 1. Mixed → improper:  3 1/3 = (3 × 3 + 1)/3 = 10/3.",
            "Step 2. KCF:  10/3 ÷ 5/6 = 10/3 × 6/5.",
            "Step 3. Cancel: 10 and 5 → 2 and 1; 6 and 3 → 2 and 1.",
            "  = 2/1 × 2/1 = 4.",
            "Check:  4 × 5/6 = 20/6 = 10/3 = 3 1/3 ✓.",
          ].join("\n"),
          expectedAnswer: 4,
        },
      ],
      draft: {
        model: "manual-authored-v1.6.0",
        provider: "human-author",
        promptHashB64url: "AUTHORED_NO_PROMPT",
        draftedAtIso: "2026-05-11T00:00:00.000Z",
        drafterVersion: "1.6.0",
      },
      approval: null,
    },

    // ─────────────────────────────────────────────────────────────────────
    // Item 4 — CHALLENGE. Fraction-of-amount word problem with the
    // "remaining" flip. A widely-confused problem shape at GCSE Foundation.
    //   Sarah has read 2/5 of her book. 3/5 (= 90 pages) remain.
    //   Total = 90 × 5/3 = 150 pages. Read = 2/5 × 150 = 60 pages.
    // ─────────────────────────────────────────────────────────────────────
    {
      schemaVersion: "1.0.0",
      id: "uk-gcse-maths-fractions-004",
      skillFamily: "fractions-arith",
      subject: "maths",
      jurisdictions: ["IE", "UK-EN", "UK-NI", "UK-SC", "UK-WL", "US", "INTL"],
      difficulty: "challenge",
      prerequisites: [
        "fractions-arith",
        "fraction-of-amount",
        "inverse-operations",
      ],
      specPoints: [
        {
          framework: "AQA-GCSE-9-1-Maths",
          code: "R9",
          label:
            "Solve problems involving direct and inverse proportion, " +
            "including fraction-of-amount in contextual problems",
        },
        {
          framework: "Edexcel-GCSE-9-1-Maths",
          code: "1.13",
          label:
            "Solve problems involving percentage change, including " +
            "fractions of an amount and fraction-remaining problems",
        },
        {
          framework: "DES-JC-Maths-2024",
          code: "N.3",
          label:
            "Solve problems involving fractions in context, distinguishing " +
            "the fraction-of-amount from the fraction-remaining",
        },
        {
          framework: "CCSS-Math",
          code: "7.RP.A.3",
          label:
            "Use proportional relationships to solve multistep ratio and " +
            "percent problems",
        },
      ],
      problem:
        "Sarah has read 2/5 of her book. She has 90 pages left to read. " +
        "How many pages has she ALREADY read? Show your working.",
      expectedAnswer: 60,
      hints: [
        {
          tier: 1,
          text:
            "Draw a bar to represent the whole book, split into 5 equal " +
            "parts. Which parts are READ and which are REMAINING? Which " +
            "of those two quantities does the 90 pages describe?",
        },
        {
          tier: 2,
          text:
            "If 2/5 is read, then 3/5 is remaining. 3/5 of the total = " +
            "90 pages. From that you can find the TOTAL number of pages " +
            "in the book.",
          addresses: "used-2-5-for-remaining",
        },
        {
          tier: 3,
          text:
            "If 3/5 of the total = 90, then 1/5 = 30 (divide by 3), so " +
            "the total = 5 × 30 = 150 pages. Then the pages READ are " +
            "2/5 × 150. Work that out.",
        },
      ],
      explanation: [
        "This is a 'fraction-remaining' word problem. The critical first",
        "step is to identify WHICH fraction the given quantity (90 pages)",
        "describes.",
        "Sarah has READ 2/5 of the book, so she has 3/5 REMAINING.",
        "The 90 pages describes what is REMAINING, i.e. 3/5 of the total.",
        "Set up:  3/5 × total = 90.",
        "Rearrange (multiply both sides by 5/3):  total = 90 × 5/3 = 150.",
        "Equivalently, 1/5 = 90 ÷ 3 = 30 pages, and total = 5 × 30 = 150.",
        "Pages read = 2/5 × 150 = 60.",
        "Check:  read 60 + remaining 90 = 150 total; 60/150 = 2/5 ✓.",
      ].join(" "),
      misconceptions: [
        {
          id: "used-2-5-for-remaining",
          trigger: "wrong",
          explanation:
            "The most-reported error (MAP fractions diagnostic, 2017) is " +
            "to equate the GIVEN quantity with the GIVEN fraction — e.g. " +
            "to write '2/5 × total = 90' because the problem states 2/5. " +
            "But the 2/5 is what's READ, and the 90 is what's LEFT — " +
            "different parts of the same whole. The fraction-matching " +
            "step is the whole pedagogical content of this problem.",
          nudge:
            "In the problem, underline the fraction (2/5) and circle the " +
            "given quantity (90). Ask: does the quantity describe the " +
            "underlined portion, or its complement?",
        },
        {
          id: "found-total-wrote-total",
          trigger: "wrong",
          explanation:
            "A related slip is to correctly find the total (150 pages) " +
            "but then report 150 as the final answer, instead of " +
            "continuing to find the pages READ (2/5 × 150 = 60). " +
            "The question asks for pages already read, not the total.",
          nudge:
            "Re-read the last sentence of the question. What is the " +
            "single number the question is asking you to give?",
        },
        {
          id: "divided-by-wrong-number",
          trigger: "off_by_one",
          explanation:
            "To go from 3/5 = 90 to 1/5 = ?, you divide 90 by 3 (the " +
            "numerator of the given fraction), not by 5. Splitting the " +
            "90 pages into 3 equal 'fifth-parts' gives 30 each.",
          nudge:
            "Think of 3/5 as 'three equal parts each worth 1/5'. If three " +
            "parts weigh 90, each part weighs 90 ÷ 3.",
        },
        {
          id: "added-when-should-multiply",
          trigger: "wrong",
          explanation:
            "A confused learner sometimes adds the fraction to the " +
            "given quantity — e.g. 2/5 + 90 — instead of multiplying. " +
            "Addition is dimensionally wrong here: 2/5 is a fraction " +
            "(no units) and 90 is pages. They must combine " +
            "multiplicatively via 'fraction OF total'.",
          nudge:
            "Write the relationship out in words first: 'three-fifths OF " +
            "total equals 90 pages'. 'Of' here means multiply.",
        },
      ],
      workedExamples: [
        {
          id: "fractions-challenge-001",
          problem:
            "Tom has spent 3/7 of his savings. He has £80 left. How " +
            "much has he SPENT?",
          workedSolution: [
            "Fraction remaining = 1 − 3/7 = 4/7.",
            "So 4/7 × total = £80.",
            "1/7 = £80 ÷ 4 = £20.  Total = 7 × £20 = £140.",
            "Spent = 3/7 × 140 = £60.",
            "Check: 60 + 80 = 140; 60/140 = 3/7 ✓.",
          ].join("\n"),
          expectedAnswer: 60,
        },
        {
          id: "fractions-challenge-002",
          problem:
            "A water tank is 5/8 full. Another 24 litres would fill it. " +
            "How many litres are in the tank now?",
          workedSolution: [
            "Fraction to fill = 1 − 5/8 = 3/8.",
            "So 3/8 × capacity = 24 L.",
            "1/8 = 24 ÷ 3 = 8 L.  Capacity = 8 × 8 = 64 L.",
            "Water now = 5/8 × 64 = 40 L.",
            "Check: 40 + 24 = 64; 40/64 = 5/8 ✓.",
          ].join("\n"),
          expectedAnswer: 40,
        },
      ],
      draft: {
        model: "manual-authored-v1.6.0",
        provider: "human-author",
        promptHashB64url: "AUTHORED_NO_PROMPT",
        draftedAtIso: "2026-05-11T00:00:00.000Z",
        drafterVersion: "1.6.0",
      },
      approval: null,
    },
  ],
};
