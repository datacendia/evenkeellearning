// ─────────────────────────────────────────────────────────────────────────────
// lib/lti/jwks.ts
//
// v1.8.4 — Thin re-export shim.
//
// The JWK/JWKS primitives once lived here, but they are fully generic
// and are now shared with `lib/district/oidc/*`. They live in
// `lib/jwt/jwks.ts`.
//
// This shim preserves all existing import paths, including the
// LTI-specific `SupportedLtiAlgorithm` alias.
// ─────────────────────────────────────────────────────────────────────────────

export {
  algForJwk,
  base64UrlToBytes,
  findJwkByKid,
  importParamsFor,
  importPublicJwk,
  toArrayBuffer,
  verifyParamsFor,
  type JsonWebKey,
  type JsonWebKeySet,
  type JwkImportFailure,
  type SupportedJwsAlgorithm,
} from "@/lib/jwt/jwks";

import type { SupportedJwsAlgorithm } from "@/lib/jwt/jwks";

/**
 * Historical LTI-flavoured alias for the generic JWS algorithm type.
 * New code should prefer `SupportedJwsAlgorithm` from `@/lib/jwt/jwks`.
 */
export type SupportedLtiAlgorithm = SupportedJwsAlgorithm;
