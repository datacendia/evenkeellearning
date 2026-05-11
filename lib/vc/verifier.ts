// ─────────────────────────────────────────────────────────────────────────────
// lib/vc/verifier.ts
//
// v1.7.0 — Verify a Verifiable Credential issued by `lib/vc/issuer.ts`.
//
// What this module does
// ─────────────────────
//   1. Structural check of the VC shape (W3C VC 2.0 essentials).
//   2. Vocabulary validation of every spec-point claim.
//   3. Re-canonicalization of the credential WITHOUT the proof block.
//   4. ECDSA-P256-SHA256 signature verification over the canonical bytes
//      using the public key embedded in the proof.
//   5. (Optional) revocation check against a StatusList2021 registry —
//      stubbed for v1, populated when `vc2-status` lands.
//
// All checks are pure functions returning a discriminated result so any
// rejection path can be unit-tested without environmental setup.
// ─────────────────────────────────────────────────────────────────────────────

import {
  EVEN_KEEL_CREDENTIAL_TYPE,
  PROOF_CRYPTOSUITE,
  PROOF_TYPE,
  VC_V2_CONTEXT,
  canonicalizeJcsSubset,
  type VerifiableCredential,
  type DataIntegrityProof,
} from "./issuer";
import {
  CLAIM_VOCABULARY_VERSION,
  validateSpecPointClaim,
} from "./claim-vocabulary";
import {
  decodeBitstring,
  isRevokedByIndex,
  STATUS_LIST_ENTRY_TYPE,
  STATUS_PURPOSE_REVOCATION,
  type StatusListCredential,
} from "./status-list";

// ─── Result types ──────────────────────────────────────────────────────────

export type VcVerificationReason =
  | "not_an_object"
  | "missing_context"
  | "wrong_context"
  | "missing_type"
  | "wrong_type"
  | "missing_issuer"
  | "missing_validFrom"
  | "missing_credentialSubject"
  | "missing_proof"
  | "wrong_proof_type"
  | "wrong_cryptosuite"
  | "wrong_proof_purpose"
  | "missing_proof_value"
  | "missing_public_key"
  | "invalid_spec_point"
  | "bad_public_key"
  | "bad_signature"
  | "verify_threw"
  | "revoked"
  | "status_list_mismatch";

export type VcVerificationResult =
  | { ok: true; credential: VerifiableCredential }
  | { ok: false; reason: VcVerificationReason; detail?: string };

// ─── Structural check (synchronous) ────────────────────────────────────────

/**
 * Check a candidate VC's SHAPE. Does not touch crypto. Pure.
 * On success the input value is the same reference (caller may treat
 * it as typed). Used as the first pass inside `verifyCredential` and
 * also exposed for callers that want to short-circuit.
 */
export function checkCredentialShape(
  raw: unknown,
  supportedVocabularyVersion: number = CLAIM_VOCABULARY_VERSION,
): VcVerificationResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "not_an_object" };
  }
  const c = raw as Record<string, unknown>;

  // @context
  if (!Array.isArray(c["@context"]) || c["@context"].length === 0) {
    return { ok: false, reason: "missing_context" };
  }
  if (c["@context"][0] !== VC_V2_CONTEXT) {
    return { ok: false, reason: "wrong_context" };
  }

  // type
  if (!Array.isArray(c.type) || c.type.length === 0) {
    return { ok: false, reason: "missing_type" };
  }
  if (
    !c.type.includes("VerifiableCredential") ||
    !c.type.includes(EVEN_KEEL_CREDENTIAL_TYPE)
  ) {
    return { ok: false, reason: "wrong_type" };
  }

  // issuer
  if (typeof c.issuer !== "string" || c.issuer.length === 0) {
    return { ok: false, reason: "missing_issuer" };
  }

  // validFrom
  if (typeof c.validFrom !== "string" || c.validFrom.length === 0) {
    return { ok: false, reason: "missing_validFrom" };
  }

  // credentialSubject
  const subject = c.credentialSubject;
  if (!subject || typeof subject !== "object") {
    return { ok: false, reason: "missing_credentialSubject" };
  }
  const subj = subject as Record<string, unknown>;
  if (!Array.isArray(subj.demonstratedSpecPoints)) {
    return { ok: false, reason: "missing_credentialSubject" };
  }
  for (const sp of subj.demonstratedSpecPoints) {
    const r = validateSpecPointClaim(sp, supportedVocabularyVersion);
    if (!r.ok) {
      return {
        ok: false,
        reason: "invalid_spec_point",
        detail: r.reason,
      };
    }
  }

  // proof
  const proof = c.proof;
  if (!proof || typeof proof !== "object") {
    return { ok: false, reason: "missing_proof" };
  }
  const p = proof as Record<string, unknown>;
  if (p.type !== PROOF_TYPE) {
    return { ok: false, reason: "wrong_proof_type" };
  }
  if (p.cryptosuite !== PROOF_CRYPTOSUITE) {
    return { ok: false, reason: "wrong_cryptosuite" };
  }
  if (p.proofPurpose !== "assertionMethod") {
    return { ok: false, reason: "wrong_proof_purpose" };
  }
  if (typeof p.proofValue !== "string" || p.proofValue.length === 0) {
    return { ok: false, reason: "missing_proof_value" };
  }
  if (typeof p.publicKeyB64url !== "string" || p.publicKeyB64url.length === 0) {
    return { ok: false, reason: "missing_public_key" };
  }

  return { ok: true, credential: c as unknown as VerifiableCredential };
}

