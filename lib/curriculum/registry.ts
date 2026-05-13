// ─────────────────────────────────────────────────────────────────────────────
// lib/curriculum/registry.ts
//
// v1.8.0 — Phase-A curriculum registry.
//
// PURPOSE
// ───────
// The claim vocabulary in `lib/vc/claim-vocabulary.ts` carries
// (framework, code) as the canonical identifier of a spec-point claim
// and leaves `skillUri` and `label` as optional, back-fillable
// conveniences. That works fine for issuing — the teacher knows what
// they meant. But three pieces of downstream tooling want more:
//
//   • The verifier wants to *check* that a (framework, code) pair is
//     a real claim, not a typo. A claim of (`AQA`, `Z99`) should be
//     suspicious even if the signature is valid.
//   • The standalone verifier page wants to *show* the claim label so
//     a third-party reader (university admissions, employer) doesn't
//     have to look up "AQA-GCSE-9-1-Maths code A18" themselves.
//   • The teacher attestation UI wants typeahead, not free-text, so
//     teachers stop inventing slightly-different framework names.
//
// This module is the single source of truth those three call sites
// share. It is deliberately TINY in v1 — frameworks + spec-points
// authored by hand, no remote registry, no LLM. Adding a framework
// is a code edit. That's correct for pilot scale.
//
// CONTRACT WITH THE VOCABULARY MODULE
// ───────────────────────────────────
//   • Registry is OPTIONAL. A claim with a (framework, code) NOT in
//     the registry MUST still verify if its signature is valid. The
//     registry never causes a signature-verified claim to be rejected
//     outright — it can mark it "unknown" but not "invalid".
//   • Registry is FORWARD-COMPATIBLE. A claim referencing a code
//     added to the registry AFTER the credential was issued must
//     still validate. We never break old credentials by tightening
//     the registry.
//   • `skillUri` derived here is `urn:evenkeel:skill:<framework>:<code>`.
//     This URN form lets a registry-aware resolver look up the canonical
//     entry without parsing the credential, while a registry-blind
//     verifier can ignore it.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Curriculum framework metadata. Stable identifiers — a `framework.id`
 * MUST NOT be renamed once published; new ids are forward-compatible
 * additions only.
 */
export interface CurriculumFramework {
  /** Stable, machine-readable identifier (e.g. `AQA-GCSE-9-1-Maths`). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** ISO 3166-1 alpha-2 jurisdiction (e.g. `GB`, `IE`, `US`). */
  jurisdiction: string;
  /** Subject area (e.g. `maths`, `english`). */
  subject: string;
  /** Level / age band (e.g. `GCSE`, `Junior Cycle`, `Common Core K-12`). */
  level: string;
  /** Awarding body / publisher (e.g. `AQA`, `DES`). */
  awardingBody: string;
  /** Optional URL to the official specification document. */
  sourceUrl?: string;
  /** Optional version / year of the specification. */
  specVersion?: string;
}

/**
 * A single spec-point in a framework. The (framework, code) pair is
 * the canonical identifier; label and aliases are conveniences.
 */
export interface CurriculumSpecPoint {
  /** Framework id this spec-point belongs to. */
  framework: string;
  /** Framework-local code (e.g. `A18`, `8.EE.C.7`). */
  code: string;
  /** Canonical human-readable label. */
  label: string;
  /**
   * Optional descriptive scope (e.g. broad topic family). Used by the
   * teacher UI to group spec-points. Not part of canonical identity.
   */
  topic?: string;
  /**
   * Optional alternative codes seen in the wild (e.g. older revisions
   * of the same spec). The verifier may use these for fuzzy matching
   * when surfacing a "did you mean…?" hint. NOT used for equality.
   */
  aliases?: ReadonlyArray<string>;
}

// ─── Framework definitions ────────────────────────────────────────────────

/**
 * Frameworks supported by the v1 registry. These are the bodies
 * referenced in shipped content packs (`content/packs-raw/*.mjs`)
 * plus a small number of likely-asked additions (e.g. Common Core).
 *
 * Adding a framework: append a new entry. DO NOT renumber, rename, or
 * delete an existing `id` — that breaks issued credentials.
 */
