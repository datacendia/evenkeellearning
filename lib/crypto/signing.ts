// ─────────────────────────────────────────────────────────────────────────────
// lib/crypto/signing.ts
//
// Real, browser-native ECDSA P-256 sign/verify using the Web Crypto API
// (window.crypto.subtle). This is what backs the "Sign Verto Warrant" demo
// on the compliance surface and the cryptographic signature shown on a
// finalised Cognitive Reasoning Trace.
//
// HONESTY
// ───────
// • The key pair is generated per session and stored in module scope (memory).
//   It is not persisted to IndexedDB and is not tied to any user account, so
//   a signature produced on one page load cannot be verified against a key
//   produced on another page load unless you explicitly export and pass the
//   public key around.
// • We use ECDSA P-256 (SHA-256) because it is universally supported in
//   SubtleCrypto across Chromium, Firefox and Safari. Ed25519 would be more
//   modern but is not yet available in every browser's SubtleCrypto.
// • Signatures are returned as raw IEEE-P1363 byte arrays, then base64url-
//   encoded for display and transport. Decoding follows the inverse path.
// • The functions below are pure; callers supply the keys. The default
//   `getSessionKeyPair()` provides a lazy-initialised session key as a
//   convenience for demo code paths.
//
// PRODUCTION REPLACEMENT
// ──────────────────────
// In production, replace `getSessionKeyPair()` with a call to the
// authenticated user's server-held key (or a platform passkey-derived key)
// and persist the public key alongside the user record.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The algorithm parameters that both `sign` and `verify` must agree on.
 * Exported so tests and consumers can assert compatibility.
 */
export const SIGNING_ALGORITHM = {
  name: "ECDSA",
  namedCurve: "P-256",
  hash: "SHA-256",
} as const;

/**
 * What kind of key produced the signature. Surfaced in the verifier UI
 * so a viewer can tell at a glance how strong the identity-binding is.
 *
 *   • "session-demo"        — per-tab in-memory key (default; v1.4.6 path)
 *   • "passkey-derived"     — WebAuthn passkey on the signer's device (v1.4.11)
 *   • "ephemeral-build-time" — one-shot key for the transparency bundle (v1.4.9)
 *
 * Field is optional for backwards compatibility with v1.4.10 envelopes,
 * which omit it and are interpreted as "session-demo".
 */
export type SignedEnvelopeKeyType =
  | "session-demo"
  | "passkey-derived"
  | "ephemeral-build-time";

/**
 * WebAuthn assertion fields. Present iff `keyType === "passkey-derived"`.
 * Re-exported from `lib/crypto/passkey.ts` so callers don't have to
 * import both modules.
 */
export type { WebauthnAttestation } from "./passkey";

/**
 * Opaque shape returned by `signPayload`. Safe to serialise to JSON and show
 * in a UI. `signatureB64url` is the raw ECDSA r||s bytes in base64url form.
 */
export interface SignedEnvelope<T> {
  /** The original payload, unchanged. */
  payload: T;
  /** base64url(SHA-256(JSON.stringify(payload))). Deterministic. */
  contentDigestB64url: string;
  /** base64url of the raw ECDSA signature over `contentDigestB64url`. */
  signatureB64url: string;
  /** SPKI-exported public key in base64url form; the verifier needs this. */
  publicKeyB64url: string;
  /** ISO-8601 timestamp at signing time. */
  signedAtIso: string;
  /** Human-readable algorithm label for display. */
  algorithm: "ECDSA-P256-SHA256";
  /** Provenance of the signing key. Optional for back-compat. */
  keyType?: SignedEnvelopeKeyType;
  /** WebAuthn assertion data; present iff `keyType === "passkey-derived"`. */
  webauthn?: import("./passkey").WebauthnAttestation;
}

