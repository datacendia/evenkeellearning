// ─────────────────────────────────────────────────────────────────────────────
// lib/regulatory-absorb/types.ts
//
// Integration contract for Regulatory Absorb V2. Even Keel Learning consumes the
// RegulatoryAbsorbV2 schema from a Datacendia-shaped adapter (currently
// `adapter-mock.ts`; in production a Datacendia HTTP client). See
// EVENKEEL_BIBLE.md §13 for the source-of-truth specification.
//
// The shapes here are the single contract between the frontend and the
// adapter. Any change here is API-breaking and must be reflected in the
// audit manifest under control CC8.1 (Change Management).
// ─────────────────────────────────────────────────────────────────────────────

export type RegulatorySeverity = "critical" | "high" | "medium" | "low";

export type TriggerType =
  | "data_collection"
  | "age_gate"
  | "consent"
  | "retention"
  | "biometric"
  | "ai_disclosure"
  | "advertising"
  | "crisis_response";

export interface RequirementV2 {
  id: string;
  jurisdiction: string;
  documentRef: string;
  severity: RegulatorySeverity;
  triggerType: TriggerType;
  constraint: string;
  penalty?: string;
  status?: "active" | "suppressed" | "archived";
}

export type ConflictType = "DIRECT" | "POTENTIAL" | "SUPERSEDED";

export type ConflictResolution =
  | "UNRESOLVED"
  | "RESOLVED_PRIORITY"
  | "RESOLVED_MERGED"
  | "RESOLVED_EXCEPTION"
  | "FALSE_POSITIVE";

export interface RegulatoryConflict {
  id: string;
  requirementA: RequirementV2;
  requirementB: RequirementV2;
  conflictType: ConflictType;
  resolutionStatus: ConflictResolution;
  recommendedResolution?: string;
  resolvedBy?: string;
  resolvedAt?: number;
  /** Display-friendly short form of the ECDSA signature (first 12 chars). */
  signature?: string;
  /** Full ECDSA signature, base64url, IEEE-P1363 (r||s) over the digest. */
  signatureFull?: string;
  /** SubjectPublicKeyInfo of the signer, base64url. Verifier needs this. */
  signaturePublicKey?: string;
  /** SHA-256 base64url digest of the canonical resolution payload. */
  signatureDigest?: string;
  /** ISO-8601 timestamp at signing. */
  signedAtIso?: string;
  /** Algorithm label for forward compatibility. */
  signatureAlgorithm?: "ECDSA-P256-SHA256";
  generatedJustification?: string;
  detectedAt: number;
}

export interface AbsorptionResultV2 {
  sourceDocument: string;
  jurisdiction: string;
  requirements: RequirementV2[];
  conflicts: RegulatoryConflict[];
  confidenceScore: number;
  verificationRecommendations: string[];
  absorbedAt: number;
}

/**
 * Sub-categorisation of a crisis-pattern match. When `triggerType` on a
 * `SafetyResponse` is `"crisis_response"`, this field carries the *family*
 * of pattern that matched, never the matched text. Used by the v1.4.8 DSL
 * escalation pipeline to route signed payloads without leaking the
 * learner's free-form input.
 *
 * The categories are stable and pin into KCSIE 2025 / Prevent-duty mappings
 * (see `compliance/kcsie-2025-prevent-duty-map.json`).
 */
export type CrisisPatternCategory =
  | "direct_self_harm"        // explicit self-harm verbs ("kill myself", obfuscations, "self-harm", "commit suicide")
  | "temporal_escalation"     // imminent-frame distress ("end it all", "want to die", "going to die tonight")
  | "indirect_distress"       // idiomatic distress without explicit verb ("better off without me", "no point in...")
  | "cyberbullying_acronym"   // reflexive use of acronyms like "kys"
  | "emoji_affect";           // distress emoji + negative-affect language

export interface SafetyResponse {
  allow: boolean;
  blockedBy?: RequirementV2;
  triggerType?: TriggerType;
  userMessage?: string;
  /**
   * Set only when `triggerType === "crisis_response"`. The matched
   * category never carries the learner's text — see CrisisPatternCategory.
   */
  crisisPatternCategory?: CrisisPatternCategory;
}

export interface DecisionGateInput {
  text: string;
  jurisdiction: string;
  studentAgeBand?: string;
}
