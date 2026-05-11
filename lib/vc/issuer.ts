// ─────────────────────────────────────────────────────────────────────────────
// lib/vc/issuer.ts
//
// v1.7.0 — W3C Verifiable Credentials Data Model 2.0 issuer.
//
// What this module does
// ─────────────────────
// Wraps a teacher-signed `TeacherAttestationEnvelope` in a W3C VC 2.0
// document and (re-)signs it under a stable VC `proof` block so the
// result can be presented to any standards-conforming VC verifier.
//
//   teacher attestation → unsignedCredential → JCS-style canonicalization
//   → digest → ECDSA-P256 signature → proof block → VerifiableCredential
//
// What this module does NOT do (deferred to follow-ups in the VC track)
// ─────────────────────────────────────────────────────────────────────
//   • StatusList2021 revocation registry (vc2-status)
//   • A standalone verifier web app (vc3-verifier)
//   • A real did:web document published at a URL (vc4-did)
//
// FAITHFULNESS / DEVIATION
// ────────────────────────
// Faithful to W3C VC 2.0:
//   • `@context` first item is `https://www.w3.org/ns/credentials/v2`
//   • `type` includes `VerifiableCredential`
//   • `issuer` is a string DID (placeholder until did:web is wired)
//   • `validFrom` is the attestation's `attestedAtIso`
//   • `credentialSubject` carries an `id` and a typed claim array
//   • `proof` block uses `type: DataIntegrityProof`,
//     `cryptosuite: ecdsa-jcs-2019`, `proofPurpose: assertionMethod`,
//     and `proofValue` (base64url of the raw ECDSA signature)
//
// Pilot simplifications (called out so a reviewer can audit them):
//   • Canonicalization is a deterministic JSON.stringify with sorted
//     keys (a JCS subset, not full RFC 8785). Faithful enough that two
//     parties using THIS function agree on bytes; not faithful enough
//     to interop with a third-party JCS canonicalizer for unusual
//     unicode shapes. Documented; revisit before district phase.
//   • `verificationMethod` points to `${issuer}#key-1` as a stable
//     fragment. The actual key material is the teacher attestation's
//     public key (carried separately in our system; a real did:web
//     document would publish it).
//   • No `credentialStatus` block in v1; added when the StatusList2021
//     registry lands.
// ─────────────────────────────────────────────────────────────────────────────

import { signPayloadWithAutoPasskey, type SignedEnvelope } from "@/lib/crypto/signing";
import type { TeacherAttestationEnvelope } from "@/lib/teacher/attestation";
import {
  validateSpecPointClaim,
  type SpecPointClaim,
} from "./claim-vocabulary";
import type { StatusList2021Entry } from "./status-list";

// ─── Types ─────────────────────────────────────────────────────────────────

/** The single VC context URL we ship in v1. */
export const VC_V2_CONTEXT = "https://www.w3.org/ns/credentials/v2" as const;

/** Our local type name added alongside `VerifiableCredential`. */
export const EVEN_KEEL_CREDENTIAL_TYPE = "EvenKeelAttestationCredential" as const;

/** The Data Integrity proof type & cryptosuite we emit. */
export const PROOF_TYPE = "DataIntegrityProof" as const;
export const PROOF_CRYPTOSUITE = "ecdsa-jcs-2019" as const;

/** Verdict → human-readable claim name. */
const VERDICT_CLAIM_NAME: Record<string, string> = {
  "verified-mastery": "DemonstratedMastery",
  "verified-with-support": "DemonstratedMasteryWithSupport",
  "needs-revisit": "RequiresRevisit",
  "anomaly-rejected": "AttestationRejected",
};

/** Shape of `credentialSubject` we emit. */
export interface EvenKeelCredentialSubject {
  /** Stable URN for the learner. Schools may rewrite to a did: form. */
  id: string;
  type: "Learner";
  /** Verdict-mapped claim name. */
  claim: string;
  /** Spec points the teacher attested to. */
  demonstratedSpecPoints: SpecPointClaim[];
  /** Digest of the underlying CRT for provenance chaining. */
  evidenceContentDigestB64url: string;
  /** Problem identifier (verbatim from the attestation). */
  problemId: string;
  /** Optional reviewer note (verbatim from the attestation). */
  reviewerNote?: string;
}

/** Unsigned VC document. */
export interface UnsignedVerifiableCredential {
  "@context": [typeof VC_V2_CONTEXT, ...string[]];
  id: string;
  type: ["VerifiableCredential", typeof EVEN_KEEL_CREDENTIAL_TYPE];
  issuer: string;
  validFrom: string;
  credentialSubject: EvenKeelCredentialSubject;
  /** Optional StatusList2021 entry pointing at a bit in the issuer's
   *  status-list credential. Present iff the issuer was given a status
   *  registry at issuance time. (v1.7.1) */
  credentialStatus?: StatusList2021Entry;
}

/** Proof block embedded into the signed VC. */
export interface DataIntegrityProof {
  type: typeof PROOF_TYPE;
  cryptosuite: typeof PROOF_CRYPTOSUITE;
  created: string;
  verificationMethod: string;
  proofPurpose: "assertionMethod";
  /** base64url of the ECDSA-P256 signature over the canonicalized doc. */
  proofValue: string;
  /** base64url of the SPKI public key used. Convenience for offline
   *  verifiers; a did:web verifier would resolve this from the issuer. */
  publicKeyB64url: string;
}

/** Signed VC = unsigned doc + proof. */
export type VerifiableCredential = UnsignedVerifiableCredential & {
  proof: DataIntegrityProof;
};

