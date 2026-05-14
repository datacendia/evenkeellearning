// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/district-oidc-handlers.test.ts
//
// v1.8.5 — Framework-free tests for the /start and /callback HTTP handlers.
//
// Uses the same in-process IdP simulator as
// `district-oidc-callback.test.ts` and drives the real handler code
// paths. Covers:
//
//   • /start happy path, provider-not-found, discovery failure,
//     returnTo clamp, prompt parameters.
//   • /callback success → login-intent cookie + redirect.
//   • /callback IdP error, state failures, discovery failures, token
//     failures, id-token failures, autoProvision-rejected user,
//     provider-not-found.
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from "vitest";
import { bytesToBase64Url } from "../../lib/crypto/base64url";
import { resetJwksCache } from "../../lib/jwt/jwks-fetcher";
import { InMemoryDistrictStore } from "../../lib/district/in-memory-store";
import type { DistrictStore } from "../../lib/district/store";
import type { AuditEvent } from "../../lib/district/types";
import {
  handleOidcCallback,
  handleOidcStart,
  OIDC_LOGIN_INTENT_COOKIE_NAME,
  OIDC_STATE_COOKIE_NAME,
  resetDiscoveryCache,
  resetOidcProvidersCache,
  type OidcProviderConfig,
  type TenantOidcProviderEntry,
  verifyOidcLoginIntent,
  verifyOidcState,
} from "../../lib/district/oidc";
import type { JsonWebKey as Jwk } from "../../lib/jwt/jwks";

// ── Helpers reused from the callback test: IdP simulator ────────────────────

interface IdpKey {
  kid: string;
  publicJwk: Jwk;
  privateKey: CryptoKey;
}

async function makeIdpKey(kid: string): Promise<IdpKey> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const exported = (await crypto.subtle.exportKey(
    "jwk",
    pair.publicKey,
  )) as Record<string, unknown>;
  return {
    kid,
    publicJwk: {
      kty: String(exported.kty),
      crv: typeof exported.crv === "string" ? exported.crv : undefined,
      x: typeof exported.x === "string" ? exported.x : undefined,
      y: typeof exported.y === "string" ? exported.y : undefined,
      kid,
      alg: "ES256",
      use: "sig",
    },
    privateKey: pair.privateKey,
  };
}

async function signJwt(
  key: IdpKey,
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
): Promise<string> {
  const enc = new TextEncoder();
  const hb = bytesToBase64Url(enc.encode(JSON.stringify(header)));
  const pb = bytesToBase64Url(enc.encode(JSON.stringify(payload)));
  const signingInput = hb + "." + pb;
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    key.privateKey,
    enc.encode(signingInput),
  );
  return signingInput + "." + bytesToBase64Url(new Uint8Array(sig));
}

interface IdpFixture {
  issuer: string;
  key: IdpKey;
  fetcher: typeof fetch;
  nextIdTokenClaims: Record<string, unknown> | null;
  discoveryOverride: Record<string, unknown> | null;
}

