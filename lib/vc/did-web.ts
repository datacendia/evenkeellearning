// ─────────────────────────────────────────────────────────────────────────────
// lib/vc/did-web.ts
//
// v1.7.3 — did:web issuer document (vc4-did).
//
// What did:web is
// ───────────────
// A DID method that resolves an identifier of the form
//   did:web:example.school                 → https://example.school/.well-known/did.json
//   did:web:example.school:issuers:maths   → https://example.school/issuers/maths/did.json
// to a JSON document that publishes the issuer's cryptographic keys
// under stable ids. A verifier resolves the DID, finds the key
// referenced by a VC's `proof.verificationMethod`, and uses THAT key
// (not the key embedded in the VC proof) to check the signature.
//
// Why it matters
// ──────────────
// The VC verifier we already ship (`lib/vc/verifier.ts`) checks that
// the embedded `proof.publicKeyB64url` signed the canonicalized
// credential. But that only proves "the person holding that key signed
// it" — not "the school named in `issuer` signed it". A did:web
// document closes that gap: the verifier fetches the DID document over
// HTTPS, confirms the document is served under the DNS name in the
// `issuer` field, and confirms the embedded public key appears in the
// document under the referenced key id.
//
// Pilot scope
// ───────────
//   • `buildDidDocument()` — pure, in-memory construction of the
//     JSON-LD document a school would publish at
//     `/.well-known/did.json`.
//   • `resolveDidWebUrl()` — turns a `did:web:...` identifier into the
//     HTTPS URL the document is expected to live at.
//   • `verifyVerificationMethodBinding()` — given a fetched DID
//     document and a VC's `proof.verificationMethod`, confirms the
//     referenced key matches the embedded SPKI.
//
// This module is PURE. Actual HTTP fetching is the caller's
// responsibility — for the standalone verifier that's `fetch()` in the
// browser; for server-side verifiers it might be a cached registry.
// Keeping fetch out of this module means the logic is deterministic
// and fully unit-testable.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Types ─────────────────────────────────────────────────────────────────

export const DID_CONTEXT_V1 = "https://www.w3.org/ns/did/v1" as const;
export const JWS_2020_CONTEXT =
  "https://w3id.org/security/suites/jws-2020/v1" as const;

/**
 * A verification method as published in a DID document. We emit the
 * `JsonWebKey2020` variant because it carries the public key as a
 * JWK — the most broadly interoperable shape for ECDSA P-256 keys.
 *
 * The `publicKeyBase64url` variant is included as a convenience for
 * verifiers that already have SPKI-shaped keys on hand (our own
 * verifier does). Named `publicKeyMultibase`-style but base64url — a
 * documented pilot-only extension. Revisit at district scale.
 */
export interface VerificationMethod {
  id: string;
  type: "JsonWebKey2020";
  controller: string;
  publicKeyJwk: JsonWebKeyEC;
  /** Non-standard convenience duplicate (see header note). */
  publicKeyBase64url?: string;
}

export interface JsonWebKeyEC {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
  kid?: string;
  alg?: "ES256";
  use?: "sig";
}

export interface DidDocument {
  "@context": [typeof DID_CONTEXT_V1, ...string[]];
  id: string;
  verificationMethod: VerificationMethod[];
  /**
   * Which verification methods may be used to make assertions (the
   * purpose we use when signing VCs). Values are either full ids or
   * fragment ids like `#key-1`.
   */
  assertionMethod: string[];
}

// ─── did:web <-> URL ───────────────────────────────────────────────────────

/**
 * Resolve a `did:web:...` identifier to the HTTPS URL where its DID
 * document is expected. Implements the mapping from the did:web spec:
 *   • `did:web:example.com` → `https://example.com/.well-known/did.json`
 *   • `did:web:example.com:path:to:issuer` → `https://example.com/path/to/issuer/did.json`
 *   • Port-in-domain via URL-encoded colon: `did:web:example.com%3A8443` → `https://example.com:8443/.well-known/did.json`
 */
export function resolveDidWebUrl(did: string): string {
  if (!did.startsWith("did:web:")) {
    throw new Error("not_did_web");
  }
  const rest = did.slice("did:web:".length);
  if (rest.length === 0) throw new Error("empty_did_identifier");
  const segments = rest.split(":");
  // First segment is the domain (with optional %3A-encoded port).
  const domain = decodeURIComponent(segments[0]);
  if (segments.length === 1) {
    return `https://${domain}/.well-known/did.json`;
  }
  const pathSegments = segments.slice(1).map(decodeURIComponent);
  return `https://${domain}/${pathSegments.join("/")}/did.json`;
}

// ─── SPKI <-> JWK conversion ───────────────────────────────────────────────

/** Convenience: given a base64url SPKI public key, produce a JWK + a
 *  duplicate base64url convenience field. Uses Web Crypto. */
