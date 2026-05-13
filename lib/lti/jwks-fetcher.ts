// ─────────────────────────────────────────────────────────────────────────────
// lib/lti/jwks-fetcher.ts
//
// v1.8.4 — Thin re-export shim.
//
// The TTL-cached JWKS fetcher once lived here, but it is fully generic
// and is now shared with `lib/district/oidc/*`. It lives in
// `lib/jwt/jwks-fetcher.ts`.
// ─────────────────────────────────────────────────────────────────────────────

export {
  DEFAULT_JWKS_CACHE_TTL_MS,
  fetchJwks,
  isAcceptableJwksUrl,
  resetJwksCache,
  type JwksFetchReason,
  type JwksFetchResult,
} from "@/lib/jwt/jwks-fetcher";
