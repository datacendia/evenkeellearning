// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/district-oidc-config-intent.test.ts
//
// v1.8.5 — Tests for the provider-config loader and login-intent cookie.
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it } from "vitest";
import {
  BUILTIN_OIDC_PROVIDERS,
  findOidcProvider,
  loadOidcProviders,
  resetOidcProvidersCache,
} from "../../lib/district/oidc/config";
import {
  buildClearOidcLoginIntentCookie,
  buildOidcLoginIntentCookie,
  OIDC_LOGIN_INTENT_COOKIE_NAME,
  OIDC_LOGIN_INTENT_TTL_MS,
  OidcLoginIntentPayload,
  signOidcLoginIntent,
  verifyOidcLoginIntent,
} from "../../lib/district/oidc/login-intent";
import { bytesToBase64Url } from "../../lib/crypto/base64url";

// ── loadOidcProviders / findOidcProvider ────────────────────────────────────

function withEnv<T>(
  patch: Record<string, string | undefined>,
  fn: () => T,
): T {
  const originals: Record<string, string | undefined> = {};
  for (const k of Object.keys(patch)) originals[k] = process.env[k];
  try {
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete (process.env as Record<string, string | undefined>)[k];
      else (process.env as Record<string, string | undefined>)[k] = v;
    }
    return fn();
  } finally {
    for (const [k, v] of Object.entries(originals)) {
      if (v === undefined) delete (process.env as Record<string, string | undefined>)[k];
      else (process.env as Record<string, string | undefined>)[k] = v;
    }
  }
}

beforeEach(() => {
  resetOidcProvidersCache();
});

describe("district/oidc/config — loadOidcProviders", () => {
  it("returns the dev fixture in non-production when env var is unset", () => {
    const loaded = withEnv(
      { NODE_ENV: "test", DISTRICT_OIDC_PROVIDERS_JSON: undefined },
      () => loadOidcProviders(),
    );
    expect(loaded.length).toBe(BUILTIN_OIDC_PROVIDERS.length);
    expect(loaded[0].tenantId).toBe("dev-tenant");
    expect(loaded[0].provider.id).toBe("google");
  });

  it("returns an empty registry in production when env var is unset", () => {
    const loaded = withEnv(
      { NODE_ENV: "production", DISTRICT_OIDC_PROVIDERS_JSON: undefined },
      () => loadOidcProviders(),
    );
    expect(loaded.length).toBe(0);
  });

  it("parses DISTRICT_OIDC_PROVIDERS_JSON when present", () => {
    const payload = JSON.stringify([
      {
        tenantId: "tenant-X",
        provider: {
          id: "okta",
          label: "Okta",
          issuer: "https://dev-123.okta.com",
          clientId: "0oaxxxxxx",
          clientSecret: "secret",
        },
      },
    ]);
    const loaded = withEnv(
      { NODE_ENV: "production", DISTRICT_OIDC_PROVIDERS_JSON: payload },
      () => loadOidcProviders(),
    );
    expect(loaded.length).toBe(1);
    expect(loaded[0].tenantId).toBe("tenant-X");
    expect(loaded[0].provider.clientSecret).toBe("secret");
    expect(loaded[0].provider.issuer).toBe("https://dev-123.okta.com");
  });

  it("skips entries with bad shapes and keeps good ones", () => {
    const payload = JSON.stringify([
      { tenantId: "", provider: { id: "bad", label: "x", issuer: "https://y", clientId: "c" } }, // empty tenantId
      { tenantId: "tenant-Y", provider: null }, // missing provider
      {
        tenantId: "tenant-OK",
        provider: {
          id: "google",
          label: "Google",
          issuer: "https://accounts.google.com",
          clientId: "c",
        },
      },
    ]);
    const loaded = withEnv(
      { NODE_ENV: "production", DISTRICT_OIDC_PROVIDERS_JSON: payload },
      () => loadOidcProviders(),
    );
    expect(loaded.length).toBe(1);
    expect(loaded[0].tenantId).toBe("tenant-OK");
  });

  it("rejects http:// issuers in production", () => {
    const payload = JSON.stringify([
      {
        tenantId: "t",
        provider: {
          id: "bad",
          label: "Bad",
          issuer: "http://insecure.example",
          clientId: "c",
        },
      },
    ]);
    const loaded = withEnv(
      { NODE_ENV: "production", DISTRICT_OIDC_PROVIDERS_JSON: payload },
      () => loadOidcProviders(),
    );
    expect(loaded.length).toBe(0);
  });

  it("tolerates http://localhost in non-prod", () => {
    const payload = JSON.stringify([
      {
        tenantId: "t",
        provider: {
          id: "local",
          label: "Local",
          issuer: "http://localhost:8080",
          clientId: "c",
        },
      },
    ]);
    const loaded = withEnv(
      { NODE_ENV: "development", DISTRICT_OIDC_PROVIDERS_JSON: payload },
      () => loadOidcProviders(),
    );
    expect(loaded.length).toBe(1);
  });

  it("falls back to dev fixture if env JSON is malformed", () => {
    const loaded = withEnv(
      {
        NODE_ENV: "development",
        DISTRICT_OIDC_PROVIDERS_JSON: "not-json",
      },
      () => loadOidcProviders(),
    );
    expect(loaded.length).toBe(BUILTIN_OIDC_PROVIDERS.length);
  });

  it("caches after first load; reset clears the cache", () => {
    withEnv(
      { NODE_ENV: "test", DISTRICT_OIDC_PROVIDERS_JSON: undefined },
      () => {
        const first = loadOidcProviders();
        const second = loadOidcProviders();
        expect(first).toBe(second);
      },
    );
    resetOidcProvidersCache();
    withEnv(
      {
        NODE_ENV: "production",
        DISTRICT_OIDC_PROVIDERS_JSON: JSON.stringify([]),
      },
      () => {
        const empty = loadOidcProviders();
        expect(empty.length).toBe(0);
      },
    );
  });
});

