// ─────────────────────────────────────────────────────────────────────────────
// lib/vc/standalone-verifier-helpers.ts
//
// v1.7.2 — Pure helpers for the /verify standalone web app (vc3-verifier).
//
// What this module does
// ─────────────────────
//   • parseCredentialFromPaste — JSON-parse with structural sanity, so the
//     UI can show "looks like JSON, but missing fields X" instead of a raw
//     SyntaxError to a college admissions officer.
//   • extractEncodedListFromPaste — accept either the raw `encodedList`
//     base64url string OR the full StatusList2021Credential JSON; in the
//     latter case, dig out `credentialSubject.encodedList`.
//   • summarizeCredentialForDisplay — produce a flat, human-friendly
//     summary record (issuer, subject id, claim, validFrom, spec-points
//     count, has-revocation-pointer) without leaking signature bytes or
//     other crypto detail to the UI layer.
//   • describeReason — map machine reason codes to short, plain-English
//     explanations a non-cryptographer can understand.
//
// Why a separate module
// ─────────────────────
// The page itself is a Client Component and is awkward to unit-test. Each
// helper here is pure (no React, no DOM, no crypto), so the failure modes
// of the verifier UX can be exercised under vitest directly.
// ─────────────────────────────────────────────────────────────────────────────

import {
  EVEN_KEEL_CREDENTIAL_TYPE,
  VC_V2_CONTEXT,
  type VerifiableCredential,
} from "./issuer";
import type { VcVerificationReason } from "./verifier";

// ─── Paste parsing ─────────────────────────────────────────────────────────

export type PasteParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: PasteParseReason; detail?: string };

export type PasteParseReason =
  | "empty"
  | "not_json"
  | "not_an_object"
  | "missing_context"
  | "wrong_context_first"
  | "missing_type"
  | "wrong_type"
  | "missing_credential_subject"
  | "missing_proof";

/**
 * Parse a pasted string as a credential. Performs a structural sanity
 * check — the same one the verifier's `checkCredentialShape` performs —
 * so the UI can give a useful error message before any crypto runs.
 *
 * IMPORTANT: a return of `{ ok: true }` means the JSON parses and the
 * outer shape is plausible. It does NOT mean the credential is valid;
 * the actual `verifyCredential()` call still has to run.
 */
export function parseCredentialFromPaste(
  raw: string,
): PasteParseResult<VerifiableCredential> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, reason: "empty" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    return {
      ok: false,
      reason: "not_json",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, reason: "not_an_object" };
  }
  const c = parsed as Record<string, unknown>;
  if (!Array.isArray(c["@context"]) || c["@context"].length === 0) {
    return { ok: false, reason: "missing_context" };
  }
  if (c["@context"][0] !== VC_V2_CONTEXT) {
    return { ok: false, reason: "wrong_context_first" };
  }
  if (!Array.isArray(c.type) || c.type.length === 0) {
    return { ok: false, reason: "missing_type" };
  }
  if (
    !c.type.includes("VerifiableCredential") ||
    !c.type.includes(EVEN_KEEL_CREDENTIAL_TYPE)
  ) {
    return { ok: false, reason: "wrong_type" };
  }
  if (!c.credentialSubject || typeof c.credentialSubject !== "object") {
    return { ok: false, reason: "missing_credential_subject" };
  }
  if (!c.proof || typeof c.proof !== "object") {
    return { ok: false, reason: "missing_proof" };
  }
  return { ok: true, value: parsed as VerifiableCredential };
}

/**
 * Accept either:
 *   (a) a raw `encodedList` base64url string (gzip + base64url bitstring), or
 *   (b) a full StatusList2021Credential JSON document — we dig out
 *       `credentialSubject.encodedList`.
 *
 * Returns the encodedList string ready to feed to `decodeBitstring`.
 *
 * If the paste is empty, returns `{ ok: false, reason: "empty" }` —
 * the caller should treat that as "skip revocation check".
 */
export function extractEncodedListFromPaste(
  raw: string,
): PasteParseResult<string> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, reason: "empty" };

  // Heuristic: if it starts with `{` it's JSON; otherwise treat as raw
  // encodedList. This avoids a JSON.parse on giant base64url strings
  // (which would succeed in pathological cases — the leading char check
  // is the cleanest disambiguator).
  if (trimmed[0] !== "{") {
    return { ok: true, value: trimmed };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    return {
      ok: false,
      reason: "not_json",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, reason: "not_an_object" };
  }
  const c = parsed as Record<string, unknown>;
  const subject = c.credentialSubject as Record<string, unknown> | undefined;
  if (!subject || typeof subject !== "object") {
    return { ok: false, reason: "missing_credential_subject" };
  }
  const enc = subject.encodedList;
  if (typeof enc !== "string" || enc.length === 0) {
    return { ok: false, reason: "missing_credential_subject" };
  }
  return { ok: true, value: enc };
}

// ─── Display summary ───────────────────────────────────────────────────────

