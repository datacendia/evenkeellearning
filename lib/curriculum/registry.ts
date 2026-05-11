// ─────────────────────────────────────────────────────────────────────────────
// lib/curriculum/registry.ts
//
// v1.8.0 — Curriculum registry (Phase A, p15-curriculum).
//
// What this module does
// ─────────────────────
// Defines the typed schema and lookup surface for curriculum spec-points.
// A spec-point lives at the intersection of:
//
//   • framework      e.g. "AQA-GCSE-9-1-Maths"
//   • code           framework-local identifier, e.g. "A18"
//   • skillUri       stable URI the platform mints, e.g.
//                    "https://evenkeel.org/curricula/aqa-gcse-9-1-maths/A18"
//
// The registry is the SINGLE SOURCE OF TRUTH that the VC issuer/verifier,
// content authoring tools, the teacher coverage dashboard, and (eventually)
// cross-walks between frameworks all consult.
//
// Honoured contracts
// ──────────────────
//   • lib/vc/claim-vocabulary.ts: every Even Keel VC carries
//     `(framework, code, claimVocabularyVersion, skillUri?)`. The registry
//     is what populates `skillUri` lazily — newly issued VCs get the URI
//     baked in; older VCs are upgraded by a verifier passing the registry
//     to `resolveSpecPointSkillUri()`.
//
//   • content/packs-raw/*.mjs: every authored item references a spec-point
//     by `(framework, code)`. The build-time validator (wired into
//     scripts/build-content-manifest.mjs) reports any pack item whose
//     spec-point is unknown to the registry. Strict mode treats unknown
//     refs as a build failure; default mode warns.
//
// What this is NOT
// ────────────────
//   • A cross-walk graph. Mapping AQA-A18 ↔ Edexcel-2.4 ↔ CCSS-HSA-REI.B.4.b
//     is a separate concern (a separate cross-walk module can sit on top
//     of this registry). Phase A only cares about the per-framework graph.
//   • A live document fetcher. The registry is statically compiled from
//     content/curriculum/*.mjs into public/curriculum/registry.json by
//     scripts/build-curriculum-registry.mjs and shipped as a static asset.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Schema ────────────────────────────────────────────────────────────────

/**
 * The base URI under which every framework's spec-points live. Bumped only
 * if the URI scheme itself changes (which would be a breaking change for
 * every previously-issued credential's verifier).
 */
export const SKILL_URI_BASE = "https://evenkeel.org/curricula" as const;

/** Schema version of the registry payload (NOT the claim-vocabulary version). */
export const REGISTRY_SCHEMA_VERSION = 1 as const;

/** A single spec-point row. */
export interface CurriculumSpecPoint {
  /** Stable framework identifier (e.g. "AQA-GCSE-9-1-Maths"). */
  framework: string;
  /** Framework-local code (e.g. "A18"). Case-sensitive. */
  code: string;
  /** Human-readable label. May change without bumping any version. */
  label: string;
  /** Optional grouping (e.g. "Algebra", "Number"). Free-form per framework. */
  topic?: string;
  /** Stable absolute URI. Computed from (framework, code) — see uriFor(). */
  skillUri: string;
  /**
   * Optional list of citation URLs (the official spec PDF, the awarding
   * body's content page) so a verifier can audit a claim. Free-form;
   * verifiers may dereference for human display, MUST NOT use as identity.
   */
  references?: string[];
}

/** A whole framework's data, as authored. */
export interface CurriculumFramework {
  /** Stable framework identifier. */
  id: string;
  /** Display name (UK English, awarding-body wording). */
  name: string;
  /** Awarding body or governing org (e.g. "AQA", "DfE", "DES"). */
  awardingBody: string;
  /** Jurisdiction code matching lib/roster/schema.ts (UK-EN, IE, US, …). */
  jurisdiction: string;
  /** Earliest school year this framework typically applies to. */
  yearStart: number;
  /** Latest school year this framework typically applies to. */
  yearEnd: number;
  /** Spec-points keyed by code (case-sensitive). */
  specPoints: CurriculumSpecPoint[];
  /** Optional URLs to the framework's authoritative spec documents. */
  references?: string[];
}

/** The compiled registry (what scripts/build-curriculum-registry.mjs emits). */
export interface CurriculumRegistry {
  schemaVersion: typeof REGISTRY_SCHEMA_VERSION;
  generatedAtIso: string;
  /** Frameworks keyed by id. */
  frameworks: Record<string, CurriculumFramework>;
}

// ─── URI minting ───────────────────────────────────────────────────────────