export const CURRICULUM_FRAMEWORKS: ReadonlyArray<CurriculumFramework> = [
  {
    id: "AQA-GCSE-9-1-Maths",
    name: "AQA GCSE 9-1 Mathematics",
    jurisdiction: "GB",
    subject: "maths",
    level: "GCSE",
    awardingBody: "AQA",
    sourceUrl: "https://www.aqa.org.uk/subjects/mathematics/gcse/mathematics-8300",
    specVersion: "8300",
  },
  {
    id: "Edexcel-GCSE-9-1-Maths",
    name: "Edexcel GCSE 9-1 Mathematics",
    jurisdiction: "GB",
    subject: "maths",
    level: "GCSE",
    awardingBody: "Pearson Edexcel",
    sourceUrl: "https://qualifications.pearson.com/en/qualifications/edexcel-gcses/mathematics-2015.html",
    specVersion: "1MA1",
  },
  {
    id: "OCR-GCSE-9-1-Maths",
    name: "OCR GCSE 9-1 Mathematics",
    jurisdiction: "GB",
    subject: "maths",
    level: "GCSE",
    awardingBody: "OCR",
    sourceUrl: "https://www.ocr.org.uk/qualifications/gcse/mathematics-j560-from-2015/",
    specVersion: "J560",
  },
  {
    id: "DES-JC-Maths-2024",
    name: "DES Junior Cycle Mathematics 2024",
    jurisdiction: "IE",
    subject: "maths",
    level: "Junior Cycle",
    awardingBody: "Department of Education (Ireland)",
    sourceUrl: "https://curriculumonline.ie/Junior-cycle/Junior-Cycle-Subjects/Mathematics/",
    specVersion: "2024",
  },
  {
    id: "CCSS-Math",
    name: "Common Core State Standards — Mathematics",
    jurisdiction: "US",
    subject: "maths",
    level: "K-12",
    awardingBody: "CCSSO / NGA",
    sourceUrl: "https://www.thecorestandards.org/Math/",
    specVersion: "2010",
  },
  {
    id: "AQA-GCSE-9-1-English-Language",
    name: "AQA GCSE 9-1 English Language",
    jurisdiction: "GB",
    subject: "english",
    level: "GCSE",
    awardingBody: "AQA",
    sourceUrl: "https://www.aqa.org.uk/subjects/english/gcse/english-language-8700",
    specVersion: "8700",
  },
];

// Build framework lookup once at module load.
const FRAMEWORK_INDEX: ReadonlyMap<string, CurriculumFramework> = (() => {
  const m = new Map<string, CurriculumFramework>();
  for (const fw of CURRICULUM_FRAMEWORKS) m.set(fw.id, fw);
  return m;
})();

// ─── Spec-point definitions ───────────────────────────────────────────────

/**
 * Spec-points actually referenced by shipped content packs, plus a
 * starter set of related codes likely to be claimed by teachers.
 *
 * KEEP THIS HAND-AUTHORED. The honest answer to "where do these
 * labels come from" is: the published specification of each
 * awarding body. They are not LLM-generated.
 *
 * Adding entries is safe. Editing a label is safe (label is not part
 * of canonical identity). Renaming a `code` is NOT safe — it breaks
 * previously-issued credentials that reference the old code.
 */
