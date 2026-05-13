// ─────────────────────────────────────────────────────────────────────────────
// lib/district/oidc/id-token.ts
//
// v1.8.4 — OIDC ID-token verifier (signature + OIDC-specific claims).
//
// PURPOSE
// ───────
// Takes an ID token returned from an OIDC authorization-code flow and
// validates it according to OIDC Core 1.0 §3.1.3.7:
//
//   1. Signature — via `lib/jwt/jwt.verifyJwt` against the provider's JWKS.
//   2. `iss`     — MUST equal the configured issuer.
//   3. `aud`     — MUST contain the configured client_id.
//   4. `azp`     — if `aud` is an array, MUST equal client_id.
//   5. `exp`     — already checked by verifyJwt.
//   6. `iat`     — already checked; plus an optional max-age window.
//   7. `nonce`   — MUST equal the nonce we sealed into the state cookie.
//   8. `sub`     — MUST be present and non-empty.
//
// NOT COVERED HERE
// ────────────────
//   • `at_hash` — only relevant for implicit/hybrid flows we don't use.
//   • `acr` / `amr` — callers may inspect these on the raw payload if
//     they need them for step-up auth or audit.
//
// ─────────────────────────────────────────────────────────────────────────────

import type { JsonWebKeySet } from "@/lib/jwt/jwks";
import {
  JWT_SKEW_SECONDS,
  verifyJwt,
  type JwtPayload,
  type JwtVerificationReason,
} from "@/lib/jwt/jwt";

/** OIDC-specific claim failure reasons. */
export type OidcIdTokenClaimReason =
  | "iss_mismatch"
  | "aud_missing_client"
  | "azp_mismatch"
  | "nonce_missing"
  | "nonce_mismatch"
  | "sub_missing"
  | "iat_too_old";

export type OidcIdTokenVerifyFailure =
  | { ok: false; stage: "signature"; reason: JwtVerificationReason; detail?: string }
  | { ok: false; stage: "claims"; reason: OidcIdTokenClaimReason; detail?: string };

export interface OidcIdTokenVerifySuccess {
  ok: true;
  /** The raw verified payload. */
  payload: JwtPayload;
  /** Normalised, always-present claims. */
  sub: string;
  iss: string;
  aud: string[];
  email?: string;
  emailVerified?: boolean;
  name?: string;
  givenName?: string;
  familyName?: string;
  picture?: string;
  locale?: string;
}

export type OidcIdTokenVerifyResult =
  | OidcIdTokenVerifySuccess
  | OidcIdTokenVerifyFailure;

export interface OidcIdTokenVerifyOptions {
  /** OIDC provider issuer (e.g. "https://accounts.google.com"). */
  expectedIss: string;
  /** Our client_id registered with the provider. */
  expectedAud: string;
  /**
   * The nonce we originally minted and sealed into the state cookie.
   * Must equal `payload.nonce`.
   */
  expectedNonce: string;
  /**
   * Optional: maximum age of the token in seconds (relative to `iat`).
   * If omitted, only the JWT `exp` check applies. Useful to enforce
   * that the user authenticated recently.
   */
  maxAgeSeconds?: number;
  /** For deterministic tests. */
  nowSeconds?: number;
}

/**
 * Verify an ID token end-to-end.
 */
export async function verifyOidcIdToken(
  token: string,
  jwks: JsonWebKeySet,
  opts: OidcIdTokenVerifyOptions,
): Promise<OidcIdTokenVerifyResult> {
  const sig = await verifyJwt(token, jwks, { nowSeconds: opts.nowSeconds });
  if (!sig.ok) {
    return { ok: false, stage: "signature", reason: sig.reason, detail: sig.detail };
  }

  const p = sig.payload;

  // --- iss ---------------------------------------------------------------
  if (typeof p.iss !== "string" || p.iss !== opts.expectedIss) {
    return {
      ok: false,
      stage: "claims",
      reason: "iss_mismatch",
      detail: `expected=${opts.expectedIss} got=${String(p.iss)}`,
    };
  }

  // --- aud ---------------------------------------------------------------
  const audArray: string[] = Array.isArray(p.aud)
    ? p.aud.filter((x): x is string => typeof x === "string")
    : typeof p.aud === "string"
      ? [p.aud]
      : [];
  if (!audArray.includes(opts.expectedAud)) {
    return {
      ok: false,
      stage: "claims",
      reason: "aud_missing_client",
      detail: `expected=${opts.expectedAud} got=${JSON.stringify(p.aud)}`,
    };
  }

  // --- azp (required when aud is multi-valued) ---------------------------
  if (audArray.length > 1) {
    if (typeof p.azp !== "string" || p.azp !== opts.expectedAud) {
      return {
        ok: false,
        stage: "claims",
        reason: "azp_mismatch",
        detail: `expected=${opts.expectedAud} got=${String(p.azp)}`,
      };
    }
  }

  // --- nonce -------------------------------------------------------------
  if (typeof p.nonce !== "string" || p.nonce.length === 0) {
    return { ok: false, stage: "claims", reason: "nonce_missing" };
  }
  if (p.nonce !== opts.expectedNonce) {
    return { ok: false, stage: "claims", reason: "nonce_mismatch" };
  }

  // --- sub ---------------------------------------------------------------
  if (typeof p.sub !== "string" || p.sub.length === 0) {
    return { ok: false, stage: "claims", reason: "sub_missing" };
  }

  // --- max_age -----------------------------------------------------------
  if (typeof opts.maxAgeSeconds === "number") {
    const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
    const iat = typeof p.iat === "number" ? p.iat : null;
    if (iat === null) {
      return { ok: false, stage: "claims", reason: "iat_too_old", detail: "iat missing" };
    }
    if (iat + opts.maxAgeSeconds + JWT_SKEW_SECONDS < now) {
      return {
        ok: false,
        stage: "claims",
        reason: "iat_too_old",
        detail: `iat=${iat} max_age=${opts.maxAgeSeconds}`,
      };
    }
  }

  // All checks passed. Project the commonly used profile claims.
  return {
    ok: true,
    payload: p,
    sub: p.sub,
    iss: p.iss,
    aud: audArray,
    email: typeof p.email === "string" ? p.email : undefined,
    emailVerified:
      typeof p.email_verified === "boolean" ? p.email_verified : undefined,
    name: typeof p.name === "string" ? p.name : undefined,
    givenName: typeof p.given_name === "string" ? p.given_name : undefined,
    familyName: typeof p.family_name === "string" ? p.family_name : undefined,
    picture: typeof p.picture === "string" ? p.picture : undefined,
    locale: typeof p.locale === "string" ? p.locale : undefined,
  };
}
