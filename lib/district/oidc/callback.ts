// ─────────────────────────────────────────────────────────────────────────────
// lib/district/oidc/callback.ts
//
// v1.8.4 — End-to-end OIDC SSO callback orchestrator.
//
// INTENT
// ──────
// This is the single entry point that a `GET /api/district/auth/sso/oidc/
// callback` route calls. It ties together the five sub-modules in this
// directory into a single, well-tested pipeline:
//
//   1. State-cookie verify        — sealed payload with nonce, PKCE verifier,
//                                   tenantId, providerId, returnTo.
//   2. CSRF `state` query-param   — must match the sealed `state`.
//   3. Discovery                  — fetch + validate /.well-known doc
//                                   (pinned endpoints from provider.config
//                                    take precedence).
//   4. Code exchange              — RFC 6749 /token call with PKCE verifier.
//   5. JWKS fetch                 — TTL-cached, honours provider pinning.
//   6. ID-token verify            — signature + OIDC claim checks
//                                   (iss, aud, azp, nonce, sub, maxAge).
//
// RESULT SHAPE
// ────────────
// On success we return the verified OIDC identity claims PLUS the
// `returnTo` URL the caller sealed into the state cookie. The caller
// then resolves the identity to a tenant user (via `resolveOidcIdentity`)
// and calls `establishSession` (with or without passkey enrollment).
//
// DELIBERATE NON-SCOPE
// ────────────────────
//   • No session cookie issuance      (→ `lib/district/auth.ts`)
//   • No user provisioning            (→ `resolveOidcIdentity`, below)
//   • No HTTP framing                 (→ the route handler)
// ─────────────────────────────────────────────────────────────────────────────

import type { DistrictStore } from "../store";
import type { TenantUser } from "../types";
import { fetchJwks } from "@/lib/jwt/jwks-fetcher";
import type { JsonWebKeySet } from "@/lib/jwt/jwks";
import {
  fetchOidcDiscovery,
  type OidcDiscoveryDocument,
} from "./discovery";
import { exchangeCodeForTokens, type OidcTokenResponse } from "./flow";
import {
  verifyOidcIdToken,
  type OidcIdTokenVerifySuccess,
} from "./id-token";
import { verifyOidcState, type OidcStatePayload } from "./state";
import type { OidcProviderConfig } from "./provider";

// ── Callback input/result shapes ────────────────────────────────────────────

export interface CompleteOidcCallbackArgs {
  /** The raw cookie value of `OIDC_STATE_COOKIE_NAME`. */
  stateCookie: string | null | undefined;
  /** `state` query parameter from the IdP redirect. */
  stateQuery: string | null | undefined;
  /** `code` query parameter from the IdP redirect. */
  codeQuery: string | null | undefined;
  /**
   * Expected tenant + provider (typically derived from the URL path
   * `/api/district/auth/sso/oidc/callback/:tenantId/:providerId`).
   * We refuse to proceed if the sealed cookie disagrees.
   */
  expectedTenantId: string;
  expectedProviderId: string;
  /** The provider config to use (endpoints + client creds). */
  provider: OidcProviderConfig;
  /** The callback URL registered with the provider. */
  redirectUri: string;
  /** Injectable fetcher — defaults to `globalThis.fetch`. */
  fetcher?: typeof fetch;
  /** Deterministic clocks for tests. */
  nowMs?: number;
  nowSeconds?: number;
}

export type OidcCallbackFailure =
  | { stage: "state_cookie"; reason: "missing" | "malformed" | "bad_signature" | "expired" }
  | { stage: "state_match"; reason: "missing_query" | "state_mismatch" }
  | { stage: "context_match"; reason: "tenant_mismatch" | "provider_mismatch" }
  | { stage: "code"; reason: "missing_code" }
  | { stage: "discovery"; reason: string; detail?: string }
  | { stage: "jwks"; reason: string; detail?: string }
  | { stage: "token_exchange"; reason: string; detail?: string }
  | { stage: "id_token"; reason: string; detail?: string };