export async function spkiBase64UrlToJwk(
  spkiB64url: string,
): Promise<JsonWebKeyEC> {
  const key = await crypto.subtle.importKey(
    "spki",
    base64UrlToArrayBuffer(spkiB64url),
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["verify"],
  );
  const jwk = (await crypto.subtle.exportKey("jwk", key)) as JsonWebKey;
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y) {
    throw new Error("not_ec_p256_jwk");
  }
  return {
    kty: "EC",
    crv: "P-256",
    x: jwk.x,
    y: jwk.y,
    alg: "ES256",
    use: "sig",
  };
}

/** JWK → SPKI base64url, for comparing a published JWK against an
 *  embedded SPKI-shaped `publicKeyB64url` on a VC proof. */
export async function jwkToSpkiBase64Url(jwk: JsonWebKeyEC): Promise<string> {
  const key = await crypto.subtle.importKey(
    "jwk",
    {
      kty: jwk.kty,
      crv: jwk.crv,
      x: jwk.x,
      y: jwk.y,
      ext: true,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["verify"],
  );
  const spki = await crypto.subtle.exportKey("spki", key);
  return arrayBufferToBase64Url(spki);
}

// ─── Build the DID document ────────────────────────────────────────────────

export interface BuildDidDocumentInput {
  /** The DID identifier (e.g. `did:web:school.example`). */
  did: string;
  /** The keys to publish under `verificationMethod`. */
  keys: Array<{
    /** Fragment id, e.g. `key-1`. Combined into `${did}#${fragmentId}`. */
    fragmentId: string;
    /** SPKI public key encoded as base64url. */
    publicKeyB64url: string;
  }>;
}

export async function buildDidDocument(
  input: BuildDidDocumentInput,
): Promise<DidDocument> {
  if (!input.did.startsWith("did:web:")) {
    throw new Error("not_did_web");
  }
  if (input.keys.length === 0) {
    throw new Error("no_keys");
  }
  const vms: VerificationMethod[] = [];
  const assertionMethodIds: string[] = [];
  for (const k of input.keys) {
    const vmId = `${input.did}#${k.fragmentId}`;
    const jwk = await spkiBase64UrlToJwk(k.publicKeyB64url);
    vms.push({
      id: vmId,
      type: "JsonWebKey2020",
      controller: input.did,
      publicKeyJwk: { ...jwk, kid: k.fragmentId },
      publicKeyBase64url: k.publicKeyB64url,
    });
    assertionMethodIds.push(vmId);
  }
  return {
    "@context": [DID_CONTEXT_V1, JWS_2020_CONTEXT],
    id: input.did,
    verificationMethod: vms,
    assertionMethod: assertionMethodIds,
  };
}

// ─── Verification: VC proof.verificationMethod ↔ DID document ──────────────

export type DidBindingReason =
  | "did_mismatch"
  | "vm_not_found"
  | "vm_not_assertion_method"
  | "key_mismatch";

export type DidBindingResult =
  | { ok: true; verificationMethod: VerificationMethod }
  | { ok: false; reason: DidBindingReason; detail?: string };

/**
 * Given a fetched DID document and the public key that the VC proof
 * CLAIMED was used, decide whether that key is actually published
 * under the DID. This is the crucial "the named school really did
 * sign this" step that the verifier cannot perform by itself.
 *
 * Inputs:
 *   • `didDocument`  — the JSON served at the did:web URL.
 *   • `expectedDid`  — the issuer string from the VC (`credential.issuer`).
 *   • `verificationMethodId` — `credential.proof.verificationMethod`.
 *   • `embeddedPublicKeyB64url` — `credential.proof.publicKeyB64url`.
 *
 * On success returns the matching verification method. On failure
 * returns a discriminated reason.
 */
export async function verifyVerificationMethodBinding(input: {
  didDocument: DidDocument;
  expectedDid: string;
  verificationMethodId: string;
  embeddedPublicKeyB64url: string;
}): Promise<DidBindingResult> {
  if (input.didDocument.id !== input.expectedDid) {
    return {
      ok: false,
      reason: "did_mismatch",
      detail: `document id ${input.didDocument.id} ≠ issuer ${input.expectedDid}`,
    };
  }
  const vm = input.didDocument.verificationMethod.find(
    (m) => m.id === input.verificationMethodId,
  );
  if (!vm) return { ok: false, reason: "vm_not_found" };

  if (!input.didDocument.assertionMethod.includes(input.verificationMethodId)) {
    return { ok: false, reason: "vm_not_assertion_method" };
  }

  // Compare the JWK-derived SPKI with the embedded SPKI on the VC
  // proof. Bytewise equality is the strongest check; we re-derive the
  // SPKI from the JWK rather than trust `publicKeyBase64url` (which is
  // a convenience field that could drift).
  const canonicalSpki = await jwkToSpkiBase64Url(vm.publicKeyJwk);
  if (canonicalSpki !== input.embeddedPublicKeyB64url) {
    return {
      ok: false,
      reason: "key_mismatch",
      detail: "JWK in DID document does not match embedded SPKI on proof",
    };
  }
  return { ok: true, verificationMethod: vm };
}

// ─── base64url helpers (local, no cross-module dependency) ────────────────

function base64UrlToArrayBuffer(b64url: string): ArrayBuffer {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  const bin = atob(b64 + pad);
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return buf;
}

function arrayBufferToBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
