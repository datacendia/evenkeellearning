// ─────────────────────────────────────────────────────────────────────────────
// lib/vc/claim-vocabulary.ts
//
// v1.7.0 — Canonical claim vocabulary for Even Keel attestations and the
// Verifiable Credentials issued from them.
//
// THE DESIGN CAVEAT
// ─────────────────
// A skill / spec-point claim MUST carry four pieces of identity:
//
//   1. framework               REQUIRED. Stable identifier of the
//                              curriculum framework (e.g. "AQA-GCSE-9-1-Maths",
//                              "CCSS-Math", "IE-Junior-Cycle-Maths").
//   2. code                    REQUIRED. The framework-local code for the
//                              spec-point (e.g. "A18", "8.EE.7").
//   3. claimVocabularyVersion  REQUIRED. Integer starting at 1. Bumped only
//                              on BREAKING changes to the vocabulary
//                              (e.g. semantic redefinition of a code).
//                              Forward-compatible additions (new frameworks,
//                              new codes) do NOT bump this.
//   4. skillUri                OPTIONAL in v1. Populated once a curriculum
//                              registry is wired in. The (framework, code)
//                              tuple is the canonical identifier; the URI
//                              is a CONVENIENCE for resolvers, NOT the
//                              source of truth. This means a registry can
//                              back-fill `skillUri` on a previously-signed
//                              attestation without invalidating the
//                              signature, because verifiers compare on
//                              (framework, code).
//
// WHY THIS LIVES IN ITS OWN MODULE
// ────────────────────────────────
// The teacher attestation primitive (`lib/teacher/attestation.ts`) and the
// downstream W3C VC issuer (`lib/vc/issuer.ts`, coming next) both need to
// validate and emit claims with EXACTLY the same shape and version. Having
// a single source of truth here means a version bump touches one constant
// and the type system surfaces every site that needs to be re-audited.
//
// VERIFIER CONTRACT (what a third-party verifier MUST do)
// ───────────────────────────────────────────────────────
//   • Treat (framework, code) as the canonical identifier.
//   • Reject a claim whose claimVocabularyVersion is greater than the
//     verifier's supported version (forward-incompatible bump).
//   • Accept a claim with a missing skillUri.
//   • If skillUri is present AND the verifier has registry access, treat
//     a mismatch between the resolved (framework, code) at that URI and
//     the embedded (framework, code) as an INVALID claim.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Current vocabulary version. Bump ONLY on breaking semantic changes.
 *
 * v1 (initial):
 *   • framework: free-form string, treated case-sensitively
 *   • code: free-form string, treated case-sensitively
 *   • label: optional, NOT part of canonical identity
 *   • skillUri: optional
 */
export const CLAIM_VOCABULARY_VERSION = 1 as const;
export type ClaimVocabularyVersion = typeof CLAIM_VOCABULARY_VERSION;

/**
 * The canonical claim shape. Every spec-point claim flowing through the
 * platform — attestation payloads, VC `credentialSubject` arrays,
 * verifier inputs — uses this exact shape.
 *
 * NOTE: keep this in sync with `TeacherAttestationSpecPoint` in
 * `lib/teacher/attestation.ts`. The teacher type narrows
 * `claimVocabularyVersion` to the literal `1`; this module exposes both
 * the literal type and the runtime constant so both spellings stay
 * mutually compatible.
 */
export interface SpecPointClaim {
  /** Stable identifier of the curriculum framework. */
  framework: string;
  /** Framework-local code for the spec-point. */
  code: string;
  /** Vocabulary version this claim was issued under. */
  claimVocabularyVersion: ClaimVocabularyVersion;
  /** Optional human-readable label; NOT part of canonical identity. */
  label?: string;
  /** Optional resolvable URI; back-fillable by the curriculum registry. */
  skillUri?: string;
}

// ─── Validation ────────────────────────────────────────────────────────────

/** Stable machine codes for claim validation rejection reasons. */
export type ClaimValidationReason =
  | "missing_framework"
  | "missing_code"
  | "framework_too_long"
  | "code_too_long"
  | "label_too_long"
  | "invalid_skill_uri"
  | "unsupported_vocabulary_version"
  | "missing_vocabulary_version";

export type ClaimValidationResult =
  | { ok: true; claim: SpecPointClaim }
  | { ok: false; reason: ClaimValidationReason; detail?: string };

/** Bounds — tightened on PURE auditability grounds, not on schema. */
const MAX_FRAMEWORK_LENGTH = 64;
const MAX_CODE_LENGTH = 32;
const MAX_LABEL_LENGTH = 120;

