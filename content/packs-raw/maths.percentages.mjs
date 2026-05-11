// ─────────────────────────────────────────────────────────────────────────────
// content/packs-raw/maths.percentages.mjs
//
// v1.6.0 — Authored content pack: percentages, percentage change,
// reverse percentages, and compound-interest word problems. Every
// item is framed with a financial-literacy or school-context stem so
// the maths immediately connects to a situation the learner recognises.
//
// AUTHORING PROVENANCE
// ────────────────────
// Plain-English, hand-authored (human-author). NO language model in the
// draft loop. `draft.model = "manual-authored-v1.6.0"` records this.
//
// CURRICULUM GROUNDING
// ────────────────────
//   • National Curriculum Mathematics (England) KS3/KS4 — Number / Ratio
//   • AQA GCSE 9-1 Mathematics (N12, N13, R9)
//   • Edexcel GCSE 9-1 Mathematics (1.12, 1.13, 2.7)
//   • OCR GCSE 9-1 Mathematics (3.06)
//   • DES Junior Cycle Mathematics 2024 (N.2)
//   • CCSS Mathematics 7.RP.A.3 (HSA-SSE in contextual use)
//
// MISCONCEPTIONS EVIDENCE BASE
// ────────────────────────────
//   • APU (Assessment of Performance Unit), 1983: "The understanding of
//     percentages in 11- to 15-year-olds" — misconception library.
//   • Mathematics Assessment Project (MAP), "Increasing and Decreasing
//     Quantities by a Percent" and "Interpreting Percents".
//   • Hart, K. (1981). CSMS study ch. 7 "Ratio and Proportion" — the
//     'one hundred minus' reflex in reverse-percentage problems.
//   • NCETM Secondary Mastery PD Materials — "Percentage change" common
//     errors catalogue (2019).
//   • Edexcel GCSE Chief Examiner Report 2022 Paper 1F — compound vs
//     simple interest confusion.
//   • AQA GCSE Chief Examiner Report 2021 Paper 2F — multiplier-as-
//     decimal slips (×0.15 instead of ×1.15).
//
// RUNTIME NOTES
// ─────────────
// Every item has an INTEGER expectedAnswer (276, 75, 85, 1331), so all
// four are fully runtime-checkable by the existing numeric checker.
// Item 4 uses a 10% compound rate so the multiplier (1.1)^3 = 1.331
// multiplies a round principal (£1000) to an integer answer (£1331),
// keeping the pedagogy about the MECHANISM of compounding rather than
// decimal arithmetic.
// ─────────────────────────────────────────────────────────────────────────────

