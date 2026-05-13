// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/district-oidc-flow.test.ts
//
// v1.8.4 — Tests for the OIDC flow client (authorize URL + code exchange).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it, vi } from "vitest";
import {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  type OidcTokenExchangeResult,
} from "../../lib/district/oidc/flow";
import type { OidcDiscoveryDocument } from "../../lib/district/oidc/discovery";
import type { OidcProviderConfig } from "../../lib/district/oidc/provider";

function discovery(): OidcDiscoveryDocument {
  return {
    issuer: "https://idp.example",
    authorization_endpoint: "https://idp.example/auth",
    token_endpoint: "https://idp.example/token",
    jwks_uri: "https://idp.example/jwks",
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    raw: {},
  };
}

function provider(
  overrides: Partial<OidcProviderConfig> = {},
): OidcProviderConfig {
  return {
    id: "google",
    label: "Google",
    issuer: "https://idp.example",
    clientId: "client-abc",
    clientSecret: "secret-xyz",
    ...overrides,
  };
}

// ── buildAuthorizeUrl ───────────────────────────────────────────────────────

describe("district/oidc/flow — buildAuthorizeUrl", () => {
  it("assembles the canonical set of OIDC authorize params", () => {
    const url = buildAuthorizeUrl({
      discovery: discovery(),
      provider: provider(),
      redirectUri: "https://app.evk/auth/callback",
      state: "s-abc",
      nonce: "n-xyz",
      codeChallenge: "cc123",
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://idp.example/auth");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("client_id")).toBe("client-abc");
    expect(u.searchParams.get("redirect_uri")).toBe(
      "https://app.evk/auth/callback",
    );
    expect(u.searchParams.get("scope")).toBe("openid email profile");
    expect(u.searchParams.get("state")).toBe("s-abc");
    expect(u.searchParams.get("nonce")).toBe("n-xyz");
    expect(u.searchParams.get("code_challenge")).toBe("cc123");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("prompt")).toBeNull();
    expect(u.searchParams.get("max_age")).toBeNull();
  });

  it("honours provider-overridden scopes", () => {
    const url = buildAuthorizeUrl({
      discovery: discovery(),
      provider: provider({ scopes: ["openid", "email"] }),
      redirectUri: "https://app.evk/auth/callback",
      state: "s",
      nonce: "n",
      codeChallenge: "cc",
    });
    expect(new URL(url).searchParams.get("scope")).toBe("openid email");
  });

  it("honours request-level scopes override", () => {
    const url = buildAuthorizeUrl({
      discovery: discovery(),
      provider: provider({ scopes: ["openid"] }),
      redirectUri: "https://app.evk/auth/callback",
      state: "s",
      nonce: "n",
      codeChallenge: "cc",
      scopes: ["openid", "email", "profile", "offline_access"],
    });
    expect(new URL(url).searchParams.get("scope")).toBe(
      "openid email profile offline_access",
    );
  });

  it("adds prompt=login when forceReauth is true", () => {
    const url = buildAuthorizeUrl({
      discovery: discovery(),
      provider: provider(),
      redirectUri: "https://app.evk/cb",
      state: "s",
      nonce: "n",
      codeChallenge: "cc",
      forceReauth: true,
    });
    expect(new URL(url).searchParams.get("prompt")).toBe("login");
  });

  it("adds prompt=select_account when promptSelectAccount is true", () => {
    const url = buildAuthorizeUrl({
      discovery: discovery(),
      provider: provider(),
      redirectUri: "https://app.evk/cb",
      state: "s",
      nonce: "n",
      codeChallenge: "cc",
      promptSelectAccount: true,
    });
    expect(new URL(url).searchParams.get("prompt")).toBe("select_account");
  });

  it("combines prompt values when multiple are requested", () => {
    const url = buildAuthorizeUrl({
      discovery: discovery(),
      provider: provider(),
      redirectUri: "https://app.evk/cb",
      state: "s",
      nonce: "n",
      codeChallenge: "cc",
      forceReauth: true,
      promptSelectAccount: true,
    });
    expect(new URL(url).searchParams.get("prompt")).toBe("login select_account");
  });

  it("adds max_age from provider config", () => {
    const url = buildAuthorizeUrl({
      discovery: discovery(),
      provider: provider({ maxAuthAgeSeconds: 600 }),
      redirectUri: "https://app.evk/cb",
      state: "s",
      nonce: "n",
      codeChallenge: "cc",
    });
    expect(new URL(url).searchParams.get("max_age")).toBe("600");
  });

  it("appends extraParams but never overrides canonical OIDC params", () => {
    const url = buildAuthorizeUrl({
      discovery: discovery(),
      provider: provider(),
      redirectUri: "https://app.evk/cb",
      state: "s",
      nonce: "n",
      codeChallenge: "cc",
      extraParams: { hd: "school.edu", client_id: "evil" },
    });
    const u = new URL(url);
    expect(u.searchParams.get("hd")).toBe("school.edu");
    expect(u.searchParams.get("client_id")).toBe("client-abc"); // NOT overridden
  });

  it("preserves pre-existing query on the authorization endpoint", () => {
    const doc = discovery();
    doc.authorization_endpoint = "https://idp.example/auth?tenant=foo";
    const url = buildAuthorizeUrl({
      discovery: doc,
      provider: provider(),
      redirectUri: "https://app.evk/cb",
      state: "s",
      nonce: "n",
      codeChallenge: "cc",
    });
    const u = new URL(url);
    expect(u.searchParams.get("tenant")).toBe("foo");
    expect(u.searchParams.get("response_type")).toBe("code");
  });
});

// ── exchangeCodeForTokens ───────────────────────────────────────────────────

function mockFetcher(
  impl: (req: { url: string; init: RequestInit }) => Promise<Response> | Response,
): typeof fetch {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    return impl({ url, init: init ?? {} });
  }) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function readForm(init: RequestInit): URLSearchParams {
  const body = init.body;
  if (typeof body !== "string") throw new Error("expected string body");
  return new URLSearchParams(body);
}