/**
 * Validate an untrusted claim object. Returns a discriminated result so
 * callers can branch on `ok` cleanly. The `claim` returned on success is
 * a NEW object — caller can store it without aliasing the input.
 *
 * `supportedVersion` defaults to `CLAIM_VOCABULARY_VERSION` but verifiers
 * MAY supply a lower number if they have not yet been upgraded.
 */
export function validateSpecPointClaim(
  raw: unknown,
  supportedVersion: number = CLAIM_VOCABULARY_VERSION,
): ClaimValidationResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "missing_framework" };
  }
  const o = raw as Record<string, unknown>;

  // Vocabulary version — checked FIRST so a future-version claim is
  // rejected cleanly without bothering to validate other fields.
  if (
    o.claimVocabularyVersion === undefined ||
    o.claimVocabularyVersion === null
  ) {
    return { ok: false, reason: "missing_vocabulary_version" };
  }
  if (typeof o.claimVocabularyVersion !== "number") {
    return { ok: false, reason: "missing_vocabulary_version" };
  }
  if (o.claimVocabularyVersion > supportedVersion) {
    return {
      ok: false,
      reason: "unsupported_vocabulary_version",
      detail: `claim version ${o.claimVocabularyVersion} exceeds supported ${supportedVersion}`,
    };
  }

  // framework
  if (typeof o.framework !== "string" || o.framework.trim().length === 0) {
    return { ok: false, reason: "missing_framework" };
  }
  if (o.framework.length > MAX_FRAMEWORK_LENGTH) {
    return { ok: false, reason: "framework_too_long" };
  }

  // code
  if (typeof o.code !== "string" || o.code.trim().length === 0) {
    return { ok: false, reason: "missing_code" };
  }
  if (o.code.length > MAX_CODE_LENGTH) {
    return { ok: false, reason: "code_too_long" };
  }

  // optional label
  if (o.label !== undefined) {
    if (typeof o.label !== "string") {
      return { ok: false, reason: "label_too_long" };
    }
    if (o.label.length > MAX_LABEL_LENGTH) {
      return { ok: false, reason: "label_too_long" };
    }
  }

  // optional skillUri — must parse as URL if present
  if (o.skillUri !== undefined) {
    if (typeof o.skillUri !== "string") {
      return { ok: false, reason: "invalid_skill_uri" };
    }
    try {
      // We do NOT require https here — a did: or urn: scheme is legal.
      // We DO require something URL-parseable.
      new URL(o.skillUri);
    } catch {
      return { ok: false, reason: "invalid_skill_uri" };
    }
  }

  // Build a fresh object so callers don't accidentally retain references
  // to attacker-controlled prototypes.
  const claim: SpecPointClaim = {
    framework: o.framework,
    code: o.code,
    claimVocabularyVersion: o.claimVocabularyVersion as ClaimVocabularyVersion,
  };
  if (typeof o.label === "string") claim.label = o.label;
  if (typeof o.skillUri === "string") claim.skillUri = o.skillUri;
  return { ok: true, claim };
}

// ─── Canonical identity ────────────────────────────────────────────────────

/**
 * Canonical identifier for a claim. Stable across `label` changes and
 * across `skillUri` back-fill. Used by verifiers for equality checks and
 * by aggregators for deduplication.
 *
 * Format: `<framework>::<code>` — `::` is not legal in framework or code
 * strings (we don't enforce that at the schema level, but the bounds
 * keep this practical).
 */
export function canonicalClaimId(claim: SpecPointClaim): string {
  return `${claim.framework}::${claim.code}`;
}

/** Equality on canonical identity (ignores label and skillUri). */
export function claimsEqual(a: SpecPointClaim, b: SpecPointClaim): boolean {
  return a.framework === b.framework && a.code === b.code;
}

/**
 * Back-fill `skillUri` on an existing claim. Returns a NEW claim
 * (immutable update) so caller cannot accidentally mutate a signed
 * payload. Does NOT validate the URI — caller is expected to have
 * resolved it through the registry first.
 */
export function withSkillUri(
  claim: SpecPointClaim,
  skillUri: string,
): SpecPointClaim {
  const out: SpecPointClaim = {
    framework: claim.framework,
    code: claim.code,
    claimVocabularyVersion: claim.claimVocabularyVersion,
    skillUri,
  };
  if (claim.label) out.label = claim.label;
  return out;
}