// ─── Canonicalization ──────────────────────────────────────────────────────

/**
 * Deterministic JSON serialization with recursively-sorted keys.
 * A JCS subset — sufficient for two parties using THIS function to
 * agree on bytes. NOT a full RFC 8785 implementation (no unusual-
 * unicode normalization).
 */
export function canonicalizeJcsSubset(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([, val]) => val !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const out: Record<string, unknown> = {};
    for (const [k, val] of entries) out[k] = sortKeys(val);
    return out;
  }
  return v;
}

// ─── Issuance ──────────────────────────────────────────────────────────────

export interface IssueVcInput {
  /** The signed teacher attestation we are wrapping. */
  attestation: TeacherAttestationEnvelope;
  /** Issuer DID (e.g. `did:web:school.example`). */
  issuerDid: string;
  /** Optional override for `validFrom`. Defaults to attestation's
   *  `attestedAtIso`. */
  validFromIso?: string;
  /** Optional VC id; defaults to a URN derived from the attestation
   *  signature so the same attestation always produces the same id. */
  id?: string;
  /**
   * Optional signer override. Default in production is the
   * passkey-required auto-signer. Tests inject a session-key signer to
   * exercise the round-trip without a WebAuthn ceremony. The signer
   * MUST hash the JSON of `{ canonical: <string> }` as the payload —
   * the verifier reproduces exactly that wrapping.
   */
  signer?: (canonicalPayload: { canonical: string }) => Promise<
    SignedEnvelope<{ canonical: string }>
  >;
  /**
   * Optional inline `credentialStatus` block. If present it is included
   * in the canonical bytes BEFORE signing, so any tamper to the status
   * pointer post-issuance breaks signature verification. Build it via
   * `lib/vc/status-registry.ts#allocate()` for normal flows. (v1.7.1)
   */
  credentialStatus?: StatusList2021Entry;
}

/**
 * Build (but do not sign) a VC document. Pure. Useful for verifiers
 * that need to reconstruct the unsigned form for digest checks.
 */
export function buildUnsignedCredential(
  input: IssueVcInput,
): UnsignedVerifiableCredential {
  const a = input.attestation.payload;
  // Forward-validate each spec point through the canonical vocabulary.
  // We don't transform — we just guarantee the issuer never emits a
  // claim the vocabulary would later reject.
  const demonstratedSpecPoints: SpecPointClaim[] = [];
  for (const sp of a.specPoints) {
    const r = validateSpecPointClaim(sp);
    if (!r.ok) {
      throw new Error(`invalid_spec_point: ${r.reason}`);
    }
    demonstratedSpecPoints.push(r.claim);
  }

  const claim = VERDICT_CLAIM_NAME[a.verdict] ?? "UnknownVerdict";

  const subject: EvenKeelCredentialSubject = {
    id: `urn:evenkeel:learner:${a.studentExternalId}`,
    type: "Learner",
    claim,
    demonstratedSpecPoints,
    evidenceContentDigestB64url: a.crtContentDigestB64url,
    problemId: a.problemId,
  };
  if (a.reviewerNote) subject.reviewerNote = a.reviewerNote;

  const id =
    input.id ??
    `urn:evenkeel:vc:${input.attestation.contentDigestB64url}`;

  const unsigned: UnsignedVerifiableCredential = {
    "@context": [VC_V2_CONTEXT],
    id,
    type: ["VerifiableCredential", EVEN_KEEL_CREDENTIAL_TYPE],
    issuer: input.issuerDid,
    validFrom: input.validFromIso ?? a.attestedAtIso,
    credentialSubject: subject,
  };
  if (input.credentialStatus) {
    unsigned.credentialStatus = input.credentialStatus;
  }
  return unsigned;
}

/**
 * Issue (and sign) a Verifiable Credential. The teacher's passkey is
 * REQUIRED — a session-key VC would not be a credible credential.
 *
 * The proof signs the canonicalized unsigned credential, NOT the
 * attestation payload directly. This is what makes the VC verifiable by
 * a downstream party that knows only W3C VC rules and the issuer's
 * public key — they do not need to know about our internal envelope
 * format.
 */
export async function issueVerifiableCredential(
  input: IssueVcInput,
): Promise<VerifiableCredential> {
  const unsigned = buildUnsignedCredential(input);
  // Sign the canonical form. We re-use `signPayloadWithAutoPasskey`
  // by passing the unsigned doc as payload; the inner signer hashes
  // the JSON of whatever we hand it. Because we hand it the canonical
  // form via a wrapper object, both issuer and verifier get the same
  // bytes.
  //
  // We pass `{ canonical: <string> }` so the inner signer hashes the
  // canonical string verbatim (any object would be re-stringified by
  // the signer, which would NOT match our canonicalization).
  const canonical = canonicalizeJcsSubset(unsigned);
  const sign =
    input.signer ??
    ((p: { canonical: string }) =>
      signPayloadWithAutoPasskey<{ canonical: string }>(p, {
        requirePasskey: true,
      }));
  const envelope = await sign({ canonical });

  const proof: DataIntegrityProof = {
    type: PROOF_TYPE,
    cryptosuite: PROOF_CRYPTOSUITE,
    created: envelope.signedAtIso,
    verificationMethod: `${input.issuerDid}#key-1`,
    proofPurpose: "assertionMethod",
    proofValue: envelope.signatureB64url,
    publicKeyB64url: envelope.publicKeyB64url,
  };

  return { ...unsigned, proof };
}