/**
 * Mint the canonical skillUri for a `(framework, code)` pair. Pure.
 *
 * Slugging rules:
 *   • framework: lowercase, replace any run of non-alphanumeric chars with `-`,
 *                trim leading/trailing `-`. Stable across the lifetime of a
 *                framework name; renaming a framework is a BREAKING change.
 *   • code:      preserved verbatim (case-sensitive). Codes already use
 *                framework-author-controlled casing (e.g. "A18", "HSA-REI.B.4.b")
 *                and we don't want to collapse semantic distinctions.
 */
export function uriFor(framework: string, code: string): string {
  const slug = framework
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${SKILL_URI_BASE}/${slug}/${encodeURIComponent(code)}`;
}

// ─── Build (used at compile time) ──────────────────────────────────────────

export interface FrameworkInput {
  id: string;
  name: string;
  awardingBody: string;
  jurisdiction: string;
  yearStart: number;
  yearEnd: number;
  references?: string[];
  specPoints: Array<{
    code: string;
    label: string;
    topic?: string;
    references?: string[];
  }>;
}

/**
 * Build a single framework, populating skillUri for every spec-point.
 * Throws on duplicate codes within the framework — the registry's whole
 * value depends on each (framework, code) being unambiguous.
 */
export function buildFramework(input: FrameworkInput): CurriculumFramework {
  const seen = new Set<string>();
  const specPoints: CurriculumSpecPoint[] = [];
  for (const sp of input.specPoints) {
    if (seen.has(sp.code)) {
      throw new Error(
        `duplicate_code: framework=${input.id} code=${sp.code}`,
      );
    }
    seen.add(sp.code);
    specPoints.push({
      framework: input.id,
      code: sp.code,
      label: sp.label,
      ...(sp.topic ? { topic: sp.topic } : {}),
      skillUri: uriFor(input.id, sp.code),
      ...(sp.references ? { references: sp.references } : {}),
    });
  }
  return {
    id: input.id,
    name: input.name,
    awardingBody: input.awardingBody,
    jurisdiction: input.jurisdiction,
    yearStart: input.yearStart,
    yearEnd: input.yearEnd,
    specPoints,
    ...(input.references ? { references: input.references } : {}),
  };
}

/**
 * Compose multiple framework inputs into a registry. Throws if two
 * frameworks share an id (the SST invariant).
 */
export function buildRegistry(
  inputs: FrameworkInput[],
  generatedAtIso: string = new Date().toISOString(),
): CurriculumRegistry {
  const frameworks: Record<string, CurriculumFramework> = {};
  for (const f of inputs) {
    if (frameworks[f.id]) {
      throw new Error(`duplicate_framework_id: ${f.id}`);
    }
    frameworks[f.id] = buildFramework(f);
  }
  return {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    generatedAtIso,
    frameworks,
  };
}

// ─── Lookup (used at runtime by VC verifier + dashboard) ───────────────────

/**
 * Look up a spec-point by (framework, code). Returns null if either the
 * framework or the code is unknown. Pure.
 */
export function lookupSpecPoint(
  registry: CurriculumRegistry,
  framework: string,
  code: string,
): CurriculumSpecPoint | null {
  const f = registry.frameworks[framework];
  if (!f) return null;
  for (const sp of f.specPoints) {
    if (sp.code === code) return sp;
  }
  return null;
}

/**
 * Resolve the stable skillUri for a claim's (framework, code). Returns
 * null if the registry doesn't know the pair — verifiers should accept
 * a null in v1 (skillUri is optional in the claim vocabulary) but flag
 * it as "registry-unrecognised" for human review.
 */
export function resolveSkillUri(
  registry: CurriculumRegistry,
  framework: string,
  code: string,
): string | null {
  const sp = lookupSpecPoint(registry, framework, code);
  return sp ? sp.skillUri : null;
}

// ─── Cross-validation (used at content-build time) ─────────────────────────

export interface AuthoredSpecPointRef {
  framework: string;
  code: string;
}

export interface CrossValidationFinding {
  framework: string;
  code: string;
  /** Where the unknown ref was authored (free-form, e.g. pack id + item id). */
  source: string;
}

export interface CrossValidationResult {
  unknown: CrossValidationFinding[];
  knownCount: number;
}

/**
 * Verify that every authored spec-point reference appears in the registry.
 * Returns the unknowns; the caller decides whether to warn or fail.
 *
 * Pure. Order-stable: unknowns appear in input order so output is
 * reproducible across builds.
 */
export function crossValidateAgainstRegistry(
  registry: CurriculumRegistry,
  refs: Array<AuthoredSpecPointRef & { source: string }>,
): CrossValidationResult {
  const unknown: CrossValidationFinding[] = [];
  let knownCount = 0;
  for (const r of refs) {
    if (lookupSpecPoint(registry, r.framework, r.code)) {
      knownCount++;
    } else {
      unknown.push({ framework: r.framework, code: r.code, source: r.source });
    }
  }
  return { unknown, knownCount };
}