describe("district/oidc/flow — exchangeCodeForTokens (happy path)", () => {
  it("POSTs to the token endpoint with client_secret_basic by default", async () => {
    const fetcher = mockFetcher(({ url, init }) => {
      expect(url).toBe("https://idp.example/token");
      expect(init.method).toBe("POST");
      const hdrs = new Headers(init.headers ?? {});
      expect(hdrs.get("content-type")).toBe(
        "application/x-www-form-urlencoded",
      );
      // Basic auth header present and correct.
      const auth = hdrs.get("authorization");
      expect(auth).toBeTruthy();
      expect(auth!.startsWith("Basic ")).toBe(true);
      const decoded = atob(auth!.slice(6));
      expect(decoded).toBe("client-abc:secret-xyz");
      // Body fields.
      const form = readForm(init);
      expect(form.get("grant_type")).toBe("authorization_code");
      expect(form.get("code")).toBe("code-from-idp");
      expect(form.get("redirect_uri")).toBe("https://app.evk/cb");
      expect(form.get("code_verifier")).toBe("verifier-123");
      expect(form.get("client_id")).toBeNull(); // not in body for basic
      expect(form.get("client_secret")).toBeNull();
      return jsonResponse({
        id_token: "header.payload.sig",
        access_token: "at-abc",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "openid email profile",
      });
    });

    const r = await exchangeCodeForTokens({
      discovery: discovery(),
      provider: provider(),
      code: "code-from-idp",
      codeVerifier: "verifier-123",
      redirectUri: "https://app.evk/cb",
      fetcher,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tokens.id_token).toBe("header.payload.sig");
      expect(r.tokens.access_token).toBe("at-abc");
      expect(r.tokens.expires_in).toBe(3600);
      expect(r.tokens.scope).toBe("openid email profile");
    }
  });

  it("honours client_secret_post when configured", async () => {
    const fetcher = mockFetcher(({ init }) => {
      const hdrs = new Headers(init.headers ?? {});
      expect(hdrs.get("authorization")).toBeNull();
      const form = readForm(init);
      expect(form.get("client_id")).toBe("client-abc");
      expect(form.get("client_secret")).toBe("secret-xyz");
      return jsonResponse({ id_token: "x.y.z" });
    });
    const r = await exchangeCodeForTokens({
      discovery: discovery(),
      provider: provider(),
      code: "c",
      codeVerifier: "v",
      redirectUri: "https://app.evk/cb",
      tokenAuthMethod: "client_secret_post",
      fetcher,
    });
    expect(r.ok).toBe(true);
  });

  it("runs as a public client (PKCE-only) when no secret is configured", async () => {
    const fetcher = mockFetcher(({ init }) => {
      const hdrs = new Headers(init.headers ?? {});
      expect(hdrs.get("authorization")).toBeNull();
      const form = readForm(init);
      expect(form.get("client_id")).toBe("client-public");
      expect(form.get("client_secret")).toBeNull();
      return jsonResponse({ id_token: "x.y.z" });
    });
    const r = await exchangeCodeForTokens({
      discovery: discovery(),
      provider: provider({ clientId: "client-public", clientSecret: undefined }),
      code: "c",
      codeVerifier: "v",
      redirectUri: "https://app.evk/cb",
      fetcher,
    });
    expect(r.ok).toBe(true);
  });

  it("URL-encodes client credentials safely in Basic auth", async () => {
    const fetcher = mockFetcher(({ init }) => {
      const hdrs = new Headers(init.headers ?? {});
      const auth = hdrs.get("authorization")!;
      const decoded = atob(auth.slice(6));
      expect(decoded).toBe(
        `${encodeURIComponent("client:id")}:${encodeURIComponent("s/e+c ret")}`,
      );
      return jsonResponse({ id_token: "x.y.z" });
    });
    const r = await exchangeCodeForTokens({
      discovery: discovery(),
      provider: provider({ clientId: "client:id", clientSecret: "s/e+c ret" }),
      code: "c",
      codeVerifier: "v",
      redirectUri: "https://app.evk/cb",
      fetcher,
    });
    expect(r.ok).toBe(true);
  });
});