export interface OidcCallbackSuccess {
  ok: true;
  /** Verified OIDC claims. */
  identity: OidcIdTokenVerifySuccess;
  /** The resolved discovery document (useful for logout/end-session flows). */
  discovery: OidcDiscoveryDocument;
  /** The full token response — access_token, refresh_token, etc. */
  tokens: OidcTokenResponse;
  /** Original state payload (for `returnTo` and audit logging). */
  state: OidcStatePayload;
}

export type OidcCallbackResult =
  | OidcCallbackSuccess
  | { ok: false; failure: OidcCallbackFailure };

// ── completeOidcCallback ────────────────────────────────────────────────────

export async function completeOidcCallback(
  args: CompleteOidcCallbackArgs,
): Promise<OidcCallbackResult> {
  const {
    stateCookie,
    stateQuery,
    codeQuery,
    expectedTenantId,
    expectedProviderId,
    provider,
    redirectUri,
    nowMs,
    nowSeconds,
  } = args;
  const fetcher = args.fetcher ?? fetch;

  // (1) Signed state cookie.
  const stateResult = await verifyOidcState(stateCookie, { nowMs });
  if (!stateResult.ok) {
    return { ok: false, failure: { stage: "state_cookie", reason: stateResult.reason } };
  }
  const state = stateResult.payload;

  // (2) Query-param `state` binding.
  if (typeof stateQuery !== "string" || stateQuery.length === 0) {
    return { ok: false, failure: { stage: "state_match", reason: "missing_query" } };
  }
  if (stateQuery !== state.state) {
    return { ok: false, failure: { stage: "state_match", reason: "state_mismatch" } };
  }

  // (3) Tenant + provider MUST match the caller's URL context.
  if (state.tenantId !== expectedTenantId) {
    return {
      ok: false,
      failure: { stage: "context_match", reason: "tenant_mismatch" },
    };
  }
  if (state.providerId !== expectedProviderId) {
    return {
      ok: false,
      failure: { stage: "context_match", reason: "provider_mismatch" },
    };
  }
  if (provider.id !== expectedProviderId) {
    return {
      ok: false,
      failure: { stage: "context_match", reason: "provider_mismatch" },
    };
  }

  // (4) Authorization code must be present.
  if (typeof codeQuery !== "string" || codeQuery.length === 0) {
    return { ok: false, failure: { stage: "code", reason: "missing_code" } };
  }

  // (5) Discovery (honours per-provider pinned endpoints).
  const discovery = await resolveDiscovery(provider, { fetcher, nowMs });
  if (!discovery.ok) {
    return {
      ok: false,
      failure: {
        stage: "discovery",
        reason: discovery.reason,
        detail: discovery.detail,
      },
    };
  }

  // (6) Exchange the code at /token.
  const tokenResult = await exchangeCodeForTokens({
    discovery: discovery.doc,
    provider,
    code: codeQuery,
    codeVerifier: state.codeVerifier,
    redirectUri,
    fetcher,
  });
  if (!tokenResult.ok) {
    return {
      ok: false,
      failure: {
        stage: "token_exchange",
        reason: tokenResult.reason,
        detail:
          tokenResult.reason === "oauth_error"
            ? `${tokenResult.oauthError?.error}${
                tokenResult.oauthError?.error_description
                  ? ": " + tokenResult.oauthError.error_description
                  : ""
              }`
            : tokenResult.detail,
      },
    };
  }

  // (7) JWKS.
  const jwksResult = await fetchJwks(provider.jwksUri ?? discovery.doc.jwks_uri, {
    fetcher,
    nowMs,
  });
  if (!jwksResult.ok) {
    return {
      ok: false,
      failure: { stage: "jwks", reason: jwksResult.reason, detail: jwksResult.detail },
    };
  }
  const jwks: JsonWebKeySet = jwksResult.jwks;

  // (8) Verify the id_token.
  const idTokenResult = await verifyOidcIdToken(
    tokenResult.tokens.id_token,
    jwks,
    {
      expectedIss: provider.issuer,
      expectedAud: provider.clientId,
      expectedNonce: state.nonce,
      maxAgeSeconds: provider.maxAuthAgeSeconds,
      nowSeconds,
    },
  );
  if (!idTokenResult.ok) {
    return {
      ok: false,
      failure: {
        stage: "id_token",
        reason: `${idTokenResult.stage}:${idTokenResult.reason}`,
        detail: idTokenResult.detail,
      },
    };
  }

  return {
    ok: true,
    identity: idTokenResult,
    discovery: discovery.doc,
    tokens: tokenResult.tokens,
    state,
  };
}