export const CURRICULUM_SPEC_POINTS: ReadonlyArray<CurriculumSpecPoint> = [
  // ─── AQA GCSE 9-1 Maths ──────────────────────────────────────────────
  {
    framework: "AQA-GCSE-9-1-Maths",
    code: "N12",
    label: "Interpret fractions and percentages as operators",
    topic: "Number — fractions, decimals, percentages",
  },
  {
    framework: "AQA-GCSE-9-1-Maths",
    code: "N13",
    label:
      "Use standard units of mass, length, time, money and other measures, " +
      "including with decimal quantities",
    topic: "Number — measures and accuracy",
  },
  {
    framework: "AQA-GCSE-9-1-Maths",
    code: "A18",
    label:
      "Solve quadratic equations (including those that require rearrangement) " +
      "algebraically by factorising",
    topic: "Algebra — solving equations",
  },
  {
    framework: "AQA-GCSE-9-1-Maths",
    code: "A19",
    label:
      "Solve two simultaneous equations in two variables (linear/linear or " +
      "linear/quadratic) algebraically; find approximate solutions using a graph",
    topic: "Algebra — solving equations",
  },
  {
    framework: "AQA-GCSE-9-1-Maths",
    code: "A21",
    label:
      "Translate simple situations or procedures into algebraic expressions or " +
      "formulae; derive an equation, solve the equation and interpret the solution",
    topic: "Algebra — forming and solving equations",
  },
  {
    framework: "AQA-GCSE-9-1-Maths",
    code: "R9",
    label:
      "Define percentage as 'number of parts per hundred'; interpret percentages " +
      "and percentage changes as a fraction or a decimal; interpret these multiplicatively",
    topic: "Ratio and proportion",
  },
  {
    framework: "AQA-GCSE-9-1-Maths",
    code: "R16",
    label:
      "Set up, solve and interpret the answers in growth and decay problems, " +
      "including compound interest, and work with general iterative processes",
    topic: "Ratio and proportion — growth and decay",
  },

  // ─── Edexcel GCSE 9-1 Maths ──────────────────────────────────────────
  {
    framework: "Edexcel-GCSE-9-1-Maths",
    code: "1.12",
    label: "Interpret fractions and percentages as operators",
    topic: "Number",
  },
  {
    framework: "Edexcel-GCSE-9-1-Maths",
    code: "1.13",
    label:
      "Use standard units of mass, length, time, money and compound measures, " +
      "including percentage increase and decrease",
    topic: "Number",
  },
  {
    framework: "Edexcel-GCSE-9-1-Maths",
    code: "2.4",
    label: "Solve quadratic equations algebraically by factorising",
    topic: "Algebra",
  },
  {
    framework: "Edexcel-GCSE-9-1-Maths",
    code: "2.5",
    label:
      "Translate situations or procedures into algebraic expressions, " +
      "formulae or equations",
    topic: "Algebra",
  },
  {
    framework: "Edexcel-GCSE-9-1-Maths",
    code: "2.7",
    label:
      "Solve linear equations in one unknown algebraically (including those " +
      "with the unknown on both sides of the equation)",
    topic: "Algebra",
  },

  // ─── OCR GCSE 9-1 Maths ──────────────────────────────────────────────
  {
    framework: "OCR-GCSE-9-1-Maths",
    code: "3.06a",
    label: "Apply ratio to real contexts and problems",
    topic: "Ratio, proportion and rates of change",
  },
  {
    framework: "OCR-GCSE-9-1-Maths",
    code: "3.06b",
    label: "Solve problems involving percentage change, including percentage increase / decrease and original-value problems",
    topic: "Ratio, proportion and rates of change",
  },
  {
    framework: "OCR-GCSE-9-1-Maths",
    code: "6.02a",
    label: "Solve quadratic equations by factorising",
    topic: "Algebra — solving equations and inequalities",
  },
  {
    framework: "OCR-GCSE-9-1-Maths",
    code: "6.02b",
    label:
      "Solve quadratic equations using the quadratic formula or by completing the square",
    topic: "Algebra — solving equations and inequalities",
  },
  {
    framework: "OCR-GCSE-9-1-Maths",
    code: "6.05",
    label: "Solve linear equations in one unknown",
    topic: "Algebra — solving equations",
  },

  // ─── DES Junior Cycle Maths 2024 ─────────────────────────────────────
  {
    framework: "DES-JC-Maths-2024",
    code: "N.2",
    label:
      "Investigate equivalence in the form of fractions, decimals and percentages",
    topic: "Number",
  },
  {
    framework: "DES-JC-Maths-2024",
    code: "AF.1",
    label:
      "Investigate patterns and relationships, observe and describe these in " +
      "words and symbols, and use them to make predictions",
    topic: "Algebra and Functions",
  },
  {
    framework: "DES-JC-Maths-2024",
    code: "AF.2",
    label:
      "Represent situations with tables, diagrams and graphs; develop and use " +
      "their own mathematical strategies and ideas",
    topic: "Algebra and Functions",
  },
  {
    framework: "DES-JC-Maths-2024",
    code: "AF.4",
    label:
      "Solve quadratic equations of the form ax² + bx + c = 0 where a, b, c " +
      "are integers and the roots are rational",
    topic: "Algebra and Functions",
  },

  // ─── Common Core Math ────────────────────────────────────────────────
  {
    framework: "CCSS-Math",
    code: "6.RP.A.3.c",
    label:
      "Find a percent of a quantity as a rate per 100; solve problems involving " +
      "finding the whole, given a part and the percent",
    topic: "Ratios and Proportional Relationships",
  },
  {
    framework: "CCSS-Math",
    code: "7.RP.A.3",
    label:
      "Use proportional relationships to solve multistep ratio and percent problems",
    topic: "Ratios and Proportional Relationships",
  },
  {
    framework: "CCSS-Math",
    code: "HSA-CED.A.1",
    label:
      "Create equations and inequalities in one variable and use them to solve problems",
    topic: "High School — Algebra — Creating Equations",
  },
  {
    framework: "CCSS-Math",
    code: "HSA-CED.A.2",
    label:
      "Create equations in two or more variables to represent relationships between quantities",
    topic: "High School — Algebra — Creating Equations",
  },
  {
    framework: "CCSS-Math",
    code: "HSA-REI.B.4.b",
    label:
      "Solve quadratic equations by inspection, taking square roots, completing the " +
      "square, the quadratic formula and factoring, as appropriate",
    topic: "High School — Algebra — Reasoning with Equations and Inequalities",
  },
  {
    framework: "CCSS-Math",
    code: "HSF-LE.A.2",
    label:
      "Construct linear and exponential functions, including arithmetic and " +
      "geometric sequences, given a graph, a description of a relationship, or " +
      "two input-output pairs",
    topic: "High School — Functions — Linear, Quadratic, and Exponential Models",
  },
];

