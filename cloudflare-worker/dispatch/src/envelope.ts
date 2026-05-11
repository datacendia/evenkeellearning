// ─────────────────────────────────────────────────────────────────────────────
// cloudflare-worker/dispatch/src/envelope.ts
//
// Minimal duplicate of the Ed25519/ECDSA-P256 envelope structural check
// and signature verification used by the main app. We re-implement here
// (rather than importing from the app) for three reasons:
//
//   1. Workers have a strict module-resolution graph. Pulling
//      `@/lib/crypto/signing` would drag the whole crypto-base64url
//      module tree in; the bundle would balloon and surface
//      surface-specific deps (browser-only things) that don't apply
//      in a Worker context.
//
//   2. The Worker should be auditable in isolation. A reviewer can
//      read these <120 lines and convince themselves the signature
//      check is correct without crossing repo boundaries.
//
//   3. The Worker's verify path is *defence in depth*. Even if a
//      future version of the browser app shipped a buggy signer, the
//      Worker would refuse forward.
// ─────────────────────────────────────────────────────────────────────────────

/** SubtleCrypto algorithm for the only signature scheme we currently
 *  forward — ECDSA P-256 with SHA-256. Matches lib/crypto/signing.ts. */
const SIGNING_ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;
const VERIFY_PARAMS = { name: "ECDSA", hash: { name: "SHA-256" } } as const;

export interface SignedEnvelopeLike {
  payload: unknown;
  contentDigestB64url: string;
  signatureB64url: string;
  publicKeyB64url: string;
  signedAtIso: string;
  algorithm: string;
  keyType: string;
}

/** Best-effort type guard. Refuses gross structural defects but does
 *  not enforce specific keyType / payload shape — those are checked
 *  separately by the allowlist and policy layers. */
export function isEnvelopeLike(x: unknown): x is SignedEnvelopeLike {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.payload === "object" &&
    typeof o.contentDigestB64url === "string" &&
    typeof o.signatureB64url === "string" &&
    typeof o.publicKeyB64url === "string" &&
    typeof o.signedAtIso === "string" &&
    typeof o.algorithm === "string" &&
    typeof o.keyType === "string"
  );
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function utf8Encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** Copy a Uint8Array into a fresh ArrayBuffer (NOT SharedArrayBuffer)
 *  so SubtleCrypto APIs accept it under strict TS lib types. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes));
  return new Uint8Array(buf);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/**
 * Verify a SignedEnvelope. Returns:
 *   { ok: true } on valid signature AND matching content digest
 *   { ok: false, reason } otherwise. `reason` is a stable identifier.
 */
export async function verifyEnvelope(
  env: SignedEnvelopeLike,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (env.algorithm !== "ECDSA-P256-SHA256") {
    return { ok: false, reason: "unsupported_algorithm" };
  }
  // Recompute the content digest from the payload and compare.
  const payloadBytes = utf8Encode(JSON.stringify(env.payload));
  const recomputedDigest = bytesToBase64Url(await sha256(payloadBytes));
  if (recomputedDigest !== env.contentDigestB64url) {
    return { ok: false, reason: "content_digest_mismatch" };
  }
  // Import the SPKI public key.
  let pubKey: CryptoKey;
  try {
    pubKey = await crypto.subtle.importKey(
      "spki",
      toArrayBuffer(base64UrlToBytes(env.publicKeyB64url)),
      SIGNING_ALGORITHM,
      true,
      ["verify"],
    );
  } catch {
    return { ok: false, reason: "bad_public_key" };
  }
  // Verify the signature over the UTF-8 bytes of the digest string
  // (matching what the app's signer does).
  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      VERIFY_PARAMS,
      pubKey,
      toArrayBuffer(base64UrlToBytes(env.signatureB64url)),
      toArrayBuffer(utf8Encode(env.contentDigestB64url)),
    );
  } catch {
    return { ok: false, reason: "verify_threw" };
  }
  if (!valid) return { ok: false, reason: "bad_signature" };
  // Strip-padding match: a base64url prefix passed in the issuer
  // allowlist will match a prefix of `publicKeyB64url`. The caller's
  // allowlist check (in policy.ts) is responsible for that comparison.
  return { ok: true };
}
