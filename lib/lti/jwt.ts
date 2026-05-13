// ─────────────────────────────────────────────────────────────────────────────
// lib/lti/jwt.ts
//
// v1.8.0 — Minimal JWS / compact-JWT verifier for LTI 1.3 launches.
//
// SCOPE
// ─────
// Decodes a compact-serialised JWT, looks up the signing key in a
// caller-supplied JWKS, and verifies the signature. Performs NO
// LTI-specific claim validation — that lives in `lib/lti/launch.ts`.
//
// EXPIRATION HANDLING
// ───────────────────
// We DO check `exp` (mandatory) and `nbf` / `iat` (when present) so a
// caller never sees a verified-but-expired token. Skew tolerance is
// 60 seconds — generous enough for typical NTP drift, tight enough
// that an expired token can't be replayed indefinitely.
//
// WHY NOT `jose`?
// ────────────────
// The same reason the rest of the platform avoids deps: small,
// auditable, no-runtime-LLM ethos. The verifier surface is ~80 lines
// of pure Web Crypto. We deliberately re-use the same `crypto.subtle`
// machinery the VC verifier already trusts.
// ─────────────────────────────────────────────────────────────────────────────

import { base64UrlToBytes, toArrayBuffer } from "@/lib/crypto/base64url";
import {
  algForJwk,
  findJwkByKid,
  importPublicJwk,
  verifyParamsFor,
  type JsonWebKeySet,
  type SupportedLtiAlgorithm,
} from "./jwks";

/** Stable result codes for `verifyJwt`. */
export type JwtVerificationReason =
  | "malformed_token"
  | "malformed_header"
  | "malformed_payload"
  | "unsupported_alg"
  | "unknown_kid"
  | "jwk_import_failed"
  | "bad_signature"
  | "expired"
  | "not_yet_valid"
  | "verify_threw";

export interface JwtHeader {
  alg: string;
  typ?: string;
  kid?: string;
  [k: string]: unknown;
}

export interface JwtPayload {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number; // seconds-since-epoch (JWT convention)
  iat?: number;
  nbf?: number;
  jti?: string;
  nonce?: string;
  azp?: string;
  [k: string]: unknown;
}

export type JwtVerificationResult =
  | { ok: true; header: JwtHeader; payload: JwtPayload }
  | { ok: false; reason: JwtVerificationReason; detail?: string };

/** Skew tolerance in seconds. */
export const JWT_SKEW_SECONDS = 60;

/**
 * Decode a compact-serialised JWT without verifying the signature.
 * USEFUL FOR INSPECTING THE HEADER ONLY — never trust the payload
 * returned here until `verifyJwt` has succeeded.
 */
export function decodeJwtUnsafe(
  token: string,
): { header: JwtHeader; payload: JwtPayload; signingInput: string; signatureB64url: string } | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header: JwtHeader;
  let payload: JwtPayload;
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[1])));
  } catch {
    return null;
  }
  return {
    header,
    payload,
    signingInput: parts[0] + "." + parts[1],
    signatureB64url: parts[2],
  };
}

/**
 * Verify a JWT against a JWKS. On success, returns the decoded header
 * and payload. On failure, returns a stable reason code.
 *
 * `nowSeconds` is injectable for tests; defaults to wall clock.
 */
export async function verifyJwt(
  token: string,
  jwks: JsonWebKeySet,
  opts: { nowSeconds?: number } = {},
): Promise<JwtVerificationResult> {
  const decoded = decodeJwtUnsafe(token);
  if (!decoded) return { ok: false, reason: "malformed_token" };
  const { header, payload, signingInput, signatureB64url } = decoded;

  if (!header || typeof header.alg !== "string") {
    return { ok: false, reason: "malformed_header" };
  }

  const alg = header.alg;
  if (
    alg !== "RS256" &&
    alg !== "RS384" &&
    alg !== "RS512" &&
    alg !== "ES256"
  ) {
    return { ok: false, reason: "unsupported_alg", detail: alg };
  }
  const supportedAlg = alg as SupportedLtiAlgorithm;

  const jwk = findJwkByKid(jwks, header.kid);
  if (!jwk) return { ok: false, reason: "unknown_kid", detail: header.kid };

  // Refuse if the JWK's stated algorithm disagrees with the header.
  const jwkAlg = algForJwk(jwk);
  if (jwkAlg && jwkAlg !== supportedAlg) {
    return { ok: false, reason: "unsupported_alg", detail: `header=${alg}, jwk=${jwkAlg}` };
  }

  const imp = await importPublicJwk(jwk);
  if (!imp.ok) {
    return { ok: false, reason: "jwk_import_failed", detail: imp.reason };
  }

  let signatureBytes: Uint8Array;
  try {
    signatureBytes = base64UrlToBytes(signatureB64url);
  } catch {
    return { ok: false, reason: "malformed_token" };
  }

  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      verifyParamsFor(supportedAlg),
      imp.key,
      toArrayBuffer(signatureBytes),
      toArrayBuffer(new TextEncoder().encode(signingInput)),
    );
  } catch {
    return { ok: false, reason: "verify_threw" };
  }
  if (!valid) return { ok: false, reason: "bad_signature" };

  // Time claims. Tolerate up to JWT_SKEW_SECONDS of clock skew.
  if (!payload || typeof payload !== "object") {
    return { ok: false, reason: "malformed_payload" };
  }
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp + JWT_SKEW_SECONDS < now) {
    return { ok: false, reason: "expired" };
  }
  if (typeof payload.nbf === "number" && payload.nbf - JWT_SKEW_SECONDS > now) {
    return { ok: false, reason: "not_yet_valid" };
  }
  if (typeof payload.iat === "number" && payload.iat - JWT_SKEW_SECONDS > now) {
    return { ok: false, reason: "not_yet_valid" };
  }

  return { ok: true, header, payload };
}