describe("district/oidc/flow — exchangeCodeForTokens (failure paths)", () => {
  async function run(resp: () => Response | Promise<Response>): Promise<OidcTokenExchangeResult> {
    return exchangeCodeForTokens({
      discovery: discovery(),
      provider: provider(),
      code: "c",
      codeVerifier: "v",
      redirectUri: "https://app.evk/cb",
      fetcher: mockFetcher(() => resp()),
    });
  }

  it("reports network_error when the fetcher throws", async () => {
    const r = await run(() => {
      throw new Error("ENETUNREACH");
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("network_error");
  });

  it("reports bad_json when the body is not JSON", async () => {
    const r = await run(
      () =>
        new Response("<html>Bad Gateway</html>", {
          status: 502,
          headers: { "content-type": "text/html" },
        }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad_json");
  });

  it("reports oauth_error when the body carries an `error` field", async () => {
    const r = await run(() =>
      jsonResponse(
        { error: "invalid_grant", error_description: "PKCE failed" },
        400,
      ),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("oauth_error");
      expect(r.oauthError?.error).toBe("invalid_grant");
      expect(r.oauthError?.error_description).toBe("PKCE failed");
    }
  });

  it("reports bad_status when the response is non-2xx and not a recognised oauth error", async () => {
    const r = await run(() => jsonResponse({ msg: "no" }, 500));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad_status");
  });

  it("reports missing_id_token when the response has no id_token", async () => {
    const r = await run(() => jsonResponse({ access_token: "at" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_id_token");
  });

  it("reports oauth_error when client_secret_basic requested without secret", async () => {
    const r = await exchangeCodeForTokens({
      discovery: discovery(),
      provider: provider({ clientSecret: undefined }),
      code: "c",
      codeVerifier: "v",
      redirectUri: "https://app.evk/cb",
      tokenAuthMethod: "client_secret_basic",
      fetcher: mockFetcher(() => {
        throw new Error("should not be called");
      }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("oauth_error");
  });
});