// ─── Base64URL helpers ───────────────────────────────────────────────────────
// These avoid Node `Buffer`; they work in every modern browser.

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = typeof btoa !== "undefined" ? btoa(binary) : Buffer.from(binary, "binary").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(input: string): Uint8Array {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const b64 = (input + pad).replace(/-/g, "+").replace(/_/g, "/");
  const binary = typeof atob !== "undefined" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function utf8Encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/**
 * Returns an `ArrayBuffer` (not `SharedArrayBuffer`) copy of the given bytes.
 *
 * TypeScript 5.7 narrowed SubtleCrypto's `BufferSource` parameter to reject
 * `Uint8Array<ArrayBufferLike>` (the default produced by `TextEncoder.encode()`),
 * because `ArrayBufferLike` could in principle be a `SharedArrayBuffer` and
 * SubtleCrypto rejects those at runtime. We copy the bytes into a fresh
 * ArrayBuffer so the resulting type is unambiguously `ArrayBuffer`.
 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy.buffer;
}

// ─── SubtleCrypto accessor ───────────────────────────────────────────────────

/**
 * Returns the browser's SubtleCrypto, throwing a helpful error if the
 * environment is not a browser (e.g. during Next.js server rendering).
 * Call this inside effect hooks or event handlers, never at module import.
 */
function subtle(): SubtleCrypto {
  if (typeof window === "undefined" || !window.crypto?.subtle) {
    throw new Error(
      "SubtleCrypto is unavailable. lib/crypto/signing.ts is browser-only; " +
      "call it from a client component after mount."
    );
  }
  return window.crypto.subtle;
}

// ─── Session key cache ───────────────────────────────────────────────────────

let cachedSessionKey: Promise<CryptoKeyPair> | null = null;

/**
 * Lazily generates a fresh ECDSA P-256 key pair and caches it for the lifetime
 * of the current browser tab. Subsequent calls return the same promise.
 *
 * This is a *session-demo* key: it is deliberately not persisted so that the
 * UI can honestly label signatures as "session-demo key, not linked to an
 * account." When you wire a real auth system, replace this accessor with one
 * that returns the user's long-lived key.
 */
export function getSessionKeyPair(): Promise<CryptoKeyPair> {
  if (!cachedSessionKey) {
    cachedSessionKey = subtle().generateKey(SIGNING_ALGORITHM, true, ["sign", "verify"]);
  }
  return cachedSessionKey;
}

/** Reset the cached session key (e.g. on sign-out). Primarily for tests. */
export function resetSessionKeyPair(): void {
  cachedSessionKey = null;
}

// ─── Core primitives ─────────────────────────────────────────────────────────

/**
 * Computes a deterministic base64url SHA-256 digest of an arbitrary JSON
 * payload. This is the bytes that are actually signed — we sign the digest,
 * not the full payload, so large CRTs don't bloat the signature bytes.
 */
export async function contentDigest(payload: unknown): Promise<string> {
  const bytes = utf8Encode(JSON.stringify(payload));
  const digest = await subtle().digest("SHA-256", toArrayBuffer(bytes));
  return bytesToBase64Url(new Uint8Array(digest));
}

/**
 * Exports a CryptoKey as base64url SPKI. Used so the public key can be
 * transported alongside the signature.
 */
export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const spki = await subtle().exportKey("spki", key);
  return bytesToBase64Url(new Uint8Array(spki));
}

/**
 * Imports a base64url SPKI public key back into a CryptoKey suitable for
 * `verify`. Used by the verifier side of a signed envelope.
 */
export async function importPublicKey(spkiB64url: string): Promise<CryptoKey> {
  const bytes = base64UrlToBytes(spkiB64url);
  return subtle().importKey("spki", toArrayBuffer(bytes), SIGNING_ALGORITHM, true, ["verify"]);
}

/**
 * Optional flag controlling which key signs the payload.
 *
 *   • Omitted / `keySource: "session"` — default. Uses the per-tab
 *     session key. Behaviour is identical to v1.4.10 and earlier; every
 *     existing call site continues to work unchanged.
 *   • `keySource: "passkey"` — requires a passkey to have been enrolled
 *     via `lib/crypto/passkey.ts.enrolPasskey()`. Runs a WebAuthn
 *     assertion ceremony (the OS prompts the user). On success, the
 *     returned envelope carries `keyType: "passkey-derived"` and the
 *     `webauthn` attestation block. On user cancel / browser
 *     unsupported / no enrolment, throws a typed `PasskeyError` —
 *     callers MUST handle that, no silent fallback.
 */
export type SignKeySource =
  | { keySource: "session"; keyPair?: CryptoKeyPair }
  | { keySource: "passkey" };

/**
 * Auto-detects passkey enrolment and prefers passkey signing with graceful
 * fallback to the session key. This is the "smart" entry point for CRT
 * envelope signing in v1.5.4 follow-up.
 *
 * Behaviour:
 *   • If a passkey is enrolled (via `lib/crypto/passkey.ts.enrolPasskey()`),
 *     attempts passkey signing first. On success, returns a
 *     `keyType: "passkey-derived"` envelope.
 *   • If passkey signing fails (user cancel, browser unsupported, no enrolment,
 *     ceremony error), silently falls back to the session key and returns a
 *     `keyType: "session-demo"` envelope. The learner flow is never blocked.
 *   • If no passkey is enrolled, uses the session key directly.
 *
 * This is distinct from the explicit `{ keySource: "passkey" }` path, which
 * throws on failure and requires caller-side error handling. Use this helper
 * for CRT envelopes where the goal is "use passkey if available, otherwise
 * use session key" without blocking the learner.
 */
export async function signPayloadWithAutoPasskey<T>(
  payload: T,
): Promise<SignedEnvelope<T>> {
  // Lazy-import passkey module to avoid pulling it into code paths that
  // never need it (e.g. SSR build).
  try {
    const { getEnrolment } = await import("./passkey");
    const enrolment = getEnrolment();
    if (enrolment) {
      try {
        return await signPayload(payload, { keySource: "passkey" });
      } catch {
        // Passkey signing failed (user cancel, unsupported, ceremony error).
        // Fall back to session key silently.
      }
    }
  } catch {
    // Passkey module unavailable or getEnrolment threw. Fall back to session key.
  }
  // Default to session key.
  return signPayload(payload, { keySource: "session" });
}