/** @type {import("../../lib/content/schema.ts").SchemaContentPack} */
export const pack = {
  schemaVersion: "1.0.0",
  id: "maths.percentages",
  title: "Percentages, percentage change, reverse percentages, and compound interest",
  subject: "maths",
  skillFamily: "percentages",
  metadata: {
    version: "1.0.0",
    builtAtIso: "PLACEHOLDER_BUILT_AT",
    description:
      "Percentage calculations across the KS3→KS4 bridge, with a strong " +
      "financial-literacy framing. Covers forward percentage change " +
      "(as a multiplier), finding one quantity as a percentage of " +
      "another, reverse percentages, and year-on-year compound interest. " +
      "Curriculum-aligned to AQA GCSE 9-1, Edexcel GCSE 9-1, OCR GCSE " +
      "9-1, DES Junior Cycle, and CCSS 7.RP. Misconceptions grounded " +
      "in the APU 1983 percentages study, the MAP percentages library, " +
      "the Hart CSMS study, NCETM mastery materials, and AQA + Edexcel " +
      "chief examiner reports 2021–2023.",
  },
  items: [
    // ─────────────────────────────────────────────────────────────────────
    // Item 1 — CORE. Percentage increase via a multiplier.
    //   £240 increased by 15%  →  240 × 1.15 = £276
    // ─────────────────────────────────────────────────────────────────────
    {
      schemaVersion: "1.0.0",
      id: "uk-gcse-maths-percentages-001",
      skillFamily: "percentages",
      subject: "maths",
      jurisdictions: ["IE", "UK-EN", "UK-NI", "UK-SC", "UK-WL", "US", "INTL"],
      difficulty: "core",
      prerequisites: [
        "fractions-arith",
        "decimals-four-ops",
        "percentage-of-amount",
      ],
      specPoints: [
        {
          framework: "AQA-GCSE-9-1-Maths",
          code: "N12",
          label:
            "Interpret fractions and percentages as operators; apply " +
            "percentage increase and decrease using a multiplier",
        },
        {
          framework: "Edexcel-GCSE-9-1-Maths",
          code: "1.12",
          label:
            "Work with percentages as operators; percentage change using " +
            "a single multiplier",
        },
        {
          framework: "DES-JC-Maths-2024",
          code: "N.2",
          label:
            "Perform percentage calculations, including percentage change",
        },
        {
          framework: "CCSS-Math",
          code: "7.RP.A.3",
          label:
            "Use proportional relationships to solve multistep ratio " +
            "and percent problems",
        },
      ],
      problem:
        "A bicycle is priced at £240. The shop adds 15% VAT at the till. " +
        "What is the FINAL price the customer pays? Give your answer " +
        "in pounds. Use a multiplier — do NOT calculate 15% separately " +
        "and add.",
      expectedAnswer: 276,
      hints: [
        {
          tier: 1,
          text:
            "An increase of 15% means the final price is 100% + 15% = " +
            "115% of the original. What number do you multiply by to " +
            "compute 115% of something?",
        },
        {
          tier: 2,
          text:
            "115% as a decimal is 1.15. So the final price = 240 × 1.15. " +
            "Compute that. (Trick: 240 × 1.15 = 240 + 240 × 0.15 = 240 + 36.)",
          addresses: "used-decimal-percent-directly",
        },
        {
          tier: 3,
          text:
            "240 × 1.15 = 276. The '+ 15%' maps to '× 1.15' (not '× 0.15'). " +
            "Compounding this into a single multiplier is the standard " +
            "GCSE move — it generalises cleanly to decreases (× 0.85) " +
            "and to compound interest (repeated multiplication).",
        },
      ],
      explanation: [
        "A percentage INCREASE of p% can be computed as a single",
        "multiplication by (1 + p/100).",
        "For p = 15:  multiplier = 1 + 15/100 = 1.15.",
        "Final price = original × multiplier = 240 × 1.15.",
        "To compute 240 × 1.15 mentally:  240 × 1 = 240; 240 × 0.15 = 36;",
        "sum = 276.  So the final price is £276.",
        "Why the multiplier-in-one-step? Because it generalises. A",
        "DECREASE of 20% is × 0.80 (1 − 0.20). Three successive 5%",
        "increases compound as × 1.05³. And reverse-percentage problems",
        "become single divisions rather than awkward subtractions.",
      ].join(" "),
      misconceptions: [
        {
          id: "used-decimal-percent-directly",
          trigger: "wrong",
          explanation:
            "A common slip (AQA 2021 Paper 2F examiner's report) is to " +
            "multiply by 0.15 instead of 1.15, getting £36 (the INCREASE " +
            "itself) rather than the final price. 0.15 is the amount of " +
            "the change; 1.15 is the multiplier that gives the final " +
            "quantity in a single step.",
          nudge:
            "Check: does your multiplier include the ORIGINAL 100% " +
            "(giving a number > 1) or only the change (giving a decimal " +
            "< 1)? For an INCREASE, the multiplier is always > 1.",
        },
        {
          id: "added-percent-to-amount",
          trigger: "wrong",
          explanation:
            "Treating the 15 as if it were currency — e.g. 240 + 15 = 255 " +
            "— confuses a percentage (a ratio) with an absolute amount. " +
            "15% of £240 is £36, not £15.",
          nudge:
            "Before adding anything, compute the actual percentage amount " +
            "in pounds (15% of £240 = £36), then add that.",
        },
        {
          id: "percent-of-wrong-base",
          trigger: "wrong",
          explanation:
            "Some learners compute 15% of 100 (getting 15) and add to " +
            "240. The 15% is measured against the £240, not against £100. " +
            "This is only the same when the base happens to be 100.",
          nudge:
            "The base for the percentage is the original amount (£240 " +
            "here), not a flat 100.",
        },
        {
          id: "off-by-one-arithmetic-slip",
          trigger: "off_by_one",
          explanation:
            "An off-by-one usually means a small slip in the 240 × 0.15 " +
            "step. 240 × 0.15 = 36, not 35 or 37. Redo on a fresh line.",
          nudge:
            "240 × 0.15 = 240 × 15 / 100 = 3600 / 100 = 36.",
        },
      ],
      workedExamples: [
        {
          id: "percentages-simpler-001",
          problem:
            "A £80 jumper is reduced by 25% in a sale. Final price? (warm-up)",
          workedSolution: [
            "25% DECREASE → multiplier = 1 − 0.25 = 0.75.",
            "Final price = 80 × 0.75 = £60.",
            "Sanity check: 25% off means a quarter off; £20 off £80 = £60 ✓.",
          ].join("\n"),
          expectedAnswer: 60,
        },
        {
          id: "percentages-001",
          problem: "A £150 concert ticket has a 12% booking fee added. Final cost?",
          workedSolution: [
            "12% INCREASE → multiplier = 1 + 0.12 = 1.12.",
            "Final cost = 150 × 1.12 = 168.",
            "Check: 12% of £150 = £18; £150 + £18 = £168 ✓.",
          ].join("\n"),
          expectedAnswer: 168,
        },
        {
          id: "percentages-002",
          problem: "A £320 phone is reduced by 30% in a sale. Sale price?",
          workedSolution: [
            "30% DECREASE → multiplier = 1 − 0.30 = 0.70.",
            "Sale price = 320 × 0.70 = 224.",
            "Check: 30% of £320 = £96; £320 − £96 = £224 ✓.",
          ].join("\n"),
          expectedAnswer: 224,
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
    // Item 2 — CORE. Expressing one quantity as a percentage of another.
    //   45 out of 60  →  45/60 × 100 = 75%
    // ─────────────────────────────────────────────────────────────────────
    {
      schemaVersion: "1.0.0",
      id: "uk-gcse-maths-percentages-002",
      skillFamily: "percentages",
      subject: "maths",
      jurisdictions: ["IE", "UK-EN", "UK-NI", "UK-SC", "UK-WL", "US", "INTL"],
      difficulty: "core",
      prerequisites: [
        "fractions-equivalence",
        "fraction-to-percent-conversion",
      ],
      specPoints: [
        {
          framework: "AQA-GCSE-9-1-Maths",
          code: "R9",
          label:
            "Express one quantity as a percentage of another; compare " +
            "two quantities using percentages",
        },
        {
          framework: "Edexcel-GCSE-9-1-Maths",
          code: "1.12",
          label:
            "Express one quantity as a percentage of another",
        },
        {
          framework: "DES-JC-Maths-2024",
          code: "N.2",
          label: "Express one quantity as a percentage of another",
        },
        {
          framework: "CCSS-Math",
          code: "6.RP.A.3.c",
          label:
            "Find a percent of a quantity as a rate per 100; solve " +
            "problems involving finding the whole, given a part and the " +
            "percent",
        },
      ],
      problem:
        "Maya scores 45 out of 60 on a spelling test. Express her score " +
        "as a percentage. Give your answer as an integer percentage.",
      expectedAnswer: 75,
      hints: [
        {
          tier: 1,
          text:
            "A percentage is a fraction scaled so the denominator is 100. " +
            "What is Maya's score as a fraction?",
        },
        {
          tier: 2,
          text:
            "45 out of 60 is the fraction 45/60. To convert to a " +
            "percentage, multiply by 100%. What is 45/60 × 100?",
        },
        {
          tier: 3,
          text:
            "45/60 × 100 = 4500/60. Divide: 4500 ÷ 60 = 75. So Maya " +
            "scored 75%. (You can also simplify 45/60 to 3/4 first, then " +
            "3/4 = 75/100 = 75%.)",
          addresses: "reversed-fraction-direction",
        },
      ],
      explanation: [
        "To express a quantity A as a percentage of B:",
        "  A as a % of B  =  (A / B) × 100%.",
        "Here A = 45 (score) and B = 60 (maximum possible).",
        "  45 / 60 = 3/4  (dividing both by 15).",
        "  3/4 × 100 = 75.  So Maya scored 75%.",
        "A direct route: 45/60 × 100 = 4500/60 = 75.",
        "Sanity check by working backwards: 75% of 60 = 0.75 × 60 = 45.  ✓",
      ].join(" "),
      misconceptions: [
        {
          id: "reversed-fraction-direction",
          trigger: "wrong",
          explanation:
            "Writing 60/45 × 100 gets you 133.33…%, which is not a valid " +
            "score and is a signal you've set up the fraction upside-down. " +
            "The thing you MEASURE (the score, 45) is on top; the MAXIMUM " +
            "(60) is on the bottom. 'A as a % of B' is A/B, not B/A.",
          nudge:
            "Say it in words: 'what fraction of the test did Maya get " +
            "right?' That's score-over-maximum, not the other way round.",
        },
        {
          id: "forgot-times-100",
          trigger: "wrong",
          explanation:
            "Writing '45/60 = 0.75' and stopping is a common slip. 0.75 " +
            "is the DECIMAL; the percentage is × 100 = 75%. (For some " +
            "learners it helps to remember that PER CENT literally means " +
            "'per hundred' — the denominator is 100.)",
          nudge:
            "After dividing, multiply the decimal by 100 to get the " +
            "percentage. 0.75 × 100 = 75.",
        },
        {
          id: "multiplied-by-60-instead",
          trigger: "wrong",
          explanation:
            "Writing 45 × 100 / 60 mixes up the order of operations and " +
            "can mislead. Actually this gets the right answer (75), but " +
            "learners who write it this way often then divide in the " +
            "wrong order and get 45 × 60 / 100 = 27, which is wrong.",
          nudge:
            "Write the division first:  (45/60) × 100. The fraction is " +
            "in its own bracket, then multiplied by 100.",
        },
        {
          id: "off-by-one-arithmetic-slip",
          trigger: "off_by_one",
          explanation:
            "An off-by-one usually means an arithmetic slip in the " +
            "division step. 4500 ÷ 60 = 75, not 74 or 76.",
          nudge:
            "Check: 75 × 60 = 4500 ✓.",
        },
      ],
      workedExamples: [
        {
          id: "percentages-003",
          problem: "Jamal scores 24 out of 40 on a quiz. Express as a percentage.",
          workedSolution: [
            "24/40 × 100.",
            "Simplify first: 24/40 = 3/5 (divide both by 8).",
            "3/5 × 100 = 60.  Jamal scored 60%.",
            "Check: 60% of 40 = 0.60 × 40 = 24 ✓.",
          ].join("\n"),
          expectedAnswer: 60,
        },
        {
          id: "percentages-004",
          problem: "A class of 25 has 20 students present today. Attendance percentage?",
          workedSolution: [
            "20/25 × 100.",
            "Simplify first: 20/25 = 4/5.",
            "4/5 × 100 = 80.  Attendance is 80%.",
          ].join("\n"),
          expectedAnswer: 80,
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
    // Item 3 — STRETCH. Reverse percentages.
    //   After 20% off, final price is £68. Original?  68 / 0.80 = £85.
    //
    // The 'one hundred minus' trap (Hart 1981 CSMS) is THE defining
    // misconception here. Explicitly counter-exemplified.
    // ─────────────────────────────────────────────────────────────────────
    {
      schemaVersion: "1.0.0",
      id: "uk-gcse-maths-percentages-003",
      skillFamily: "percentages",
      subject: "maths",
      jurisdictions: ["IE", "UK-EN", "UK-NI", "UK-SC", "UK-WL", "US", "INTL"],
      difficulty: "stretch",
      prerequisites: [
        "percentages",
        "inverse-operations",
      ],
      specPoints: [
        {
          framework: "AQA-GCSE-9-1-Maths",
          code: "N13",
          label:
            "Solve reverse-percentage problems (finding the original " +
            "amount given the percentage change and the final amount)",
        },
        {
          framework: "Edexcel-GCSE-9-1-Maths",
          code: "1.13",
          label:
            "Solve problems involving percentage change, including " +
            "reverse percentages",
        },
        {
          framework: "OCR-GCSE-9-1-Maths",
          code: "3.06a",
          label: "Reverse percentage (finding the pre-change amount)",
        },
        {
          framework: "DES-JC-Maths-2024",
          code: "N.2",
          label:
            "Solve reverse-percentage problems, including sale-price and " +
            "VAT-removal contexts",
        },
      ],
      problem:
        "In a sale, all items are reduced by 20%. Keira pays £68 for a " +
        "jacket after the discount. What was the ORIGINAL (pre-sale) " +
        "price, in pounds?",
      expectedAnswer: 85,
      hints: [
        {
          tier: 1,
          text:
            "A 20% discount means the sale price is 80% of the original. " +
            "So £68 represents 80% of the original price. If 80% of X " +
            "is 68, how do you find X?",
        },
        {
          tier: 2,
          text:
            "80% of X = 68 can be written as 0.80 × X = 68. To isolate X, " +
            "DIVIDE both sides by 0.80 (not subtract — this is the " +
            "single biggest trap in reverse percentages).",
          addresses: "added-the-percentage-back",
        },
        {
          tier: 3,
          text:
            "X = 68 / 0.80 = 85. So the original price was £85. Sanity " +
            "check by going forward: 20% off £85 = £85 × 0.80 = £68 ✓.",
        },
      ],
      explanation: [
        "A reverse-percentage problem gives you the FINAL amount after " +
          "a change and asks for the ORIGINAL. The method is to undo the " +
          "multiplier: divide, not add back.",
        "Set up:  sale price = original × multiplier.",
        "For a 20% DISCOUNT, multiplier = 0.80 (= 1 − 0.20).",
        "So:  68 = original × 0.80.",
        "Rearrange:  original = 68 / 0.80 = 85.",
        "THE WRONG METHOD  (Hart 1981 CSMS calls this the 'one hundred " +
          "minus' reflex):  adding 20% back to £68 gives £68 + £13.60 = " +
          "£81.60, which is NOT the original. Why? Because 20% of £68 is " +
          "not the same as 20% of the original £85; the 20% discount was " +
          "taken from the bigger number.",
        "Check the RIGHT answer by going forward:  £85 × 0.80 = £68  ✓.",
        "Check the WRONG 'add-back' answer:  £81.60 × 0.80 = £65.28, " +
          "which is NOT £68. That's how you spot it.",
      ].join(" "),
      misconceptions: [
        {
          id: "added-the-percentage-back",
          trigger: "wrong",
          explanation:
            "The single most-reported reverse-percentage error is to " +
            "'add the 20% back' — i.e. compute £68 + 20% × £68 = £68 + " +
            "£13.60 = £81.60. This is wrong because the 20% was taken " +
            "from the ORIGINAL price (£85), not from £68. 20% of £85 " +
            "is £17, not £13.60. The forward-check fails: £81.60 × 0.80 " +
            "= £65.28, which is not £68.",
          nudge:
            "Write the relationship as a SINGLE multiplication:  sale " +
            "= original × 0.80. To undo, divide by 0.80 — do not subtract " +
            "a percentage.",
        },
        {
          id: "divided-by-20-percent",
          trigger: "wrong",
          explanation:
            "Dividing £68 by 0.20 gives £340 — nowhere near the answer. " +
            "The 0.20 is the DISCOUNT fraction, not the multiplier. The " +
            "multiplier for a 20% decrease is 0.80.",
          nudge:
            "For a p% decrease, the multiplier is (1 − p/100). Divide " +
            "by that — not by p/100 itself.",
        },
        {
          id: "multiplied-instead-of-divided",
          trigger: "wrong",
          explanation:
            "Computing £68 × 0.80 = £54.40 applies the discount AGAIN, " +
            "moving further away from the original. In a reverse problem " +
            "you DIVIDE by the multiplier to go backwards.",
          nudge:
            "Going BACKWARDS from sale to original inverts the operation: " +
            "multiplication becomes division.",
        },
        {
          id: "used-correct-multiplier-wrong-direction",
          trigger: "wrong",
          explanation:
            "Using the 1.20 multiplier (as if the 20% were being ADDED) " +
            "instead of 0.80 gives £68 / 1.20 ≈ £56.67 — also wrong. The " +
            "problem is a DECREASE, so the multiplier is less than 1.",
          nudge:
            "Re-read the problem: is the change an increase or a decrease? " +
            "For a decrease, the multiplier is less than 1.",
        },
      ],
      workedExamples: [
        {
          id: "percentages-simpler-003",
          problem:
            "After a 10% discount a book costs £18. Original price? (warm-up)",
          workedSolution: [
            "10% off → multiplier 0.90.",
            "18 = original × 0.90.",
            "original = 18 / 0.90 = 20.",
            "Check:  £20 × 0.90 = £18 ✓.",
          ].join("\n"),
          expectedAnswer: 20,
        },
        {
          id: "percentages-005",
          problem:
            "After VAT at 20% is added, a TV costs £360. Pre-VAT price?",
          workedSolution: [
            "20% INCREASE → multiplier 1.20.",
            "360 = pre-VAT × 1.20.",
            "pre-VAT = 360 / 1.20 = 300.",
            "Check:  £300 × 1.20 = £360 ✓.",
          ].join("\n"),
          expectedAnswer: 300,
        },
        {
          id: "percentages-006",
          problem:
            "After a 15% pay rise, Ciara earns £46 per hour. Her old hourly rate?",
          workedSolution: [
            "15% INCREASE → multiplier 1.15.",
            "46 = old × 1.15.",
            "old = 46 / 1.15 = 40.",
            "Check:  £40 × 1.15 = £46 ✓.",
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

    // ─────────────────────────────────────────────────────────────────────
    // Item 4 — CHALLENGE. Compound interest.
    //   £1000 at 10% compound for 3 years = 1000 × 1.1³ = 1331.
    //   Integer answer, no calculator strictly needed:
    //     1.1² = 1.21;  1.21 × 1.1 = 1.331;  1000 × 1.331 = 1331.
    // ─────────────────────────────────────────────────────────────────────
    {
      schemaVersion: "1.0.0",
      id: "uk-gcse-maths-percentages-004",
      skillFamily: "percentages",
      subject: "maths",
      jurisdictions: ["IE", "UK-EN", "UK-NI", "UK-SC", "UK-WL", "US", "INTL"],
      difficulty: "challenge",
      prerequisites: [
        "percentages",
        "percentage-change-multiplier",
        "powers-of-decimals",
      ],
      specPoints: [
        {
          framework: "AQA-GCSE-9-1-Maths",
          code: "R16",
          label:
            "Solve problems involving repeated proportional change, " +
            "including compound interest",
        },
        {
          framework: "Edexcel-GCSE-9-1-Maths",
          code: "1.13",
          label:
            "Solve problems involving compound interest and " +
            "depreciation over multiple periods",
        },
        {
          framework: "OCR-GCSE-9-1-Maths",
          code: "3.06b",
          label: "Compound interest and exponential growth / decay",
        },
        {
          framework: "DES-JC-Maths-2024",
          code: "N.2",
          label:
            "Calculate compound interest and investigate the effect of " +
            "different compounding periods",
        },
        {
          framework: "CCSS-Math",
          code: "HSF-LE.A.2",
          label:
            "Construct linear and exponential functions, including " +
            "arithmetic and geometric sequences, given a description " +
            "of a relationship",
        },
      ],
      problem:
        "Amira invests £1000 at 10% compound interest per year. How much " +
        "is in the account at the end of 3 years? Give your answer in " +
        "whole pounds. Show the multiplier method — do NOT use simple " +
        "interest.",
      expectedAnswer: 1331,
      hints: [
        {
          tier: 1,
          text:
            "Compound interest means the interest each year is calculated " +
            "on the balance AT THE START OF THAT YEAR, which itself " +
            "includes previous interest. What multiplier takes the start-" +
            "of-year balance to the end-of-year balance?",
        },
        {
          tier: 2,
          text:
            "10% interest → multiplier 1.10. After year 1 balance = " +
            "1000 × 1.10 = 1100. After year 2 balance = 1100 × 1.10. " +
            "After year 3 = that × 1.10. Combined: 1000 × 1.10³.",
          addresses: "applied-simple-interest-instead",
        },
        {
          tier: 3,
          text:
            "1.10³ = 1.331 (compute 1.1² = 1.21, then 1.21 × 1.1 = 1.331). " +
            "So 1000 × 1.331 = 1331. The account holds £1331 at the end of " +
            "3 years — £331 of interest, compared to £300 under simple " +
            "interest at the same rate.",
        },
      ],
      explanation: [
        "Compound interest applies the percentage to the WHOLE balance",
        "each year — including any interest already earned.",
        "After year 1: balance = 1000 × 1.10 = 1100.",
        "After year 2: balance = 1100 × 1.10 = 1210.",
        "After year 3: balance = 1210 × 1.10 = 1331.",
        "Equivalently, end balance = 1000 × 1.10³.",
        "Computing 1.10³ without a calculator: 1.1² = 1.21, and 1.21 × " +
          "1.1 = 1.21 + 0.121 = 1.331. Hence 1000 × 1.331 = 1331.",
        "Comparison with SIMPLE interest (where each year's interest is " +
          "10% of the ORIGINAL £1000, so £100 per year): 1000 + 3 × 100 = " +
          "1300. The extra £31 under compound interest is the interest " +
          "earned on previous interest.",
        "General formula:  A = P × (1 + r/100)^n",
        "  where P = principal, r = rate per period, n = number of periods.",
      ].join(" "),
      misconceptions: [
        {
          id: "applied-simple-interest-instead",
          trigger: "wrong",
          explanation:
            "Applying SIMPLE interest (getting £1300) is the #1 " +
            "compound-interest error, reported every year in the Edexcel " +
            "and AQA chief examiner reports. Simple interest = P × (1 + " +
            "r × n /100) — the rate is multiplied by the number of years. " +
            "Compound interest = P × (1 + r/100)^n — the multiplier is " +
            "raised to the power of the number of years. For 3 years at " +
            "10%, simple gives 1300, compound gives 1331; the difference " +
            "grows fast for longer periods and higher rates.",
          nudge:
            "Read the problem again — does it say SIMPLE or COMPOUND? " +
            "The word determines whether you multiply by (1 + rn/100) or " +
            "by (1 + r/100)^n.",
        },
        {
          id: "multiplied-by-3-instead-of-cubed",
          trigger: "wrong",
          explanation:
            "Writing 1000 × 1.10 × 3 = 3300 confuses REPEATED " +
            "multiplication (× 1.10 each year) with multiplying by 3 " +
            "once. For 3 years you apply × 1.10 three times, which is " +
            "× 1.10³, not × 3.30.",
          nudge:
            "Think of each year as a separate step. At the end of year " +
            "1 the balance is multiplied by 1.10. At the end of year 2, " +
            "the NEW balance is multiplied by 1.10. And so on.",
        },
        {
          id: "used-decimal-percent-for-multiplier",
          trigger: "wrong",
          explanation:
            "Writing 1000 × 0.10³ = £1 confuses the INTEREST RATE " +
            "(0.10) with the MULTIPLIER (1.10). For an INCREASE the " +
            "multiplier is ALWAYS greater than 1. A multiplier less than " +
            "1 would represent a decrease (depreciation).",
          nudge:
            "The multiplier for a p% gain is (1 + p/100), not p/100. " +
            "For 10% it is 1.10.",
        },
        {
          id: "added-percentage-each-year",
          trigger: "wrong",
          explanation:
            "Adding 10% of £1000 each year (£100 × 3 = £300 added) gives " +
            "£1300 — the simple-interest answer. This is the classic " +
            "'ignored the compounding' trap. Under compound interest, " +
            "the year-2 interest is 10% of £1100 (not £1000), and the " +
            "year-3 interest is 10% of £1210.",
          nudge:
            "In year 2, what is 10% OF? Not the starting £1000 — it's " +
            "the balance at the end of year 1.",
        },
      ],
      workedExamples: [
        {
          id: "percentages-challenge-001",
          problem:
            "£500 is invested at 4% compound interest per year. Value " +
            "after 2 years? (Give answer to nearest whole pound.)",
          workedSolution: [
            "Multiplier = 1.04. After 2 years: 500 × 1.04².",
            "1.04² = 1.04 × 1.04 = 1.0816.",
            "500 × 1.0816 = 540.80, which rounds to £541.",
            "Check: year 1 → 500 × 1.04 = 520; year 2 → 520 × 1.04 =",
            "540.80 ✓.",
          ].join("\n"),
          expectedAnswer: 541,
        },
        {
          id: "percentages-challenge-002",
          problem:
            "A car worth £8000 depreciates by 20% per year for 3 years. " +
            "Value at the end of 3 years?",
          workedSolution: [
            "Depreciation = DECREASE, multiplier = 0.80.",
            "Value = 8000 × 0.80³.",
            "0.80² = 0.64;  0.64 × 0.80 = 0.512.",
            "8000 × 0.512 = 4096.  Car is worth £4096.",
            "Check year-by-year:  8000 → 6400 → 5120 → 4096 ✓.",
          ].join("\n"),
          expectedAnswer: 4096,
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
