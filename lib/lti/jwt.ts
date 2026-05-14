// ─────────────────────────────────────────────────────────────────────────────
// lib/lti/jwt.ts
//
// v1.8.4 — Thin re-export shim.
//
// The compact-JWT verifier once lived here, but it is fully generic
// and is now shared with `lib/district/oidc/*`. It lives in
// `lib/jwt/jwt.ts`.
// ─────────────────────────────────────────────────────────────────────────────

export {
  decodeJwtUnsafe,
  JWT_SKEW_SECONDS,
  verifyJwt,
  type JwtHeader,
  type JwtPayload,
  type JwtVerificationReason,
  type JwtVerificationResult,
} from "@/lib/jwt/jwt";