/**
 * Signs `payload` with the supplied private key (or the session key if none
 * is given) and returns a fully serialisable envelope that can be stored,
 * displayed in the UI, and verified later by any holder of the public key.
 *
 * Two call shapes are supported, both type-safe:
 *
 * ```ts
 * // Default: session key (back-compat with all v1.4.10 callers)
 * const env = await signPayload({ studentId: "alex" });
 *
 * // Pass a CryptoKeyPair directly (used by the build-time transparency bundle)
 * const env = await signPayload({ ... }, kp);
 *
 * // Opt in to passkey signing (v1.4.11+)
 * const env = await signPayload({ ... }, { keySource: "passkey" });
 * ```
 */
export async function signPayload<T>(
  payload: T,
  keyPairOrSource?: CryptoKeyPair | SignKeySource
): Promise<SignedEnvelope<T>> {
  // Branch (a): explicit passkey request — delegate fully.
  if (
    keyPairOrSource &&
    typeof keyPairOrSource === "object" &&
    "keySource" in keyPairOrSource &&
    keyPairOrSource.keySource === "passkey"
  ) {
    // Lazy-require to keep `lib/crypto/passkey.ts` out of any code path
    // that doesn't ask for it (notably the SSR-rendered transparency
    // bundle build).
    const { signPayloadWithPasskey } = await import("./passkey");
    const result = await signPayloadWithPasskey(payload);
    return {
      payload: result.payload,
      contentDigestB64url: result.contentDigestB64url,
      signatureB64url: result.signatureB64url,
      publicKeyB64url: result.publicKeyB64url,
      signedAtIso: new Date().toISOString(),
      algorithm: "ECDSA-P256-SHA256",
      keyType: "passkey-derived",
      webauthn: result.webauthn,
    };
  }

  // Branch (b): default — session-key (or caller-supplied keypair).
  const kp =
    (keyPairOrSource && "keySource" in keyPairOrSource
      ? keyPairOrSource.keyPair
      : (keyPairOrSource as CryptoKeyPair | undefined)) ??
    (await getSessionKeyPair());
  const digest = await contentDigest(payload);
  const sig = await subtle().sign(
    SIGNING_ALGORITHM,
    kp.privateKey,
    toArrayBuffer(utf8Encode(digest))
  );
  const publicKeyB64url = await exportPublicKey(kp.publicKey);
  return {
    payload,
    contentDigestB64url: digest,
    signatureB64url: bytesToBase64Url(new Uint8Array(sig)),
    publicKeyB64url,
    signedAtIso: new Date().toISOString(),
    algorithm: "ECDSA-P256-SHA256",
    keyType: "session-demo",
  };
}

/**
 * Verifies a `SignedEnvelope<T>` end-to-end: re-derives the digest from
 * `payload`, imports the stated public key, and runs ECDSA verify. Returns
 * `true` only if every check passes. Returns `false` on tampering or on
 * any algorithmic mismatch — never throws for invalid signatures; only
 * throws if SubtleCrypto itself is unavailable.
 */
export async function verifyEnvelope<T>(
  envelope: SignedEnvelope<T>
): Promise<boolean> {
  try {
    // Branch on the presence of WebAuthn fields. A passkey-signed
    // envelope cannot be verified by the legacy `sig over digestB64url
    // utf8 bytes` path because WebAuthn signs `authenticatorData ||
    // SHA-256(clientDataJSON)`, not the digest directly.
    if (envelope.webauthn) {
      const { verifyPasskeyEnvelope } = await import("./passkey");
      return await verifyPasskeyEnvelope({
        payload: envelope.payload,
        contentDigestB64url: envelope.contentDigestB64url,
        signatureB64url: envelope.signatureB64url,
        publicKeyB64url: envelope.publicKeyB64url,
        webauthn: envelope.webauthn,
      });
    }
    const recomputedDigest = await contentDigest(envelope.payload);
    if (recomputedDigest !== envelope.contentDigestB64url) return false;
    const publicKey = await importPublicKey(envelope.publicKeyB64url);
    const sigBytes = base64UrlToBytes(envelope.signatureB64url);
    const ok = await subtle().verify(
      SIGNING_ALGORITHM,
      publicKey,
      toArrayBuffer(sigBytes),
      toArrayBuffer(utf8Encode(envelope.contentDigestB64url))
    );
    return ok;
  } catch {
    return false;
  }
}

/**
 * Convenience helper: returns a short (12-char) prefix of a signature, useful
 * for dense UI displays like the compliance ledger rows.
 */
export function shortSignature(envelope: SignedEnvelope<unknown>): string {
  return envelope.signatureB64url.slice(0, 12) + "…";
}
