// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/district-oidc-callback.test.ts
//
// v1.8.4 — End-to-end OIDC callback orchestrator tests.
//
// Synthesises a complete IdP (JWKS + discovery + token endpoint), runs
// the authorize → callback flow via a single mock `fetcher`, and
// verifies:
//
//   • Happy path (auto-provisions a user, establishes session).
//   • Every failure stage the orchestrator returns.
//   • Identity resolution for existing vs. new users, inactive users,
//     and autoProvision=false rejection.
//
// Uses the in-memory store + real ECDSA keys.
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from "vitest";
import { bytesToBase64Url } from "../../lib/crypto/base64url";
import { resetJwksCache } from "../../lib/jwt/jwks-fetcher";
import { InMemoryDistrictStore } from "../../lib/district/in-memory-store";
import type { DistrictStore } from "../../lib/district/store";
import type { AuditEvent } from "../../lib/district/types";
import {
  codeChallengeS256,
  completeOidcCallback,
  generateCodeVerifier,
  OIDC_STATE_TTL_MS,
  OidcStatePayload,
  randomUrlSafe,
  resetDiscoveryCache,
  resolveOidcIdentity,
  signOidcState,
  type OidcProviderConfig,
} from "../../lib/district/oidc";
import type { JsonWebKey as Jwk } from "../../lib/jwt/jwks";
import { establishSession } from "../../lib/district/auth";

function createInMemoryDistrictStore(): DistrictStore {
  return new InMemoryDistrictStore({ allowInProduction: true });
}

// ── Helper: IdP simulator ───────────────────────────────────────────────────

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
  /** Mutable dial for the next /token call. */
  nextTokenIdTokenClaims: Record<string, unknown> | null;
  nextTokenOverrideHeader: Record<string, unknown> | null;
  nextTokenResponseBody: unknown | null;
  nextTokenResponseStatus: number | null;
  discoveryOverride: Record<string, unknown> | null;
  jwksOverride: { keys: Jwk[] } | null;
  /** Optional custom verifier for the /token request. */
  tokenRequestAsserts: ((url: string, init: RequestInit) => void) | null;
}