export interface CredentialDisplaySummary {
  issuer: string;
  validFrom: string;
  subjectId: string;
  claim: string;
  problemId: string;
  reviewerNote: string | null;
  specPoints: Array<{
    framework: string;
    code: string;
    label: string | null;
  }>;
  hasRevocationPointer: boolean;
  revocationListUrl: string | null;
  revocationListIndex: number | null;
  evidenceContentDigestPrefix: string;
}

/**
 * Produce a flat summary of a credential for the verifier UI. Strips
 * signature bytes — those belong in a "raw JSON" expander, not in the
 * primary display surface. Pure; safe to call on any object that passed
 * `parseCredentialFromPaste`.
 */
export function summarizeCredentialForDisplay(
  cred: VerifiableCredential,
): CredentialDisplaySummary {
  const subj = cred.credentialSubject;
  const status = (cred as { credentialStatus?: Record<string, unknown> })
    .credentialStatus;
  return {
    issuer: cred.issuer,
    validFrom: cred.validFrom,
    subjectId: subj.id,
    claim: subj.claim,
    problemId: subj.problemId,
    reviewerNote: subj.reviewerNote ?? null,
    specPoints: (subj.demonstratedSpecPoints ?? []).map((sp) => ({
      framework: sp.framework,
      code: sp.code,
      label: sp.label ?? null,
    })),
    hasRevocationPointer: !!status,
    revocationListUrl:
      typeof status?.statusListCredential === "string"
        ? status.statusListCredential
        : null,
    revocationListIndex:
      typeof status?.statusListIndex === "string"
        ? Number(status.statusListIndex)
        : null,
    evidenceContentDigestPrefix:
      typeof subj.evidenceContentDigestB64url === "string"
        ? subj.evidenceContentDigestB64url.slice(0, 16)
        : "",
  };
}

// ─── Reason → English ──────────────────────────────────────────────────────

/**
 * Map a machine reason code to a short plain-English description for a
 * non-technical reviewer. Stable — UI can compare to the machine code
 * for icons, but the text is the user-facing payload.
 */
export function describeReason(reason: VcVerificationReason): string {
  switch (reason) {
    case "not_an_object":
      return "Pasted value did not look like a JSON object.";
    case "missing_context":
      return "Credential is missing the required @context array.";
    case "wrong_context":
      return "First @context entry is not the W3C VC v2 URL.";
    case "missing_type":
      return "Credential is missing the required type array.";
    case "wrong_type":
      return "Credential is not the expected EvenKeelAttestationCredential type.";
    case "missing_issuer":
      return "Credential is missing an issuer.";
    case "missing_validFrom":
      return "Credential is missing the validFrom date.";
    case "missing_credentialSubject":
      return "Credential is missing the credentialSubject block.";
    case "missing_proof":
      return "Credential is missing its cryptographic proof block.";
    case "wrong_proof_type":
      return "Proof type is not the expected DataIntegrityProof.";
    case "wrong_cryptosuite":
      return "Proof cryptosuite is not the expected ecdsa-jcs-2019.";
    case "wrong_proof_purpose":
      return "Proof purpose is not assertionMethod.";
    case "missing_proof_value":
      return "Proof is missing its proofValue (signature bytes).";
    case "missing_public_key":
      return "Proof is missing the public key needed to verify.";
    case "invalid_spec_point":
      return "One of the demonstrated spec-points failed vocabulary validation.";
    case "bad_public_key":
      return "Embedded public key could not be imported (likely corrupted).";
    case "bad_signature":
      return "Signature did not verify against the credential's canonical bytes — the credential has been tampered with, or it was issued by a different key than the proof claims.";
    case "verify_threw":
      return "An unexpected error occurred during signature verification.";
    case "credential_revoked":
      return "The issuer has REVOKED this credential. Do not accept it.";
    case "credential_suspended":
      return "The issuer has SUSPENDED this credential. It may be reinstated later.";
    case "status_resolver_failed":
      return "Could not load the issuer's status list to check revocation. The credential's signature is valid but its current revocation status is unknown.";
    case "status_index_out_of_range":
      return "The credential's status pointer is outside the issuer's published status list. This is suspicious — treat as untrusted.";
    case "wrong_status_list_url":
      return "The credential points at a status list URL that is not in the verifier's allowlist.";
  }
}

/**
 * Map paste-parse reasons to plain English. Distinct from
 * `describeReason` because these fire BEFORE the verifier runs and have
 * their own error shape.
 */
export function describePasteReason(reason: PasteParseReason): string {
  switch (reason) {
    case "empty":
      return "Paste a credential to verify.";
    case "not_json":
      return "Pasted text is not valid JSON.";
    case "not_an_object":
      return "Pasted JSON is not an object.";
    case "missing_context":
      return "Missing @context array.";
    case "wrong_context_first":
      return "First @context entry is not the W3C VC v2 URL.";
    case "missing_type":
      return "Missing type array.";
    case "wrong_type":
      return "type does not include both VerifiableCredential and EvenKeelAttestationCredential.";
    case "missing_credential_subject":
      return "Missing or malformed credentialSubject block.";
    case "missing_proof":
      return "Missing proof block — this credential is unsigned.";
  }
}
