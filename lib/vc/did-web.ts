// ─────────────────────────────────────────────────────────────────────────────
// lib/vc/did-web.ts
//
// v1.7.3 — did:web issuer identity (vc4-did).
//
// What this module does
// ─────────────────────
// Pure helpers + a default resolver for the did:web method:
//   • didWebToHttpsUrl   — convert "did:web:foo.example:user:alice" →
//                           "https://foo.example/user/alice/did.json".
//                           Honours the spec's port encoding rule
//                           (`%3A` → `:`).
//   • buildDidWebDocument — emit a minimal but spec-compliant W3C DID
//                            Core document with a single
//                            `JsonWebKey2020` verification method, listed
//                            in `assertionMethod` and `authentication`.
//   • extractAssertionPublicKey — find the JWK referenced by a fully
//                                 qualified `verificationMethod` id like
//                                 `did:web:foo.example#key-1`.
//   • spkiBase64UrlToJwk — convert one of our existing SPKI base64url
//                          ECDSA-P256 public keys to a JsonWebKey via
//                          `crypto.subtle.importKey` + `exportKey`. No
//                          manual DER parsing.
//   • jwkToSpkiBase64Url — the inverse, useful when a verifier wants to
//                           compare a resolved DID-doc key against the
//                           embedded `publicKeyB64url` byte-for-byte.
//   • defaultDidWebResolver — `fetch()` the URL and `JSON.parse` the
//                              response. Throws on non-200 or malformed
//                              JSON. Browsers and Node 18+ both have
//                              global fetch; no dep.
//
// What this module does NOT do
// ────────────────────────────
//   • did:web with `did-configuration` linked-data proofs (extra scope).
//   • Caching of resolved documents (left to the caller — a verifier
//     web app can wrap the resolver in a 5-minute LRU).
//   • Other DID methods (key, ion, ebsi, …). Each method has its own
//     URL/registry mechanics; adding them here would make this module
//     a method router, not a did:web client.
//
// Spec reference
// ──────────────
//   https://w3c-ccg.github.io/did-method-web/
// ─────────────────────────────────────────────────────────────────────────────

// ─── DID document types ────────────────────────────────────────────────────

export interface DidVerificationMethod {
  id: string;
  type: "JsonWebKey2020";
  controller: string;
  publicKeyJwk: JsonWebKey;
}

export interface DidDocument {
  "@context": [string, ...string[]];
  id: string;
  verificationMethod: DidVerificationMethod[];
  /** IDs (or inline VMs) usable for VC proofs. */
  assertionMethod: string[];
  /** IDs (or inline VMs) usable for authentication. */
  authentication: string[];
}

export const DID_CORE_CONTEXT = "https://www.w3.org/ns/did/v1" as const;
export const JWS_2020_CONTEXT = "https://w3id.org/security/suites/jws-2020/v1" as const;
export const DID_CONTEXT_V1 = DID_CORE_CONTEXT;

// ─── URL conversion (sync, pure) ───────────────────────────────────────────

/**
 * Convert a `did:web` identifier to the HTTPS URL of its DID document.
 *
 * Rules (per spec):
 *   • `did:web:example.com`            → https://example.com/.well-known/did.json
 *   • `did:web:example.com:user:alice` → https://example.com/user/alice/did.json
 *   • Each `:` after the domain becomes a `/`.
 *   • Percent-encoded `%3A` (in the host segment) decodes to `:`
 *     so a non-default port can survive the encoding.
 *   • The host segment (before any path `:`) is the only place a port is
 *     allowed; we don't try to "find" a port elsewhere.
 *
 * Throws on malformed input — never returns a half-valid URL.
 */
export function didWebToHttpsUrl(did: string): string {
  if (typeof did !== "string" || did.length === 0) {
    throw new Error("did_web_invalid: empty");
  }
  if (!did.startsWith("did:web:")) {
    throw new Error("did_web_invalid: must start with did:web:");
  }
  const tail = did.slice("did:web:".length);
  if (tail.length === 0) {
    throw new Error("did_web_invalid: missing host");
  }
  const parts = tail.split(":");
  // First segment is the host (with optional %3A-encoded port).
  const host = decodeURIComponent(parts[0]!);
  if (host.length === 0 || host.includes("/") || host.includes("?")) {
    throw new Error("did_web_invalid: bad host segment");
  }
  const pathSegments = parts.slice(1).map((s) => decodeURIComponent(s));
  for (const s of pathSegments) {
    if (s.length === 0) {
      throw new Error("did_web_invalid: empty path segment");
    }
    if (s.includes("/") || s.includes("?") || s.includes("#")) {
      throw new Error("did_web_invalid: forbidden char in path segment");
    }
  }
  if (pathSegments.length === 0) {
    return `https://${host}/.well-known/did.json`;
  }
  return `https://${host}/${pathSegments.join("/")}/did.json`;
}