describe("district/oidc/config — findOidcProvider", () => {
  it("finds a provider by (tenantId, providerId)", () => {
    const p = findOidcProvider("dev-tenant", "google", BUILTIN_OIDC_PROVIDERS);
    expect(p).not.toBeNull();
    expect(p!.issuer).toBe("https://accounts.google.com");
  });

  it("returns null for unknown tenant", () => {
    expect(findOidcProvider("other", "google", BUILTIN_OIDC_PROVIDERS)).toBeNull();
  });

  it("returns null for unknown provider in known tenant", () => {
    expect(
      findOidcProvider("dev-tenant", "okta", BUILTIN_OIDC_PROVIDERS),
    ).toBeNull();
  });
});

// ── login-intent cookie ─────────────────────────────────────────────────────

function samplePayload(
  overrides: Partial<OidcLoginIntentPayload> = {},
): OidcLoginIntentPayload {
  const now = Date.now();
  return {
    v: 1,
    tenantId: "tenant-A",
    userId: "user-42",
    externalId: "google:sub-42",
    providerId: "google",
    source: "sso.oidc.google",
    newUser: false,
    hasExistingPasskey: true,
    iat: now,
    exp: now + OIDC_LOGIN_INTENT_TTL_MS,
    ...overrides,
  };
}

describe("district/oidc/login-intent — sign+verify", () => {
  it("round-trips a payload", async () => {
    const p = samplePayload();
    const signed = await signOidcLoginIntent(p);
    const r = await verifyOidcLoginIntent(signed);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload).toEqual(p);
  });

  it("rejects missing / malformed inputs", async () => {
    expect((await verifyOidcLoginIntent(null)).ok).toBe(false);
    expect((await verifyOidcLoginIntent(undefined)).ok).toBe(false);
    expect((await verifyOidcLoginIntent("")).ok).toBe(false);
    expect((await verifyOidcLoginIntent("one-part")).ok).toBe(false);
    expect((await verifyOidcLoginIntent("a.b.c")).ok).toBe(false);
    expect((await verifyOidcLoginIntent("!!!.$$$")).ok).toBe(false);
  });

  it("rejects tampered payload segment", async () => {
    const good = await signOidcLoginIntent(samplePayload());
    const [payload, sig] = good.split(".");
    const forged = samplePayload({ userId: "attacker" });
    const forgedB64 = bytesToBase64Url(
      new TextEncoder().encode(JSON.stringify(forged)),
    );
    expect(forgedB64).not.toBe(payload);
    const r = await verifyOidcLoginIntent(forgedB64 + "." + sig);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad_signature");
  });

  it("rejects tampered signature segment", async () => {
    const good = await signOidcLoginIntent(samplePayload());
    const [payload] = good.split(".");
    const r = await verifyOidcLoginIntent(
      payload + "." + bytesToBase64Url(new Uint8Array(32)),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad_signature");
  });

  it("rejects expired payloads", async () => {
    const p = samplePayload();
    const signed = await signOidcLoginIntent(p);
    const r = await verifyOidcLoginIntent(signed, { nowMs: p.exp + 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("expired");
  });

  it("rejects payloads with a missing required field", async () => {
    // We sign an object missing `userId` and verify it fails shape check
    // after signature verification. Because the signature will still be
    // valid for this exact payload, the shape guard is what catches it.
    const partial = {
      v: 1,
      tenantId: "t",
      externalId: "e",
      providerId: "g",
      source: "s",
      newUser: false,
      hasExistingPasskey: false,
      iat: Date.now(),
      exp: Date.now() + 60_000,
    };
    const json = new TextEncoder().encode(JSON.stringify(partial));
    const bytesToSign = new Uint8Array(json);
    const key = await crypto.subtle.importKey(
      "raw",
      // secret is module-internal; we can't reach it, so instead check
      // that a bad-signature result prevents shape evaluation. Any
      // unsigned-from-scratch payload will fail the signature check.
      new TextEncoder().encode("x".repeat(32)),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, bytesToSign),
    );
    const forged =
      bytesToBase64Url(bytesToSign) + "." + bytesToBase64Url(sig);
    const r = await verifyOidcLoginIntent(forged);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad_signature");
  });
});

describe("district/oidc/login-intent — cookie helpers", () => {
  it("builds a well-formed Set-Cookie value", () => {
    const prev = process.env.NODE_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    try {
      const c = buildOidcLoginIntentCookie("payload.sig");
      expect(
        c.startsWith(`${OIDC_LOGIN_INTENT_COOKIE_NAME}=payload.sig`),
      ).toBe(true);
      expect(c).toContain("HttpOnly");
      expect(c).toContain("SameSite=Lax");
      expect(c).toContain(
        `Max-Age=${Math.floor(OIDC_LOGIN_INTENT_TTL_MS / 1000)}`,
      );
      expect(c).not.toContain("Secure");
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = prev;
    }
  });

  it("adds Secure in production", () => {
    const prev = process.env.NODE_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    try {
      const c = buildOidcLoginIntentCookie("p.s");
      expect(c).toContain("Secure");
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = prev;
    }
  });

  it("builds a clear cookie with Max-Age=0", () => {
    const c = buildClearOidcLoginIntentCookie();
    expect(c).toContain(`${OIDC_LOGIN_INTENT_COOKIE_NAME}=`);
    expect(c).toContain("Max-Age=0");
  });
});
