// ─────────────────────────────────────────────────────────────────────────────
// lib/district/oidc/flow.ts
//
// v1.8.4 — OIDC authorization-code flow client.
//
// SCOPE
// ─────
// Two jobs:
//
//   1. Build the `/authorize` URL with all the parameters we need to
//      receive a signed id_token back via `/callback` (state, nonce,
//      PKCE challenge, scopes, redirect_uri, response_type=code).
//
//   2. Exchange the authorization `code` for an `id_token` (+ access
//      token) at the provider's `/token` endpoint, supplying the PKCE
//      verifier and — if configured — the client_secret.
//
// WE DELIBERATELY DO NOT VERIFY THE ID TOKEN HERE. That is the job of
// `lib/district/oidc/id-token.ts`. This module is a pure RFC 6749 / OIDC
// Core transport layer.
//
// CLIENT AUTHENTICATION
// ─────────────────────
// We use `client_secret_basic` (HTTP Basic auth) when a `clientSecret`
// is present. If omitted, we run as a public client (PKCE-only).
// Providers that insist on `client_secret_post` can be accommodated by
// setting `tokenAuthMethod: "client_secret_post"`.
// ─────────────────────────────────────────────────────────────────────────────

import { effectiveScopes, type OidcProviderConfig } from "./provider";
import type { OidcDiscoveryDocument } from "./discovery";

// ── Authorize URL ───────────────────────────────────────────────────────────

export interface BuildAuthorizeUrlInput {
  discovery: OidcDiscoveryDocument;
  provider: OidcProviderConfig;
  /** Our registered redirect URI. Must match exactly. */
  redirectUri: string;
  /** Opaque CSRF state (we round-trip it through the state cookie). */
  state: string;
  /** Opaque nonce (must equal `id_token.nonce`). */
  nonce: string;
  /** base64url(S256(codeVerifier)) — from `pkce.codeChallengeS256`. */
  codeChallenge: string;
  /**
   * Whether to include `prompt=login` to force re-auth at the IdP.
   * Defaults to false.
   */
  forceReauth?: boolean;
  /**
   * Whether to include `prompt=select_account` to force account chooser.
   * Defaults to false.
   */
  promptSelectAccount?: boolean;
  /** Override scopes for this request only. */
  scopes?: string[];
  /** Provider-specific extras (e.g. Google's hd, Azure's domain_hint). */
  extraParams?: Record<string, string>;
}

export function buildAuthorizeUrl(input: BuildAuthorizeUrlInput): string {
  const scopes = input.scopes ?? effectiveScopes(input.provider);
  const params = new URLSearchParams();
  params.set("response_type", "code");
  params.set("client_id", input.provider.clientId);
  params.set("redirect_uri", input.redirectUri);
  params.set("scope", scopes.join(" "));
  params.set("state", input.state);
  params.set("nonce", input.nonce);
  params.set("code_challenge", input.codeChallenge);
  params.set("code_challenge_method", "S256");

  const prompts: string[] = [];
  if (input.forceReauth) prompts.push("login");
  if (input.promptSelectAccount) prompts.push("select_account");
  if (prompts.length > 0) params.set("prompt", prompts.join(" "));

  if (typeof input.provider.maxAuthAgeSeconds === "number") {
    params.set("max_age", String(input.provider.maxAuthAgeSeconds));
  }

  if (input.extraParams) {
    for (const [k, v] of Object.entries(input.extraParams)) {
      // Never let extras shadow the parameters above.
      if (!params.has(k)) params.set(k, v);
    }
  }

  const base = input.discovery.authorization_endpoint;
  return base.includes("?")
    ? `${base}&${params.toString()}`
    : `${base}?${params.toString()}`;
}

// ── Code exchange ───────────────────────────────────────────────────────────

export interface ExchangeCodeInput {
  discovery: OidcDiscoveryDocument;
  provider: OidcProviderConfig;
  /** The `code` received on the callback. */
  code: string;
  /** PKCE code_verifier that we sealed into the state cookie. */
  codeVerifier: string;
  /** Must match the authorize redirect_uri byte-for-byte. */
  redirectUri: string;
  /**
   * How to authenticate the client. Defaults to "client_secret_basic"
   * when a secret is present, or "none" (public client) if not.
   */
  tokenAuthMethod?: "client_secret_basic" | "client_secret_post" | "none";
  /** Injectable for tests. */
  fetcher?: typeof fetch;
}