// ─── Signature check (async) ───────────────────────────────────────────────

const VERIFY_PARAMS = { name: "ECDSA", hash: { name: "SHA-256" } } as const;
const SIGNING_ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;

function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes));
  return new Uint8Array(buf);
}

/**
 * Recompute the canonical bytes that the issuer signed (the credential
 * with its `proof` block stripped) and verify the ECDSA-P256 signature.
 *
 * The signer hashes the canonical JSON string of `{ canonical: <str> }`,
 * so we must reproduce that exact wrapping here.
 */
async function verifyProofSignature(
  credential: VerifiableCredential,
): Promise<{ ok: true } | { ok: false; reason: VcVerificationReason }> {
  const proof: DataIntegrityProof = credential.proof;
  const { proof: _omit, ...unsigned } = credential;
  void _omit;
  const canonical = canonicalizeJcsSubset(unsigned);

  // Match the issuer's signer wrapping: hash JSON of `{ canonical }`.
  const wrapperJson = JSON.stringify({ canonical });
  const digest = await sha256(new TextEncoder().encode(wrapperJson));
  const digestB64url = bytesToBase64Url(digest);

  // Import the SPKI public key.
  let pubKey: CryptoKey;
  try {
    pubKey = await crypto.subtle.importKey(
      "spki",
      toArrayBuffer(base64UrlToBytes(proof.publicKeyB64url)),
      SIGNING_ALGORITHM,
      true,
      ["verify"],
    );
  } catch {
    return { ok: false, reason: "bad_public_key" };
  }

  // Our session signer signs the UTF-8 bytes of the digest STRING (the
  // same convention as `lib/crypto/signing.ts`). Reproduce that here.
  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      VERIFY_PARAMS,
      pubKey,
      toArrayBuffer(base64UrlToBytes(proof.proofValue)),
      toArrayBuffer(new TextEncoder().encode(digestB64url)),
    );
  } catch {
    return { ok: false, reason: "verify_threw" };
  }
  if (!valid) return { ok: false, reason: "bad_signature" };
  return { ok: true };
}

export interface VerifyCredentialOptions {
  /** Clamp the accepted claim-vocabulary version (verifier-older-than-
   *  issuer simulation). Defaults to the build's compiled version. */
  supportedVocabularyVersion?: number;
  /**
   * Optional revocation resolver. When provided AND the VC carries a
   * `credentialStatus` block, the verifier calls this with the status-
   * list URL and expects either the decoded status-list credential
   * back, or `null` if the list could not be resolved.
   *
   * Returning `null` is NOT a verification failure — an offline
   * verifier is expected to pass the signature check and surface the
   * fact that revocation could not be checked. We DO fail verification
   * when the returned list's id does not match the URL requested, or
   * when the bit at the entry's index is 1.
   */
  resolveStatusList?: (
    statusListUrl: string,
  ) => Promise<StatusListCredential | null>;
}

/**
 * Verify a VC end-to-end. Returns a discriminated result whose
 * `reason` is a stable machine code on rejection.
 */
export async function verifyCredential(
  raw: unknown,
  optionsOrSupportedVersion:
    | VerifyCredentialOptions
    | number = CLAIM_VOCABULARY_VERSION,
): Promise<VcVerificationResult> {
  const opts: VerifyCredentialOptions =
    typeof optionsOrSupportedVersion === "number"
      ? { supportedVocabularyVersion: optionsOrSupportedVersion }
      : optionsOrSupportedVersion;
  const supportedVocabularyVersion =
    opts.supportedVocabularyVersion ?? CLAIM_VOCABULARY_VERSION;

  const shape = checkCredentialShape(raw, supportedVocabularyVersion);
  if (!shape.ok) return shape;
  const sig = await verifyProofSignature(shape.credential);
  if (!sig.ok) return { ok: false, reason: sig.reason };

  // Revocation — only checked when the VC declares a status and the
  // caller supplied a resolver.
  const statusEntry = shape.credential.credentialStatus;
  if (statusEntry && opts.resolveStatusList) {
    if (
      statusEntry.type !== STATUS_LIST_ENTRY_TYPE ||
      statusEntry.statusPurpose !== STATUS_PURPOSE_REVOCATION
    ) {
      return { ok: false, reason: "status_list_mismatch" };
    }
    const list = await opts.resolveStatusList(statusEntry.statusListCredential);
    if (list) {
      if (list.id !== statusEntry.statusListCredential) {
        return { ok: false, reason: "status_list_mismatch" };
      }
      const index = Number(statusEntry.statusListIndex);
      if (!Number.isInteger(index) || index < 0) {
        return { ok: false, reason: "status_list_mismatch" };
      }
      const bits = decodeBitstring(list.credentialSubject.encodedList);
      if (index >= bits.length * 8) {
        return { ok: false, reason: "status_list_mismatch" };
      }
      if (isRevokedByIndex(bits, index)) {
        return { ok: false, reason: "revoked" };
      }
    }
    // list === null → offline/unreachable; pass through (documented).
  }

  return { ok: true, credential: shape.credential };
}
