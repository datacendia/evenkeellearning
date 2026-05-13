// ─────────────────────────────────────────────────────────────────────────────
// lib/district/oidc/index.ts
//
// v1.8.4 — Public surface of the district OIDC SSO module.
// Import from this barrel, not the individual files:
//
//   import {
//     generateCodeVerifier,
//     codeChallengeS256,
//     signOidcState, verifyOidcState,
//     buildAuthorizeUrl,
//     completeOidcCallback,
//     resolveOidcIdentity,
//   } from "@/lib/district/oidc";
//
// ─────────────────────────────────────────────────────────────────────────────

export {
  codeChallengeS256,
  generateCodeVerifier,
  isValidVerifier,
} from "./pkce";

export {
  buildClearOidcStateCookie,
  buildOidcStateCookie,
  OIDC_STATE_COOKIE_NAME,
  OIDC_STATE_TTL_MS,
  randomUrlSafe,
  signOidcState,
  verifyOidcState,
  type OidcStatePayload,
  type OidcStateVerifyResult,
} from "./state";

export {
  DEFAULT_DISCOVERY_CACHE_TTL_MS,
  fetchOidcDiscovery,
  resetDiscoveryCache,
  type OidcDiscoveryDocument,
  type OidcDiscoveryReason,
  type OidcDiscoveryResult,
} from "./discovery";

export {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  type BuildAuthorizeUrlInput,
  type ExchangeCodeInput,
  type OidcTokenExchangeReason,
  type OidcTokenExchangeResult,
  type OidcTokenResponse,
} from "./flow";

export {
  verifyOidcIdToken,
  type OidcIdTokenClaimReason,
  type OidcIdTokenVerifyFailure,
  type OidcIdTokenVerifyOptions,
  type OidcIdTokenVerifyResult,
  type OidcIdTokenVerifySuccess,
} from "./id-token";

export {
  completeOidcCallback,
  resolveOidcIdentity,
  type CompleteOidcCallbackArgs,
  type OidcCallbackFailure,
  type OidcCallbackResult,
  type OidcCallbackSuccess,
  type ResolveOidcIdentityArgs,
  type ResolveOidcIdentityResult,
} from "./callback";

export {
  effectiveScopes,
  type OidcProviderConfig,
} from "./provider";