export interface OidcTokenResponse {
  access_token?: string;
  id_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  /** Preserved for callers that need fields we don't explicitly model. */
  raw: Record<string, unknown>;
}

export type OidcTokenExchangeReason =
  | "network_error"
  | "bad_status"
  | "bad_json"
  | "missing_id_token"
  | "oauth_error";

export type OidcTokenExchangeResult =
  | { ok: true; tokens: OidcTokenResponse }
  | {
      ok: false;
      reason: OidcTokenExchangeReason;
      detail?: string;
      /** Populated when the provider returned an RFC 6749 `error` body. */
      oauthError?: { error: string; error_description?: string };
    };

export async function exchangeCodeForTokens(
  input: ExchangeCodeInput,
): Promise<OidcTokenExchangeResult> {
  const fetcher = input.fetcher ?? fetch;
  const authMethod =
    input.tokenAuthMethod ??
    (input.provider.clientSecret ? "client_secret_basic" : "none");

  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", input.code);
  body.set("redirect_uri", input.redirectUri);
  body.set("code_verifier", input.codeVerifier);

  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/x-www-form-urlencoded",
  };

  if (authMethod === "client_secret_basic") {
    if (!input.provider.clientSecret) {
      return {
        ok: false,
        reason: "oauth_error",
        detail: "client_secret_basic requested but provider has no clientSecret",
      };
    }
    const basic = base64(
      `${encodeURIComponent(input.provider.clientId)}:${encodeURIComponent(input.provider.clientSecret)}`,
    );
    headers.authorization = `Basic ${basic}`;
  } else if (authMethod === "client_secret_post") {
    if (!input.provider.clientSecret) {
      return {
        ok: false,
        reason: "oauth_error",
        detail: "client_secret_post requested but provider has no clientSecret",
      };
    }
    body.set("client_id", input.provider.clientId);
    body.set("client_secret", input.provider.clientSecret);
  } else {
    // Public client — send client_id in the body so the /token endpoint
    // can identify us even without authentication.
    body.set("client_id", input.provider.clientId);
  }

  let resp: Response;
  try {
    resp = await fetcher(input.discovery.token_endpoint, {
      method: "POST",
      headers,
      body: body.toString(),
    });
  } catch (e) {
    return {
      ok: false,
      reason: "network_error",
      detail: e instanceof Error ? e.message : String(e),
    };
  }

  let json: unknown;
  try {
    json = await resp.json();
  } catch {
    return { ok: false, reason: "bad_json", detail: `status=${resp.status}` };
  }

  if (!json || typeof json !== "object") {
    return { ok: false, reason: "bad_json", detail: `status=${resp.status}` };
  }

  const raw = json as Record<string, unknown>;

  // OAuth-style error body (RFC 6749 §5.2). Can arrive with non-2xx
  // or, rarely, with 200 and an `error` key — treat either as an error.
  if (typeof raw.error === "string") {
    return {
      ok: false,
      reason: "oauth_error",
      oauthError: {
        error: raw.error,
        error_description:
          typeof raw.error_description === "string"
            ? raw.error_description
            : undefined,
      },
    };
  }

  if (!resp.ok) {
    return { ok: false, reason: "bad_status", detail: String(resp.status) };
  }

  if (typeof raw.id_token !== "string" || raw.id_token.length === 0) {
    return { ok: false, reason: "missing_id_token" };
  }

  const tokens: OidcTokenResponse = {
    id_token: raw.id_token,
    access_token:
      typeof raw.access_token === "string" ? raw.access_token : undefined,
    refresh_token:
      typeof raw.refresh_token === "string" ? raw.refresh_token : undefined,
    token_type:
      typeof raw.token_type === "string" ? raw.token_type : undefined,
    expires_in:
      typeof raw.expires_in === "number" ? raw.expires_in : undefined,
    scope: typeof raw.scope === "string" ? raw.scope : undefined,
    raw,
  };
  return { ok: true, tokens };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function base64(s: string): string {
  if (typeof btoa !== "undefined") return btoa(s);
  return Buffer.from(s, "binary").toString("base64");
}