/**
 * Resolve discovery honouring per-provider pinned endpoints. If ALL
 * required endpoints are pinned (authorization, token, jwks_uri) we
 * synthesize a discovery document without a network call.
 */
async function resolveDiscovery(
  provider: OidcProviderConfig,
  opts: { fetcher: typeof fetch; nowMs?: number },
): Promise<
  | { ok: true; doc: OidcDiscoveryDocument }
  | { ok: false; reason: string; detail?: string }
> {
  if (
    provider.authorizationEndpoint &&
    provider.tokenEndpoint &&
    provider.jwksUri
  ) {
    return {
      ok: true,
      doc: {
        issuer: provider.issuer,
        authorization_endpoint: provider.authorizationEndpoint,
        token_endpoint: provider.tokenEndpoint,
        jwks_uri: provider.jwksUri,
        end_session_endpoint: provider.endSessionEndpoint,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256", "ES256"],
        raw: {
          issuer: provider.issuer,
          authorization_endpoint: provider.authorizationEndpoint,
          token_endpoint: provider.tokenEndpoint,
          jwks_uri: provider.jwksUri,
          ...(provider.endSessionEndpoint
            ? { end_session_endpoint: provider.endSessionEndpoint }
            : {}),
        },
      },
    };
  }
  const r = await fetchOidcDiscovery(provider.issuer, {
    fetcher: opts.fetcher,
    nowMs: opts.nowMs,
  });
  if (!r.ok) return { ok: false, reason: r.reason, detail: r.detail };
  return { ok: true, doc: r.doc };
}

// ── resolveOidcIdentity ─────────────────────────────────────────────────────

export interface ResolveOidcIdentityArgs {
  store: DistrictStore;
  tenantId: string;
  providerId: string;
  identity: OidcIdTokenVerifySuccess;
  /**
   * Auto-provision unknown users? Default true. Districts that want
   * strict roster-gated access should pass false; unknown users will
   * then be rejected.
   */
  autoProvision?: boolean;
}

export type ResolveOidcIdentityResult =
  | { ok: true; user: TenantUser; isNewUser: boolean }
  | { ok: false; reason: "unknown_user" | "user_inactive" };

/**
 * Given a verified OIDC identity, look up or create the matching
 * tenant user. The external-id convention is `${providerId}:${sub}` —
 * this is prefixed with the provider so two providers with colliding
 * `sub`s for the same user (rare in practice) don't clash.
 */
export async function resolveOidcIdentity(
  args: ResolveOidcIdentityArgs,
): Promise<ResolveOidcIdentityResult> {
  const { store, tenantId, providerId, identity } = args;
  const autoProvision = args.autoProvision ?? true;
  const externalId = `${providerId}:${identity.sub}`;

  const existing = await store.getUserByExternalId(tenantId, externalId);
  if (existing) {
    if (!existing.active) return { ok: false, reason: "user_inactive" };
    // Keep display name / email fresh — these change in the IdP over time.
    const patchNeeded =
      (identity.name && identity.name !== existing.displayName) ||
      (identity.email && identity.email !== existing.email);
    if (patchNeeded) {
      const updated = await store.updateUser(tenantId, existing.id, {
        displayName: identity.name ?? existing.displayName,
        email: identity.email ?? existing.email,
      });
      if (updated) return { ok: true, user: updated, isNewUser: false };
    }
    return { ok: true, user: existing, isNewUser: false };
  }

  if (!autoProvision) return { ok: false, reason: "unknown_user" };

  const { user, created } = await store.upsertUser(tenantId, {
    externalId,
    displayName: identity.name,
    email: identity.email,
    active: true,
  });
  if (!user.active) return { ok: false, reason: "user_inactive" };
  return { ok: true, user, isNewUser: created };
}