export function resolveDidWebUrl(did: string): string {
  if (!did.startsWith("did:web:")) {
    throw new Error("not_did_web");
  }
  if (did === "did:web:") {
    throw new Error("empty_did_identifier");
  }
  return didWebToHttpsUrl(did);
}

// ─── Builder (sync, pure) ──────────────────────────────────────────────────

export interface BuildDidDocumentInput {
  /** Full did:web identifier, e.g. `did:web:issuer.example`. */
  did: string;
  /** Verification-method fragment without leading `#`. Default `key-1`. */
  fragment?: string;
  /** Public key as a JWK. Use `spkiBase64UrlToJwk` to convert. */
  publicKeyJwk: JsonWebKey;
}

export function buildDidWebDocument(input: BuildDidDocumentInput): DidDocument {
  const fragment = input.fragment ?? "key-1";
  if (!input.did.startsWith("did:web:")) {
    throw new Error("did must start with did:web:");
  }
  if (!input.publicKeyJwk || typeof input.publicKeyJwk !== "object") {
    throw new Error("publicKeyJwk required");
  }
  if (fragment.includes("#") || fragment.includes("/")) {
    throw new Error("fragment must not contain # or /");
  }
  const vmId = `${input.did}#${fragment}`;
  const vm: DidVerificationMethod = {
    id: vmId,
    type: "JsonWebKey2020",
    controller: input.did,
    publicKeyJwk: input.publicKeyJwk,
  };
  return {
    "@context": [DID_CORE_CONTEXT, JWS_2020_CONTEXT],
    id: input.did,
    verificationMethod: [vm],
    assertionMethod: [vmId],
    authentication: [vmId],
  };
}

export interface BuildDidDocumentBatchInput {
  did: string;
  keys: Array<{
    fragmentId: string;
    publicKeyB64url: string;
  }>;
}

export async function buildDidDocument(
  input: BuildDidDocumentBatchInput,
): Promise<DidDocument> {
  if (!input.did.startsWith("did:web:")) {
    throw new Error("not_did_web");
  }
  if (input.keys.length === 0) {
    throw new Error("no_keys");
  }
  const verificationMethod: DidVerificationMethod[] = [];
  const assertionMethod: string[] = [];
  for (const key of input.keys) {
    const vmId = `${input.did}#${key.fragmentId}`;
    const jwk = await spkiBase64UrlToJwk(key.publicKeyB64url);
    const jwkWithMeta = {
      ...jwk,
      kid: key.fragmentId,
      alg: "ES256",
      use: "sig",
    } as JsonWebKey;
    verificationMethod.push({
      id: vmId,
      type: "JsonWebKey2020",
      controller: input.did,
      publicKeyJwk: jwkWithMeta,
    });
    assertionMethod.push(vmId);
  }
  return {
    "@context": [DID_CONTEXT_V1, JWS_2020_CONTEXT],
    id: input.did,
    verificationMethod,
    assertionMethod,
    authentication: assertionMethod,
  };
}

// ─── Lookup (sync, pure) ───────────────────────────────────────────────────

/**
 * Find the verification method referenced by a fully-qualified id.
 * Returns null if not found. Does not follow `assertionMethod` indirection
 * to other DIDs — caller can check `assertionMethod` themselves to enforce
 * that the VM is allowed for VC proofs.
 */
export function findVerificationMethod(
  doc: DidDocument,
  vmId: string,
): DidVerificationMethod | null {
  if (!doc || !Array.isArray(doc.verificationMethod)) return null;
  for (const vm of doc.verificationMethod) {
    if (vm.id === vmId) return vm;
  }
  return null;
}

/**
 * Convenience: returns the verification method's JWK if it is also
 * listed in `assertionMethod` (the only purpose VC proofs may use).
 * Returns null if the VM is missing or not in assertionMethod.
 */
export function extractAssertionPublicKey(
  doc: DidDocument,
  vmId: string,
): JsonWebKey | null {
  const vm = findVerificationMethod(doc, vmId);
  if (!vm) return null;
  if (!Array.isArray(doc.assertionMethod) || !doc.assertionMethod.includes(vmId)) {
    return null;
  }
  return vm.publicKeyJwk;
}

