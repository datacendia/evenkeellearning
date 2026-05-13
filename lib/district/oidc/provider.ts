// ─────────────────────────────────────────────────────────────────────────────
// lib/district/oidc/provider.ts
//
// v1.8.4 — Per-tenant OIDC provider configuration shape.
//
// An `OidcProviderConfig` is everything we need to run an OIDC
// authorization-code flow against a specific provider for a specific
// tenant. It is stored (in a real deployment) in an encrypted per-tenant
// secret store alongside SAML metadata etc.; the store interface will
// be threaded through as part of sub-pass D.
//
// Endpoints are OPTIONAL in the config — if omitted we discover them
// from `${issuer}/.well-known/openid-configuration`. Pinning them by
// hand is useful for
//
//   • air-gapped tests
//   • providers that lie in their discovery document (rare but real)
//   • temporarily overriding a broken upstream
//
// The id/label fields feed the tenant admin console and the user-facing
// login page ("Continue with Google").
// ─────────────────────────────────────────────────────────────────────────────

export interface OidcProviderConfig {
  /** Stable slug, e.g. "google", "azure-ad", "okta". Case-sensitive. */
  id: string;
  /** Human-readable label for admin + login UI. */
  label: string;
  /** OIDC issuer URL (e.g. "https://accounts.google.com"). MUST match `iss`. */
  issuer: string;
  /** Our registered client_id with the provider. */
  clientId: string;
  /** Our client_secret with the provider. Optional for public-client flows
   *  (PKCE-only, no secret). Stored encrypted at rest. */
  clientSecret?: string;
  /** OAuth scopes to request. Defaults to ["openid", "email", "profile"]. */
  scopes?: string[];
  /**
   * Optional pinned endpoints. If omitted, they are discovered.
   */
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  jwksUri?: string;
  endSessionEndpoint?: string;
  /**
   * Optional: maximum acceptable age of `iat` in seconds. If set, the
   * ID-token verifier rejects tokens whose iat is older than this,
   * forcing recent re-auth at the provider.
   */
  maxAuthAgeSeconds?: number;
}

/** Return the effective scopes, with sensible defaults. */
export function effectiveScopes(cfg: OidcProviderConfig): string[] {
  if (cfg.scopes && cfg.scopes.length > 0) return cfg.scopes;
  return ["openid", "email", "profile"];
}