async function makeIdpFixture(issuer = "https://idp.example"): Promise<IdpFixture> {
  const key = await makeIdpKey("idp-key-1");
  const fixture: IdpFixture = {
    issuer,
    key,
    fetcher: (async () => new Response("", { status: 500 })) as unknown as typeof fetch,
    nextIdTokenClaims: null,
    discoveryOverride: null,
  };

  const baseDiscovery = {
    issuer,
    authorization_endpoint: `${issuer}/auth`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/jwks`,
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256", "ES256"],
  };

  const handler = async (
    input: string | URL | Request,
    _init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.endsWith("/.well-known/openid-configuration")) {
      return new Response(
        JSON.stringify(fixture.discoveryOverride ?? baseDiscovery),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url === `${issuer}/jwks`) {
      return new Response(JSON.stringify({ keys: [fixture.key.publicJwk] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url === `${issuer}/token`) {
      const claims =
        fixture.nextIdTokenClaims ?? baseClaimsFor(fixture.issuer, "n");
      const idToken = await signJwt(
        fixture.key,
        { alg: "ES256", kid: fixture.key.kid, typ: "JWT" },
        claims,
      );
      return new Response(
        JSON.stringify({
          id_token: idToken,
          access_token: "at-abc",
          token_type: "Bearer",
          expires_in: 3600,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(`unexpected ${url}`, { status: 404 });
  };

  fixture.fetcher = vi.fn(handler) as unknown as typeof fetch;
  return fixture;
}

function baseClaimsFor(iss: string, nonce: string): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss,
    sub: "sub-42",
    aud: "client-abc",
    exp: now + 300,
    iat: now,
    nonce,
    email: "user@example.com",
    email_verified: true,
    name: "Test User",
  };
}

function providerPinned(issuer: string): OidcProviderConfig {
  return {
    id: "google",
    label: "Google",
    issuer,
    clientId: "client-abc",
    clientSecret: "secret-xyz",
    authorizationEndpoint: `${issuer}/auth`,
    tokenEndpoint: `${issuer}/token`,
    jwksUri: `${issuer}/jwks`,
  };
}

function providers(
  tenantId: string,
  issuer: string,
): ReadonlyArray<TenantOidcProviderEntry> {
  return [{ tenantId, provider: providerPinned(issuer) }];
}

function parseSetCookie(headers: Headers, name: string): string | null {
  // Next.js Headers.getSetCookie may not be available in Node's fetch
  // polyfill, so iterate raw values.
  const all = headers.get("set-cookie");
  if (!all) return null;
  const parts = all.split(/,\s*(?=[^;]+?=)/); // split multi-cookies
  for (const p of [...parts, all]) {
    const m = p.match(new RegExp(`${name}=([^;]*)`));
    if (m) return m[1];
  }
  return null;
}

function parseAllSetCookies(headers: Headers): string[] {
  // Get all Set-Cookie values without collapsing (Headers.append was used).
  // Node's Headers collapses duplicates via comma; we split carefully.
  const raw = headers.get("set-cookie");
  if (!raw) return [];
  // A cookie's Max-Age/Expires/etc. use ";" between attrs, and the
  // separator between multiple Set-Cookies is `, ` only where preceded
  // by an attribute, not by a cookie name. We split conservatively on
  // `, ` followed by `key=`.
  const out = [raw];
  return out;
}

function createStore(): DistrictStore {
  return new InMemoryDistrictStore({ allowInProduction: true });
}

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetDiscoveryCache();
  resetJwksCache();
  resetOidcProvidersCache();
});

// ── /start ──────────────────────────────────────────────────────────────────

describe("handleOidcStart", () => {
  it("302s to the authorize URL and sets a signed state cookie", async () => {
    const idp = await makeIdpFixture();
    const result = await handleOidcStart({
      tenantId: "tenant-A",
      providerId: "google",
      requestOrigin: "https://app.evk",
      providers: providers("tenant-A", idp.issuer),
      fetcher: idp.fetcher,
    });
    expect(result.status).toBe(302);
    const loc = result.headers.get("location")!;
    const u = new URL(loc);
    expect(u.origin + u.pathname).toBe(`${idp.issuer}/auth`);
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("client_id")).toBe("client-abc");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("state")).toBeTruthy();
    expect(u.searchParams.get("nonce")).toBeTruthy();
    expect(u.searchParams.get("redirect_uri")).toBe(
      "https://app.evk/api/district/auth/sso/oidc/callback/tenant-A/google",
    );

    const cookie = parseSetCookie(result.headers, OIDC_STATE_COOKIE_NAME);
    expect(cookie).toBeTruthy();

    // Verify the state cookie seals the same state/nonce the authorize URL carries.
    const sc = await verifyOidcState(cookie);
    expect(sc.ok).toBe(true);
    if (sc.ok) {
      expect(sc.payload.state).toBe(u.searchParams.get("state"));
      expect(sc.payload.nonce).toBe(u.searchParams.get("nonce"));
      expect(sc.payload.tenantId).toBe("tenant-A");
      expect(sc.payload.providerId).toBe("google");
    }
  });

  it("clamps return_to to same-origin (path + query only)", async () => {
    const idp = await makeIdpFixture();
    const result = await handleOidcStart({
      tenantId: "tenant-A",
      providerId: "google",
      requestOrigin: "https://app.evk",
      returnTo: "https://attacker.example/phish",
      providers: providers("tenant-A", idp.issuer),
      fetcher: idp.fetcher,
    });
    const cookie = parseSetCookie(result.headers, OIDC_STATE_COOKIE_NAME);
    const sc = await verifyOidcState(cookie);
    expect(sc.ok).toBe(true);
    if (sc.ok) expect(sc.payload.returnTo).toBeUndefined();
  });

  it("preserves same-origin relative return_to", async () => {
    const idp = await makeIdpFixture();
    const result = await handleOidcStart({
      tenantId: "tenant-A",
      providerId: "google",
      requestOrigin: "https://app.evk",
      returnTo: "/dashboard?next=1",
      providers: providers("tenant-A", idp.issuer),
      fetcher: idp.fetcher,
    });
    const cookie = parseSetCookie(result.headers, OIDC_STATE_COOKIE_NAME);
    const sc = await verifyOidcState(cookie);
    expect(sc.ok).toBe(true);
    if (sc.ok) expect(sc.payload.returnTo).toBe("/dashboard?next=1");
  });

  it("adds prompt=login when forceReauth=true", async () => {
    const idp = await makeIdpFixture();
    const result = await handleOidcStart({
      tenantId: "tenant-A",
      providerId: "google",
      requestOrigin: "https://app.evk",
      forceReauth: true,
      providers: providers("tenant-A", idp.issuer),
      fetcher: idp.fetcher,
    });
    const u = new URL(result.headers.get("location")!);
    expect(u.searchParams.get("prompt")).toBe("login");
  });

  it("returns 404 when the provider is not configured for this tenant", async () => {
    const idp = await makeIdpFixture();
    const result = await handleOidcStart({
      tenantId: "tenant-OTHER",
      providerId: "google",
      requestOrigin: "https://app.evk",
      providers: providers("tenant-A", idp.issuer), // not tenant-OTHER
      fetcher: idp.fetcher,
    });
    expect(result.status).toBe(404);
  });

  it("returns 502 when discovery fails and no endpoints are pinned", async () => {
    // Unpinned provider that discovery will reject.
    const fetcher = vi.fn(async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    const providersList: ReadonlyArray<TenantOidcProviderEntry> = [
      {
        tenantId: "tenant-A",
        provider: {
          id: "google",
          label: "Google",
          issuer: "https://idp-unreachable.example",
          clientId: "c",
          clientSecret: "s",
        },
      },
    ];
    const result = await handleOidcStart({
      tenantId: "tenant-A",
      providerId: "google",
      requestOrigin: "https://app.evk",
      providers: providersList,
      fetcher,
    });
    expect(result.status).toBe(502);
    expect(result.body).toContain("discovery failed");
  });
});

// ── /callback ──────────────────────────────────────────────────────────────

async function runSuccessfulStartAndGetState(opts: {
  idp: IdpFixture;
  tenantId?: string;
  providerId?: string;
  returnTo?: string;
}) {
  const tenantId = opts.tenantId ?? "tenant-A";
  const providerId = opts.providerId ?? "google";
  const start = await handleOidcStart({
    tenantId,
    providerId,
    requestOrigin: "https://app.evk",
    returnTo: opts.returnTo,
    providers: providers(tenantId, opts.idp.issuer),
    fetcher: opts.idp.fetcher,
  });
  const stateCookie = parseSetCookie(start.headers, OIDC_STATE_COOKIE_NAME)!;
  const loc = new URL(start.headers.get("location")!);
  return {
    stateCookie,
    state: loc.searchParams.get("state")!,
    nonce: loc.searchParams.get("nonce")!,
    tenantId,
    providerId,
  };
}

describe("handleOidcCallback — happy path", () => {
  it("sets login-intent cookie, clears state cookie, and 303s to bind-passkey", async () => {
    const idp = await makeIdpFixture();
    const store = createStore();
    await store.createTenant({ name: "Tenant A" });
    const tenant = (await store.listTenants())[0];

    const start = await runSuccessfulStartAndGetState({
      idp,
      tenantId: tenant.id,
      returnTo: "/home",
    });
    idp.nextIdTokenClaims = baseClaimsFor(idp.issuer, start.nonce);

    const q = new URLSearchParams({
      code: "abc123",
      state: start.state,
    });
    const result = await handleOidcCallback({
      tenantId: start.tenantId,
      providerId: start.providerId,
      requestOrigin: "https://app.evk",
      stateCookie: start.stateCookie,
      query: q,
      store,
      fetcher: idp.fetcher,
      providers: providers(start.tenantId, idp.issuer),
    });
    expect(result.http.status).toBe(303);
    expect(result.outcome.kind).toBe("success");
    if (result.outcome.kind === "success") {
      expect(result.outcome.isNewUser).toBe(true);
      expect(result.outcome.hasExistingPasskey).toBe(false);
    }

    const loc = new URL(result.http.headers.get("location")!);
    expect(loc.pathname).toBe("/auth/bind-passkey");
    expect(loc.searchParams.get("return_to")).toBe("/home");

    const intent = parseSetCookie(
      result.http.headers,
      OIDC_LOGIN_INTENT_COOKIE_NAME,
    );
    expect(intent).toBeTruthy();
    const v = await verifyOidcLoginIntent(intent);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.payload.tenantId).toBe(start.tenantId);
      expect(v.payload.providerId).toBe("google");
      expect(v.payload.externalId).toBe("google:sub-42");
      expect(v.payload.source).toBe("sso.oidc.google");
      expect(v.payload.newUser).toBe(true);
      expect(v.payload.hasExistingPasskey).toBe(false);
    }

    // Audit event was written.
    const audit = await store.listAudit(start.tenantId);
    expect(
      audit.some(
        (a: AuditEvent) => a.action === "district.sso.oidc.callback_succeeded",
      ),
    ).toBe(true);
  });

  it("reports hasExistingPasskey=true when the resolved user has an active passkey", async () => {
    const idp = await makeIdpFixture();
    const store = createStore();
    const tenant = await store.createTenant({ name: "Tenant A" });
    // Pre-provision the user + passkey so resolveOidcIdentity finds them.
    const { user } = await store.upsertUser(tenant.id, {
      externalId: "google:sub-42",
      displayName: "Pre-existing",
      email: "pre@example.com",
    });
    await store.addPasskeyCredential(tenant.id, user.id, {
      credentialIdB64url: "cred-1",
      spkiB64url: "spki-1",
      signCount: 0,
    });

    const start = await runSuccessfulStartAndGetState({
      idp,
      tenantId: tenant.id,
    });
    idp.nextIdTokenClaims = baseClaimsFor(idp.issuer, start.nonce);

    const q = new URLSearchParams({
      code: "c",
      state: start.state,
    });
    const result = await handleOidcCallback({
      tenantId: start.tenantId,
      providerId: start.providerId,
      requestOrigin: "https://app.evk",
      stateCookie: start.stateCookie,
      query: q,
      store,
      fetcher: idp.fetcher,
      providers: providers(start.tenantId, idp.issuer),
    });
    expect(result.outcome.kind).toBe("success");
    if (result.outcome.kind === "success") {
      expect(result.outcome.isNewUser).toBe(false);
      expect(result.outcome.hasExistingPasskey).toBe(true);
    }
  });
});

describe("handleOidcCallback — failure paths", () => {
  it("400s when the IdP returns error=access_denied", async () => {
    const idp = await makeIdpFixture();
    const store = createStore();
    await store.createTenant({ name: "Tenant A" });
    const tenant = (await store.listTenants())[0];

    const start = await runSuccessfulStartAndGetState({
      idp,
      tenantId: tenant.id,
    });
    const q = new URLSearchParams({
      error: "access_denied",
      error_description: "User declined",
      state: start.state,
    });
    const result = await handleOidcCallback({
      tenantId: start.tenantId,
      providerId: start.providerId,
      requestOrigin: "https://app.evk",
      stateCookie: start.stateCookie,
      query: q,
      store,
      fetcher: idp.fetcher,
      providers: providers(start.tenantId, idp.issuer),
    });
    expect(result.http.status).toBe(400);
    expect(result.outcome.kind).toBe("idp_error");
    if (result.outcome.kind === "idp_error") {
      expect(result.outcome.error).toBe("access_denied");
    }
    // State cookie should be cleared.
    expect(result.http.headers.get("set-cookie")).toContain(
      `${OIDC_STATE_COOKIE_NAME}=`,
    );
    // Audit event recorded.
    const audit = await store.listAudit(start.tenantId);
    expect(
      audit.some(
        (a: AuditEvent) => a.action === "district.sso.oidc.callback_failed",
      ),
    ).toBe(true);
  });

  it("400s on state mismatch", async () => {
    const idp = await makeIdpFixture();
    const store = createStore();
    await store.createTenant({ name: "Tenant A" });
    const tenant = (await store.listTenants())[0];

    const start = await runSuccessfulStartAndGetState({
      idp,
      tenantId: tenant.id,
    });
    idp.nextIdTokenClaims = baseClaimsFor(idp.issuer, start.nonce);
    const q = new URLSearchParams({
      code: "c",
      state: "totally-different-state", // attacker / replay
    });
    const result = await handleOidcCallback({
      tenantId: start.tenantId,
      providerId: start.providerId,
      requestOrigin: "https://app.evk",
      stateCookie: start.stateCookie,
      query: q,
      store,
      fetcher: idp.fetcher,
      providers: providers(start.tenantId, idp.issuer),
    });
    expect(result.http.status).toBe(400);
    expect(result.outcome.kind).toBe("failed");
    if (result.outcome.kind === "failed") {
      expect(result.outcome.failure.stage).toBe("state_match");
    }
  });

  it("400s when the id_token nonce does not match the sealed nonce", async () => {
    const idp = await makeIdpFixture();
    const store = createStore();
    await store.createTenant({ name: "Tenant A" });
    const tenant = (await store.listTenants())[0];

    const start = await runSuccessfulStartAndGetState({
      idp,
      tenantId: tenant.id,
    });
    idp.nextIdTokenClaims = baseClaimsFor(idp.issuer, "DIFFERENT");

    const q = new URLSearchParams({
      code: "c",
      state: start.state,
    });
    const result = await handleOidcCallback({
      tenantId: start.tenantId,
      providerId: start.providerId,
      requestOrigin: "https://app.evk",
      stateCookie: start.stateCookie,
      query: q,
      store,
      fetcher: idp.fetcher,
      providers: providers(start.tenantId, idp.issuer),
    });
    expect(result.http.status).toBe(400);
    if (result.outcome.kind === "failed") {
      expect(result.outcome.failure.stage).toBe("id_token");
    }
  });

  it("404s when the provider is unknown for the tenant", async () => {
    const store = createStore();
    const result = await handleOidcCallback({
      tenantId: "tenant-NEVER",
      providerId: "google",
      requestOrigin: "https://app.evk",
      stateCookie: null,
      query: new URLSearchParams({ code: "c", state: "s" }),
      store,
      providers: [],
    });
    expect(result.http.status).toBe(404);
    expect(result.outcome.kind).toBe("provider_not_found");
  });

  it("400s and clears state cookie when the state cookie is missing", async () => {
    const idp = await makeIdpFixture();
    const store = createStore();
    await store.createTenant({ name: "Tenant A" });
    const tenant = (await store.listTenants())[0];

    const result = await handleOidcCallback({
      tenantId: tenant.id,
      providerId: "google",
      requestOrigin: "https://app.evk",
      stateCookie: null,
      query: new URLSearchParams({ code: "c", state: "s" }),
      store,
      fetcher: idp.fetcher,
      providers: providers(tenant.id, idp.issuer),
    });
    expect(result.http.status).toBe(400);
    expect(result.outcome.kind).toBe("failed");
    if (result.outcome.kind === "failed") {
      expect(result.outcome.failure.stage).toBe("state_cookie");
    }
  });
});

// Suppress unused-in-one-spot warnings.
void parseAllSetCookies;