// Build spec-point lookup indexed by (framework, code).
const SPEC_POINT_INDEX: ReadonlyMap<string, CurriculumSpecPoint> = (() => {
  const m = new Map<string, CurriculumSpecPoint>();
  for (const sp of CURRICULUM_SPEC_POINTS) {
    m.set(specPointKey(sp.framework, sp.code), sp);
  }
  return m;
})();

// Build spec-point lookup indexed by framework.
const SPEC_POINTS_BY_FRAMEWORK: ReadonlyMap<
  string,
  ReadonlyArray<CurriculumSpecPoint>
> = (() => {
  const m = new Map<string, CurriculumSpecPoint[]>();
  for (const sp of CURRICULUM_SPEC_POINTS) {
    const existing = m.get(sp.framework);
    if (existing) existing.push(sp);
    else m.set(sp.framework, [sp]);
  }
  return m;
})();

function specPointKey(framework: string, code: string): string {
  return `${framework}::${code}`;
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Return the framework definition for an id, or `null` if unknown.
 */
export function findFramework(frameworkId: string): CurriculumFramework | null {
  return FRAMEWORK_INDEX.get(frameworkId) ?? null;
}

/**
 * Return the spec-point definition for a (framework, code) pair, or
 * `null` if unknown.
 */
export function findSpecPoint(
  framework: string,
  code: string,
): CurriculumSpecPoint | null {
  return SPEC_POINT_INDEX.get(specPointKey(framework, code)) ?? null;
}

/**
 * Return all spec-points for a framework, in registry order. Empty
 * array if the framework is unknown or has no entries.
 */
export function listSpecPointsForFramework(
  framework: string,
): ReadonlyArray<CurriculumSpecPoint> {
  return SPEC_POINTS_BY_FRAMEWORK.get(framework) ?? [];
}

/**
 * Build the canonical Even Keel skill URN for a (framework, code)
 * pair. NEVER fetches a network resource — the URN is a deterministic
 * function of (framework, code). Callers that want HTTP resolution
 * should layer it on top.
 */
export function buildSkillUri(framework: string, code: string): string {
  // We URI-encode the components defensively — frameworks and codes
  // currently use safe ASCII but the registry could grow to include
  // codes with periods or slashes.
  return `urn:evenkeel:skill:${encodeURIComponent(framework)}:${encodeURIComponent(code)}`;
}

/** Stable result codes for `validateAgainstRegistry`. */
export type RegistryValidationStatus =
  | "ok" // framework + code both known
  | "unknown_framework" // framework not in registry
  | "unknown_code"; // framework known, code not

export interface RegistryValidationResult {
  status: RegistryValidationStatus;
  /** Resolved spec-point if status === "ok". */
  specPoint?: CurriculumSpecPoint;
  /** Resolved framework if framework is known. */
  framework?: CurriculumFramework;
  /** Canonical skill URI if status === "ok". */
  skillUri?: string;
}

/**
 * Cross-check a (framework, code) pair against the registry. This
 * NEVER throws and NEVER rejects a valid claim — it only enriches.
 *
 * Callers (e.g. the verifier UI) can use the status code to decide
 * whether to render a green tick, a yellow "unknown code" warning,
 * or simply pass through the embedded label.
 */
export function validateAgainstRegistry(
  framework: string,
  code: string,
): RegistryValidationResult {
  const fw = findFramework(framework);
  if (!fw) return { status: "unknown_framework" };
  const sp = findSpecPoint(framework, code);
  if (!sp) return { status: "unknown_code", framework: fw };
  return {
    status: "ok",
    framework: fw,
    specPoint: sp,
    skillUri: buildSkillUri(framework, code),
  };
}

/** Return all frameworks, in registry order. */
export function listFrameworks(): ReadonlyArray<CurriculumFramework> {
  return CURRICULUM_FRAMEWORKS;
}

/**
 * Counts for diagnostic / admin surfaces. Cheap — both `.size` reads
 * are O(1) on the underlying Maps.
 */
export function registryStats(): {
  frameworkCount: number;
  specPointCount: number;
} {
  return {
    frameworkCount: FRAMEWORK_INDEX.size,
    specPointCount: SPEC_POINT_INDEX.size,
  };
}
