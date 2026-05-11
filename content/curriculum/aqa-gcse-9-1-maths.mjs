// ─────────────────────────────────────────────────────────────────────────────
// content/curriculum/aqa-gcse-9-1-maths.mjs
//
// AQA GCSE Mathematics 9-1 (8300) — partial seed.
// Codes are AQA's published spec-point numbers. Labels paraphrase the
// awarding body's phrasing; ALWAYS treat (framework, code) as canonical.
//
// Coverage: every code referenced by content/packs-raw/* is present, plus
// a handful of neighbouring spec-points so the coverage dashboard shows
// realistic partial coverage rather than 100% on the seed set.
//
// Reference: https://www.aqa.org.uk/subjects/mathematics/gcse/mathematics-8300
// ─────────────────────────────────────────────────────────────────────────────

export default {
  id: "AQA-GCSE-9-1-Maths",
  name: "AQA GCSE Mathematics (8300)",
  awardingBody: "AQA",
  jurisdiction: "UK-EN",
  yearStart: 10,
  yearEnd: 11,
  references: [
    "https://www.aqa.org.uk/subjects/mathematics/gcse/mathematics-8300",
  ],
  specPoints: [
    // Number
    { code: "N2", topic: "Number", label: "Apply the four operations to integers, decimals and fractions, including mixed numbers" },
    { code: "N12", topic: "Number", label: "Interpret fractions and percentages as operators; apply percentages, including reverse percentages" },
    { code: "N13", topic: "Number", label: "Solve reverse-percentage problems and compound interest" },
    // Algebra
    { code: "A17", topic: "Algebra", label: "Solve linear equations in one unknown algebraically" },
    { code: "A18", topic: "Algebra", label: "Solve quadratic equations algebraically by factorising, completing the square, and the quadratic formula" },
    { code: "A19", topic: "Algebra", label: "Set up and solve quadratic equations arising from problems" },
    { code: "A21", topic: "Algebra", label: "Translate situations into algebraic expressions; derive and solve equations from contextual problems" },
    // Ratio & proportion
    { code: "R9", topic: "Ratio & proportion", label: "Express one quantity as a percentage of another; compare via ratio and percentage" },
    { code: "R16", topic: "Ratio & proportion", label: "Solve problems involving repeated proportional change, including compound interest and depreciation" },
    // Geometry — included as uncovered spec-points so the dashboard shows partial coverage.
    { code: "G14", topic: "Geometry", label: "Use the standard ruler-and-compass constructions" },
    { code: "G15", topic: "Geometry", label: "Apply Pythagoras' theorem and trigonometric ratios in 2D" },
    { code: "S2", topic: "Statistics", label: "Interpret cumulative-frequency, box-plot and histogram displays" },
  ],
};
