// ─────────────────────────────────────────────────────────────────────────────
// lib/regulatory-absorb/adapter-mock.ts
//
// In-memory adapter for Regulatory Absorb V2. The exported functions
// (`listActiveRequirements`, `listConflicts`, `resolveConflict`, …) match
// the shape that a production Datacendia HTTP client would expose, so a
// drop-in replacement is a one-import change for callers.
//
// HONESTY
// ───────
// • Seed data: 8 hand-written requirements, 2 hand-written conflicts.
// • `resolveConflict` produces a **real ECDSA P-256 signature** via
//   `lib/crypto/signing.ts` (WebCrypto). The signature, public key, content
//   digest, ISO timestamp and algorithm label are all written onto the
//   conflict and the Compliance Audit Vault verifies them in-page. The only
//   exception: when SubtleCrypto is unavailable (e.g. SSR) the signature is
//   labelled `unsigned-${id}` rather than fabricated. See HONESTY.md §2.1.
// • Any "delay" the file simulates is purely cosmetic.
// ─────────────────────────────────────────────────────────────────────────────

import {
  AbsorptionResultV2,
  RegulatoryConflict,
  RequirementV2,
} from "./types";

const SEED_REQUIREMENTS: RequirementV2[] = [
  {
    id: "ie-dpa-2018-s31",
    jurisdiction: "IE",
    documentRef: "Data Protection Act 2018, s.31",
    severity: "high",
    triggerType: "consent",
    constraint:
      "A child under 16 cannot validly consent to information-society services. Parental authorisation is required.",
    penalty: "Up to €20m or 4% global turnover (GDPR alignment).",
    status: "active",
  },
  {
    id: "eu-gdpr-art-8",
    jurisdiction: "EU",
    documentRef: "GDPR Article 8",
    severity: "high",
    triggerType: "age_gate",
    constraint:
      "Information-society services to a child below 16 require holder-of-parental-responsibility authorisation.",
    status: "active",
  },
  {
    id: "eu-gdpr-art-5e",
    jurisdiction: "EU",
    documentRef: "GDPR Article 5(1)(e)",
    severity: "high",
    triggerType: "retention",
    constraint:
      "Personal data shall be kept in a form which permits identification for no longer than is necessary.",
    status: "active",
  },
  {
    id: "gb-osa-s12",
    jurisdiction: "GB",
    documentRef: "Online Safety Act 2023, s.12",
    severity: "medium",
    triggerType: "retention",
    constraint:
      "Service providers must retain abuse-detection signals for 6 months for safeguarding review.",
    status: "active",
  },
  {
    id: "us-coppa-312",
    jurisdiction: "US",
    documentRef: "16 CFR §312.5 (COPPA)",
    severity: "high",
    triggerType: "consent",
    constraint: "Operators must obtain verifiable parental consent before collecting PII from a child under 13.",
    status: "active",
  },
  {
    id: "pe-ley-29733-art-14",
    jurisdiction: "PE",
    documentRef: "Ley 29733, art. 14",
    severity: "high",
    triggerType: "consent",
    constraint:
      "Procesamiento de datos de menores requiere autorización de tutor / padre.",
    status: "active",
  },
  {
    id: "global-no-bio-minors",
    jurisdiction: "EU",
    documentRef: "Even Keel Learning Internal Policy KL-001",
    severity: "critical",
    triggerType: "biometric",
    constraint: "No biometric data collection from any user, ever.",
    status: "active",
  },
  {
    id: "global-crisis-helpline",
    jurisdiction: "EU",
    documentRef: "Even Keel Learning Internal Policy KL-002",
    severity: "critical",
    triggerType: "crisis_response",
    constraint:
      "Crisis-language detection must trigger safe-response template + Compliance Officer escalation.",
    status: "active",
  },
];

const SEED_CONFLICTS: RegulatoryConflict[] = [
  {
    id: "conflict-001",
    requirementA: SEED_REQUIREMENTS[2], // GDPR retention minimization
    requirementB: SEED_REQUIREMENTS[3], // UK OSA 6-month retention
    conflictType: "DIRECT",
    resolutionStatus: "UNRESOLVED",
    recommendedResolution:
      "RESOLVED_PRIORITY for GDPR Art. 5(1)(e) — minimize retention. UK OSA window applies only to abuse-flagged content.",
    detectedAt: Date.now() - 86400000,
  },
  {
    id: "conflict-002",
    requirementA: SEED_REQUIREMENTS[0], // IE DPA age 16
    requirementB: SEED_REQUIREMENTS[4], // US COPPA age 13
    conflictType: "POTENTIAL",
    resolutionStatus: "RESOLVED_PRIORITY",
    recommendedResolution: "Defer to local jurisdiction of the data subject.",
    resolvedAt: Date.now() - 3600000,
    resolvedBy: "compliance-officer-demo",
    detectedAt: Date.now() - 172800000,
    generatedJustification:
      "Auto-applied. IE DPA 2018 enforced for IE-resident students; COPPA enforced for US-resident students.",
  },
];