export type DidBindingReason =
  | "did_mismatch"
  | "vm_not_found"
  | "vm_not_assertion_method"
  | "key_mismatch";

export type DidBindingResult =
  | { ok: true; verificationMethod: DidVerificationMethod }
  | { ok: false; reason: DidBindingReason; detail?: string };

export async function verifyVerificationMethodBinding(input: {
  didDocument: DidDocument;
  expectedDid: string;
  verificationMethodId: string;
  embeddedPublicKeyB64url: string;
}): Promise<DidBindingResult> {
  if (input.didDocument.id !== input.expectedDid) {
    return { ok: false, reason: "did_mismatch" };
  }
  const vm = findVerificationMethod(input.didDocument, input.verificationMethodId);
  if (!vm) {
    return { ok: false, reason: "vm_not_found" };
  }
  if (!input.didDocument.assertionMethod.includes(input.verificationMethodId)) {
    return { ok: false, reason: "vm_not_assertion_method" };
  }
  const canonicalSpki = await jwkToSpkiBase64Url(vm.publicKeyJwk);
  if (canonicalSpki !== input.embeddedPublicKeyB64url) {
    return { ok: false, reason: "key_mismatch" };
  }
  return { ok: true, verificationMethod: vm };
}

// ─── Key-format conversion (async) ─────────────────────────────────────────

const ECDSA_P256 = { name: "ECDSA", namedCurve: "P-256" } as const;

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
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}

/**
 * Convert one of our existing SPKI-base64url ECDSA-P256 public keys
 * (the form that lives on every signed envelope and credential proof)
 * to a JsonWebKey suitable for embedding in a DID document.
 *
 * Uses `crypto.subtle.importKey('spki') → exportKey('jwk')` so we
 * inherit Web Crypto's DER parsing — no manual ASN.1.
 */
export async function spkiBase64UrlToJwk(b64url: string): Promise<JsonWebKey> {
  const spki = base64UrlToBytes(b64url);
  const key = await crypto.subtle.importKey(
    "spki",
    toArrayBuffer(spki),
    ECDSA_P256,
    true,
    ["verify"],
  );
  return crypto.subtle.exportKey("jwk", key);
}

/**
 * Inverse: convert a JWK back to SPKI base64url so a verifier can
 * compare a DID-doc-resolved key against the proof's embedded
 * `publicKeyB64url` byte-for-byte. A mismatch is a strong signal that
 * the credential's claimed issuer DID does not actually control the key
 * that signed it.
 */
export async function jwkToSpkiBase64Url(jwk: JsonWebKey): Promise<string> {
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    ECDSA_P256,
    true,
    ["verify"],
  );
  const spki = await crypto.subtle.exportKey("spki", key);
  return bytesToBase64Url(new Uint8Array(spki));
}

// ─── Resolver (async) ──────────────────────────────────────────────────────

export type DidWebResolver = (did: string) => Promise<DidDocument>;

/**
 * Default resolver: derive the URL, fetch over HTTPS, JSON-parse,
 * structural sanity check. No caching. Callers that want LRU caching can
 * wrap this in their own resolver.
 *
 * Throws on:
 *   • Malformed did
 *   • Network failure
 *   • Non-2xx HTTP status
 *   • Non-JSON body
 *   • Body whose `id` field does not match the requested DID
 *     (defends against a server that returns a different DID's doc).
 */
export async function defaultDidWebResolver(did: string): Promise<DidDocument> {
  const url = didWebToHttpsUrl(did);
  let resp: Response;
  try {
    resp = await fetch(url, { headers: { Accept: "application/json" } });
  } catch (e) {
    throw new Error(
      `did_web_fetch_failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!resp.ok) {
    throw new Error(`did_web_http_${resp.status}`);
  }
  let body: unknown;
  try {
    body = await resp.json();
  } catch {
    throw new Error("did_web_bad_json");
  }
  if (!body || typeof body !== "object") {
    throw new Error("did_web_bad_doc");
  }
  const doc = body as Record<string, unknown>;
  if (doc.id !== did) {
    throw new Error("did_web_id_mismatch");
  }
  if (!Array.isArray(doc.verificationMethod)) {
    throw new Error("did_web_bad_doc");
  }
  if (!Array.isArray(doc.assertionMethod)) {
    throw new Error("did_web_bad_doc");
  }
  // We don't fully validate every VM here — `extractAssertionPublicKey`
  // does the look-up and the verifier is the one that imports the JWK,
  // which is its own validation step.
  return body as DidDocument;
}