async function makeIdpFixture(
  issuer = "https://idp.example",
): Promise<IdpFixture> {
  const key = await makeIdpKey("idp-key-1");
  const fixture: IdpFixture = {
    issuer,
    key,
    // placeholder — replaced below
    fetcher: (async () => new Response("", { status: 500 })) as unknown as typeof fetch,
    nextTokenIdTokenClaims: null,
    nextTokenOverrideHeader: null,
    nextTokenResponseBody: null,
    nextTokenResponseStatus: null,
    discoveryOverride: null,
    jwksOverride: null,
    tokenRequestAsserts: null,
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
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.endsWith("/.well-known/openid-configuration")) {
      const body = fixture.discoveryOverride ?? baseDiscovery;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url === `${issuer}/jwks`) {
      const jwks = fixture.jwksOverride ?? { keys: [fixture.key.publicJwk] };
      return new Response(JSON.stringify(jwks), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url === `${issuer}/token`) {
      if (fixture.tokenRequestAsserts) {
        fixture.tokenRequestAsserts(url, init ?? {});
      }
      if (fixture.nextTokenResponseBody) {
        return new Response(JSON.stringify(fixture.nextTokenResponseBody), {
          status: fixture.nextTokenResponseStatus ?? 200,
          headers: { "content-type": "application/json" },
        });
      }
      const claims = fixture.nextTokenIdTokenClaims ?? baseClaimsFor(fixture);
      const header = fixture.nextTokenOverrideHeader ?? {
        alg: "ES256",
        kid: fixture.key.kid,
        typ: "JWT",
      };
      const idToken = await signJwt(fixture.key, header, claims);
      return new Response(
        JSON.stringify({
          id_token: idToken,
          access_token: "at-abc",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "openid email profile",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(`unexpected ${url}`, { status: 404 });
  };

  fixture.fetcher = vi.fn(handler) as unknown as typeof fetch;
  return fixture;
}

function baseClaimsFor(f: IdpFixture): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: f.issuer,
    sub: "idp-user-42",
    aud: "client-abc",
    exp: now + 300,
    iat: now,
    nonce: "SET-IN-TEST",
    email: "ada@example.com",
    email_verified: true,
    name: "Ada Lovelace",
    given_name: "Ada",
    family_name: "Lovelace",
  };
}

// ── Shared flow helper ──────────────────────────────────────────────────────

async function setupFlow(opts: {
  issuer: string;
  tenantId?: string;
  providerId?: string;
  returnTo?: string;
  pinEndpoints?: boolean;
  autoProvision?: boolean;
}) {
  const tenantId = opts.tenantId ?? "tenant-A";
  const providerId = opts.providerId ?? "google";

  // State cookie payload.
  const state = randomUrlSafe(32);
  const nonce = randomUrlSafe(32);
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await codeChallengeS256(codeVerifier);
  void codeChallenge; // The /authorize call is implicit in these tests.

  const now = Date.now();
  const statePayload: OidcStatePayload = {
    v: 1,
    state,
    nonce,
    codeVerifier,
    tenantId,
    providerId,
    returnTo: opts.returnTo,
    iat: now,
    exp: now + OIDC_STATE_TTL_MS,
  };
  const signed = await signOidcState(statePayload);

  const provider: OidcProviderConfig = {
    id: providerId,
    label: "Google",
    issuer: opts.issuer,
    clientId: "client-abc",
    clientSecret: "secret-xyz",
  };
  if (opts.pinEndpoints) {
    provider.authorizationEndpoint = `${opts.issuer}/auth`;
    provider.tokenEndpoint = `${opts.issuer}/token`;
    provider.jwksUri = `${opts.issuer}/jwks`;
  }

  return {
    state,
    nonce,
    codeVerifier,
    statePayload,
    signedStateCookie: signed,
    provider,
    tenantId,
    providerId,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetDiscoveryCache();
  resetJwksCache();
});

describe("completeOidcCallback — happy path", () => {
  it("verifies the full flow and projects the identity", async () => {
    const idp = await makeIdpFixture();
    const flow = await setupFlow({
      issuer: idp.issuer,
      returnTo: "https://app.evk/home",
    });
    idp.nextTokenIdTokenClaims = {
      ...baseClaimsFor(idp),
      nonce: flow.nonce,
    };
    // Assert the /token call uses PKCE verifier + basic auth.
    idp.tokenRequestAsserts = (_url, init) => {
      const hdrs = new Headers(init.headers ?? {});
      expect(hdrs.get("authorization")).toMatch(/^Basic /);
      const form = new URLSearchParams(String(init.body));
      expect(form.get("code")).toBe("code-abc");
      expect(form.get("code_verifier")).toBe(flow.codeVerifier);
      expect(form.get("grant_type")).toBe("authorization_code");
    };

    const r = await completeOidcCallback({
      stateCookie: flow.signedStateCookie,
      stateQuery: flow.state,
      codeQuery: "code-abc",
      expectedTenantId: flow.tenantId,
      expectedProviderId: flow.providerId,
      provider: flow.provider,
      redirectUri: "https://app.evk/auth/callback",
      fetcher: idp.fetcher,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.identity.sub).toBe("idp-user-42");
      expect(r.identity.email).toBe("ada@example.com");
      expect(r.identity.name).toBe("Ada Lovelace");
      expect(r.state.returnTo).toBe("https://app.evk/home");
      expect(r.tokens.access_token).toBe("at-abc");
      expect(r.discovery.token_endpoint).toBe(`${idp.issuer}/token`);
    }
  });

  it("skips discovery when provider endpoints are pinned", async () => {
    const idp = await makeIdpFixture();
    const flow = await setupFlow({ issuer: idp.issuer, pinEndpoints: true });
    idp.nextTokenIdTokenClaims = {
      ...baseClaimsFor(idp),
      nonce: flow.nonce,
    };

    const r = await completeOidcCallback({
      stateCookie: flow.signedStateCookie,
      stateQuery: flow.state,
      codeQuery: "code-x",
      expectedTenantId: flow.tenantId,
      expectedProviderId: flow.providerId,
      provider: flow.provider,
      redirectUri: "https://app.evk/auth/callback",
      fetcher: idp.fetcher,
    });
    expect(r.ok).toBe(true);

    const calls = (idp.fetcher as unknown as { mock: { calls: unknown[][] } })
      .mock.calls;
    const urls = calls.map((c) =>
      typeof c[0] === "string"
        ? c[0]
        : c[0] instanceof URL
          ? c[0].toString()
          : (c[0] as Request).url,
    );
    expect(urls.some((u) => u.includes("/.well-known/"))).toBe(false);
    expect(urls).toContain(`${idp.issuer}/token`);
    expect(urls).toContain(`${idp.issuer}/jwks`);
  });
});

describe("completeOidcCallback — state-cookie stage failures", () => {
  it("fails state_cookie/missing when no cookie is supplied", async () => {
    const idp = await makeIdpFixture();
    const flow = await setupFlow({ issuer: idp.issuer });
    const r = await completeOidcCallback({
      stateCookie: null,
      stateQuery: flow.state,
      codeQuery: "c",
      expectedTenantId: flow.tenantId,
      expectedProviderId: flow.providerId,
      provider: flow.provider,
      redirectUri: "https://app.evk/auth/callback",
      fetcher: idp.fetcher,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.stage).toBe("state_cookie");
      if (r.failure.stage === "state_cookie")
        expect(r.failure.reason).toBe("missing");
    }
  });

  it("fails state_cookie/bad_signature when cookie is tampered", async () => {
    const idp = await makeIdpFixture();
    const flow = await setupFlow({ issuer: idp.issuer });
    const [payload, sig] = flow.signedStateCookie.split(".");
    const tampered = payload + "." + sig.slice(0, -2) + "aa";
    const r = await completeOidcCallback({
      stateCookie: tampered,
      stateQuery: flow.state,
      codeQuery: "c",
      expectedTenantId: flow.tenantId,
      expectedProviderId: flow.providerId,
      provider: flow.provider,
      redirectUri: "https://app.evk/auth/callback",
      fetcher: idp.fetcher,
    });
    expect(r.ok).toBe(false);
    if (!r.ok && r.failure.stage === "state_cookie") {
      expect(r.failure.reason).toBe("bad_signature");
    }
  });

  it("fails state_match/missing_query when state param is absent", async () => {
    const idp = await makeIdpFixture();
    const flow = await setupFlow({ issuer: idp.issuer });
    const r = await completeOidcCallback({
      stateCookie: flow.signedStateCookie,
      stateQuery: null,
      codeQuery: "c",
      expectedTenantId: flow.tenantId,
      expectedProviderId: flow.providerId,
      provider: flow.provider,
      redirectUri: "https://app.evk/auth/callback",
      fetcher: idp.fetcher,
    });
    expect(r.ok).toBe(false);
    if (!r.ok && r.failure.stage === "state_match")
      expect(r.failure.reason).toBe("missing_query");
  });

  it("fails state_match/state_mismatch when state differs", async () => {
    const idp = await makeIdpFixture();
    const flow = await setupFlow({ issuer: idp.issuer });
    const r = await completeOidcCallback({
      stateCookie: flow.signedStateCookie,
      stateQuery: "some-other-state",
      codeQuery: "c",
      expectedTenantId: flow.tenantId,
      expectedProviderId: flow.providerId,
      provider: flow.provider,
      redirectUri: "https://app.evk/auth/callback",
      fetcher: idp.fetcher,
    });
    expect(r.ok).toBe(false);
    if (!r.ok && r.failure.stage === "state_match")
      expect(r.failure.reason).toBe("state_mismatch");
  });

  it("fails context_match/tenant_mismatch when path tenant diverges", async () => {
    const idp = await makeIdpFixture();
    const flow = await setupFlow({
      issuer: idp.issuer,
      tenantId: "tenant-A",
    });
    const r = await completeOidcCallback({
      stateCookie: flow.signedStateCookie,
      stateQuery: flow.state,
      codeQuery: "c",
      expectedTenantId: "tenant-B", // attacker rerouted
      expectedProviderId: flow.providerId,
      provider: flow.provider,
      redirectUri: "https://app.evk/auth/callback",
      fetcher: idp.fetcher,
    });
    expect(r.ok).toBe(false);
    if (!r.ok && r.failure.stage === "context_match")
      expect(r.failure.reason).toBe("tenant_mismatch");
  });

  it("fails context_match/provider_mismatch when path provider diverges", async () => {
    const idp = await makeIdpFixture();
    const flow = await setupFlow({
      issuer: idp.issuer,
      providerId: "google",
    });
    const r = await completeOidcCallback({
      stateCookie: flow.signedStateCookie,
      stateQuery: flow.state,
      codeQuery: "c",
      expectedTenantId: flow.tenantId,
      expectedProviderId: "azure-ad",
      provider: { ...flow.provider, id: "azure-ad" },
      redirectUri: "https://app.evk/auth/callback",
      fetcher: idp.fetcher,
    });
    expect(r.ok).toBe(false);
    if (!r.ok && r.failure.stage === "context_match")
      expect(r.failure.reason).toBe("provider_mismatch");
  });

  it("fails code/missing_code when code query param is absent", async () => {
    const idp = await makeIdpFixture();
    const flow = await setupFlow({ issuer: idp.issuer });
    const r = await completeOidcCallback({
      stateCookie: flow.signedStateCookie,
      stateQuery: flow.state,
      codeQuery: null,
      expectedTenantId: flow.tenantId,
      expectedProviderId: flow.providerId,
      provider: flow.provider,
      redirectUri: "https://app.evk/auth/callback",
      fetcher: idp.fetcher,
    });
    expect(r.ok).toBe(false);
    if (!r.ok && r.failure.stage === "code")
      expect(r.failure.reason).toBe("missing_code");
  });
});

describe("completeOidcCallback — downstream stage failures", () => {
  it("surfaces discovery failures", async () => {
    const idp = await makeIdpFixture();
    const flow = await setupFlow({ issuer: idp.issuer });
    // Force discovery to return a mismatched issuer.
    idp.discoveryOverride = {
      issuer: "https://other.example", // attacker claim
      authorization_endpoint: `${idp.issuer}/auth`,
      token_endpoint: `${idp.issuer}/token`,
      jwks_uri: `${idp.issuer}/jwks`,
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["ES256"],
    };
    const r = await completeOidcCallback({
      stateCookie: flow.signedStateCookie,
      stateQuery: flow.state,
      codeQuery: "c",
      expectedTenantId: flow.tenantId,
      expectedProviderId: flow.providerId,
      provider: flow.provider,
      redirectUri: "https://app.evk/auth/callback",
      fetcher: idp.fetcher,
    });
    expect(r.ok).toBe(false);
    if (!r.ok && r.failure.stage === "discovery")
      expect(r.failure.reason).toBe("issuer_mismatch");
  });

  it("surfaces token-exchange failures", async () => {
    const idp = await makeIdpFixture();
    const flow = await setupFlow({ issuer: idp.issuer });
    idp.nextTokenResponseBody = {
      error: "invalid_grant",
      error_description: "PKCE failed",
    };
    idp.nextTokenResponseStatus = 400;
    const r = await completeOidcCallback({
      stateCookie: flow.signedStateCookie,
      stateQuery: flow.state,
      codeQuery: "c",
      expectedTenantId: flow.tenantId,
      expectedProviderId: flow.providerId,
      provider: flow.provider,
      redirectUri: "https://app.evk/auth/callback",
      fetcher: idp.fetcher,
    });
    expect(r.ok).toBe(false);
    if (!r.ok && r.failure.stage === "token_exchange") {
      expect(r.failure.reason).toBe("oauth_error");
      expect(r.failure.detail).toContain("invalid_grant");
    }
  });

  it("surfaces id_token failures when nonce is wrong", async () => {
    const idp = await makeIdpFixture();
    const flow = await setupFlow({ issuer: idp.issuer });
    idp.nextTokenIdTokenClaims = {
      ...baseClaimsFor(idp),
      nonce: "WRONG-NONCE",
    };
    const r = await completeOidcCallback({
      stateCookie: flow.signedStateCookie,
      stateQuery: flow.state,
      codeQuery: "c",
      expectedTenantId: flow.tenantId,
      expectedProviderId: flow.providerId,
      provider: flow.provider,
      redirectUri: "https://app.evk/auth/callback",
      fetcher: idp.fetcher,
    });
    expect(r.ok).toBe(false);
    if (!r.ok && r.failure.stage === "id_token")
      expect(r.failure.reason).toContain("nonce_mismatch");
  });
});

// ── Identity resolution + session establishment ─────────────────────────────

describe("resolveOidcIdentity", () => {
  let store: DistrictStore;

  beforeEach(async () => {
    store = createInMemoryDistrictStore();
    await store.createTenant({ name: "Tenant A" });
  });

  async function makeIdentity(sub: string, email: string, name?: string) {
    return {
      ok: true as const,
      payload: { sub, email, name, iss: "x", aud: "y", nonce: "n" },
      sub,
      iss: "https://idp.example",
      aud: ["client-abc"],
      email,
      emailVerified: true,
      name,
      givenName: undefined,
      familyName: undefined,
      picture: undefined,
      locale: undefined,
    };
  }

  it("auto-provisions a new user on first login", async () => {
    const tenant = (await store.listTenants())[0];
    const r = await resolveOidcIdentity({
      store,
      tenantId: tenant.id,
      providerId: "google",
      identity: await makeIdentity("sub-1", "a@b", "Alice"),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.isNewUser).toBe(true);
      expect(r.user.externalId).toBe("google:sub-1");
      expect(r.user.displayName).toBe("Alice");
      expect(r.user.email).toBe("a@b");
      expect(r.user.active).toBe(true);
    }
  });

  it("finds an existing user on subsequent login", async () => {
    const tenant = (await store.listTenants())[0];
    const first = await resolveOidcIdentity({
      store,
      tenantId: tenant.id,
      providerId: "google",
      identity: await makeIdentity("sub-1", "a@b", "Alice"),
    });
    expect(first.ok).toBe(true);
    const second = await resolveOidcIdentity({
      store,
      tenantId: tenant.id,
      providerId: "google",
      identity: await makeIdentity("sub-1", "a@b", "Alice"),
    });
    expect(second.ok).toBe(true);
    if (second.ok && first.ok) {
      expect(second.isNewUser).toBe(false);
      expect(second.user.id).toBe(first.user.id);
    }
  });

  it("refreshes display name / email on re-login when they changed upstream", async () => {
    const tenant = (await store.listTenants())[0];
    await resolveOidcIdentity({
      store,
      tenantId: tenant.id,
      providerId: "google",
      identity: await makeIdentity("sub-1", "old@b", "Old Name"),
    });
    const r = await resolveOidcIdentity({
      store,
      tenantId: tenant.id,
      providerId: "google",
      identity: await makeIdentity("sub-1", "new@b", "New Name"),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.user.displayName).toBe("New Name");
      expect(r.user.email).toBe("new@b");
    }
  });

  it("rejects unknown users when autoProvision=false", async () => {
    const tenant = (await store.listTenants())[0];
    const r = await resolveOidcIdentity({
      store,
      tenantId: tenant.id,
      providerId: "google",
      identity: await makeIdentity("sub-2", "x@y"),
      autoProvision: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown_user");
  });

  it("rejects inactive existing users", async () => {
    const tenant = (await store.listTenants())[0];
    const first = await resolveOidcIdentity({
      store,
      tenantId: tenant.id,
      providerId: "google",
      identity: await makeIdentity("sub-3", "a@b", "Alice"),
    });
    expect(first.ok).toBe(true);
    if (first.ok) {
      await store.updateUser(tenant.id, first.user.id, { active: false });
    }
    const second = await resolveOidcIdentity({
      store,
      tenantId: tenant.id,
      providerId: "google",
      identity: await makeIdentity("sub-3", "a@b", "Alice"),
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("user_inactive");
  });

  it("namespaces externalId by providerId", async () => {
    const tenant = (await store.listTenants())[0];
    const g = await resolveOidcIdentity({
      store,
      tenantId: tenant.id,
      providerId: "google",
      identity: await makeIdentity("same-sub", "a@b"),
    });
    const a = await resolveOidcIdentity({
      store,
      tenantId: tenant.id,
      providerId: "azure-ad",
      identity: await makeIdentity("same-sub", "a@b"),
    });
    expect(g.ok && a.ok).toBe(true);
    if (g.ok && a.ok) expect(g.user.id).not.toBe(a.user.id);
  });
});

// ── Full-stack: callback + resolveIdentity + establishSession ───────────────

describe("OIDC callback → establishSession", () => {
  it("stitches verified identity into a passkey-bound session", async () => {
    const idp = await makeIdpFixture();
    const flow = await setupFlow({ issuer: idp.issuer });
    idp.nextTokenIdTokenClaims = {
      ...baseClaimsFor(idp),
      nonce: flow.nonce,
    };

    const store = createInMemoryDistrictStore();
    const tenant = await store.createTenant({ name: "SSO Test Tenant" });

    // Pre-enrol a passkey for this user (simulating a device that
    // completed enrolment during an earlier login).
    // The user doesn't exist yet — resolveOidcIdentity will create them.
    const cb = await completeOidcCallback({
      stateCookie: flow.signedStateCookie,
      stateQuery: flow.state,
      codeQuery: "code-abc",
      expectedTenantId: flow.tenantId,
      expectedProviderId: flow.providerId,
      provider: flow.provider,
      redirectUri: "https://app.evk/auth/callback",
      fetcher: idp.fetcher,
    });
    expect(cb.ok).toBe(true);
    if (!cb.ok) return;

    const resolved = await resolveOidcIdentity({
      store,
      tenantId: tenant.id,
      providerId: flow.providerId,
      identity: cb.identity,
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    // Register a placeholder passkey so establishSession has something to bind to.
    await store.addPasskeyCredential(tenant.id, resolved.user.id, {
      credentialIdB64url: "cred-synth-1",
      spkiB64url: "spki-synth-1",
      signCount: 0,
      label: "Fake test passkey",
    });

    const session = await establishSession({
      store,
      tenantId: tenant.id,
      userId: resolved.user.id,
      credentialIdB64url: "cred-synth-1",
      roles: ["learner"],
      source: `sso.oidc.${flow.providerId}`,
    });

    expect(session.refreshToken).toBeTruthy();
    expect(session.accessToken).toBeTruthy();
    expect(session.accessPayload.tenantId).toBe(tenant.id);
    expect(session.accessPayload.userId).toBe(resolved.user.id);
    expect(session.accessPayload.roles).toContain("learner");

    const audit = await store.listAudit(tenant.id);
    const establishedEvents = audit.filter(
      (a: AuditEvent) => a.action === "district.session.established",
    );
    expect(establishedEvents.length).toBe(1);
    expect(establishedEvents[0].detail).toMatchObject({
      source: `sso.oidc.${flow.providerId}`,
    });
  });
});