export async function getAbsorptionResult(
  jurisdiction: string
): Promise<AbsorptionResultV2> {
  return {
    sourceDocument: `${jurisdiction} regulatory baseline`,
    jurisdiction,
    requirements: SEED_REQUIREMENTS.filter(
      (r) => r.jurisdiction === jurisdiction || r.jurisdiction === "EU"
    ),
    conflicts: SEED_CONFLICTS,
    confidenceScore: 0.92,
    verificationRecommendations: [
      "Manual review recommended for any HIGH severity requirement.",
      "Local Compliance Officer must sign all DIRECT conflicts.",
    ],
    absorbedAt: Date.now(),
  };
}

export async function listActiveRequirements(
  jurisdiction: string
): Promise<RequirementV2[]> {
  return SEED_REQUIREMENTS.filter(
    (r) => (r.jurisdiction === jurisdiction || r.jurisdiction === "EU") && r.status === "active"
  );
}

export async function listConflicts(): Promise<RegulatoryConflict[]> {
  return [...SEED_CONFLICTS];
}

/**
 * Resolves a conflict and produces a *real* ECDSA P-256 signature over the
 * canonical resolution payload via the Web Crypto API. Pass `keyPair` to use
 * a long-lived key; omit it to use the per-tab session key from
 * `lib/crypto/signing.ts`. The signature, public key and digest are all
 * stored on the conflict record so any verifier can re-check it later
 * without contacting any server.
 *
 * Throws no errors; on a missing conflict id, returns `null`. On a Web
 * Crypto failure (e.g. running on the Node SSR pass) the conflict is still
 * marked resolved but with a clearly labelled `unsigned-` prefix so the UI
 * can surface the degraded state rather than fake a signature.
 */
export async function resolveConflict(
  conflictId: string,
  resolvedBy: string,
  justification: string,
  keyPair?: CryptoKeyPair
): Promise<RegulatoryConflict | null> {
  const conflict = SEED_CONFLICTS.find((c) => c.id === conflictId);
  if (!conflict) return null;

  conflict.resolutionStatus = "RESOLVED_PRIORITY";
  conflict.resolvedAt = Date.now();
  conflict.resolvedBy = resolvedBy;
  conflict.generatedJustification = justification;

  // Canonical payload: include conflict id, requirement ids, resolver,
  // justification and resolvedAt. Anything else is presentation.
  const payload = {
    conflictId: conflict.id,
    requirementAId: conflict.requirementA.id,
    requirementBId: conflict.requirementB.id,
    resolution: conflict.resolutionStatus,
    resolvedBy,
    resolvedAt: conflict.resolvedAt,
    justification,
  };

  try {
    // Lazily import the signer so this module remains usable in environments
    // without WebCrypto (the import succeeds but the signer throws inside).
    const signing = await import("../crypto/signing");
    const env = await signing.signPayload(payload, keyPair);
    conflict.signatureFull = env.signatureB64url;
    conflict.signaturePublicKey = env.publicKeyB64url;
    conflict.signatureDigest = env.contentDigestB64url;
    conflict.signedAtIso = env.signedAtIso;
    conflict.signatureAlgorithm = env.algorithm;
    conflict.signature = env.signatureB64url.slice(0, 12) + "…";
  } catch (err) {
    // No browser SubtleCrypto available (e.g. server render). Mark the
    // resolution as unsigned rather than fake a signature.
    conflict.signature = `unsigned-${conflict.id}`;
    // eslint-disable-next-line no-console
    console.warn("[adapter-mock] resolveConflict could not sign:", err);
  }

  return conflict;
}

export function compliancePulseScore(
  conflicts: RegulatoryConflict[]
): number {
  const critical = conflicts.filter(
    (c) =>
      c.resolutionStatus === "UNRESOLVED" &&
      (c.requirementA.severity === "critical" || c.requirementB.severity === "critical")
  ).length;
  const unresolved = conflicts.filter(
    (c) => c.resolutionStatus === "UNRESOLVED"
  ).length;
  if (conflicts.length === 0) return 100;
  return Math.max(
    0,
    Math.round(100 - critical * 25 - unresolved * 8)
  );
}
