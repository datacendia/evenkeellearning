// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/district-oidc-discovery.test.ts
//
// v1.8.4 — Tests for the OIDC discovery fetcher.
// ─────────────────────────────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DISCOVERY_CACHE_TTL_MS,
  fetchOidcDiscovery,
  resetDiscoveryCache,
} from "../../lib/district/oidc/discovery";

function mockFetcher(
  impl: (url: string, init?: RequestInit) => Promise<Response> | Response,
): typeof fetch {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    return impl(url, init);
  }) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function validDoc(issuer = "https://idp.example") {
  return {
    issuer,
    authorization_endpoint: `${issuer}/auth`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/jwks`,
    end_session_endpoint: `${issuer}/logout`,
    userinfo_endpoint: `${issuer}/userinfo`,
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256", "ES256"],
  };
}

beforeEach(() => {
  resetDiscoveryCache();
});

describe("district/oidc/discovery — happy path", () => {
  it("fetches, validates, and projects a well-formed document", async () => {
    const issuer = "https://idp.example";
    const fetcher = mockFetcher((url) => {
      expect(url).toBe(`${issuer}/.well-known/openid-configuration`);
      return jsonResponse(validDoc(issuer));
    });
    const r = await fetchOidcDiscovery(issuer, { fetcher });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.cached).toBe(false);
      expect(r.doc.issuer).toBe(issuer);
      expect(r.doc.authorization_endpoint).toBe(`${issuer}/auth`);
      expect(r.doc.token_endpoint).toBe(`${issuer}/token`);
      expect(r.doc.jwks_uri).toBe(`${issuer}/jwks`);
      expect(r.doc.end_session_endpoint).toBe(`${issuer}/logout`);
      expect(r.doc.response_types_supported).toContain("code");
      expect(r.doc.id_token_signing_alg_values_supported).toContain("RS256");
    }
  });

  it("returns a cache hit on the second call within the TTL", async () => {
    const issuer = "https://idp.example";
    let calls = 0;
    const fetcher = mockFetcher(() => {
      calls++;
      return jsonResponse(validDoc(issuer));
    });
    const first = await fetchOidcDiscovery(issuer, { fetcher, nowMs: 1000 });
    const second = await fetchOidcDiscovery(issuer, { fetcher, nowMs: 2000 });
    expect(first.ok && second.ok).toBe(true);
    if (second.ok) expect(second.cached).toBe(true);
    expect(calls).toBe(1);
  });

  it("refetches after the TTL expires", async () => {
    const issuer = "https://idp.example";
    let calls = 0;
    const fetcher = mockFetcher(() => {
      calls++;
      return jsonResponse(validDoc(issuer));
    });
    const t0 = 1000;
    const later = t0 + DEFAULT_DISCOVERY_CACHE_TTL_MS + 1;
    await fetchOidcDiscovery(issuer, { fetcher, nowMs: t0 });
    const r = await fetchOidcDiscovery(issuer, { fetcher, nowMs: later });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.cached).toBe(false);
    expect(calls).toBe(2);
  });

  it("normalises issuer: tolerates trailing slash", async () => {
    const issuer = "https://idp.example";
    const fetcher = mockFetcher((url) => {
      // Should still resolve to the same config URL.
      expect(url).toBe(`${issuer}/.well-known/openid-configuration`);
      return jsonResponse(validDoc(issuer));
    });
    const r = await fetchOidcDiscovery(`${issuer}/`, { fetcher });
    expect(r.ok).toBe(true);
  });

  it("supports issuers with a path (e.g. Keycloak realms)", async () => {
    const issuer = "https://kc.example/realms/school";
    const fetcher = mockFetcher((url) => {
      expect(url).toBe(`${issuer}/.well-known/openid-configuration`);
      return jsonResponse(validDoc(issuer));
    });
    const r = await fetchOidcDiscovery(issuer, { fetcher });
    expect(r.ok).toBe(true);
  });
});

describe("district/oidc/discovery — failure cases", () => {
  it("rejects non-HTTPS issuer in prod-like envs", async () => {
    const prev = process.env.NODE_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    try {
      const fetcher = mockFetcher(() => {
        throw new Error("should not be called");
      });
      const r = await fetchOidcDiscovery("http://idp.example", { fetcher });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("unsafe_issuer");
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = prev;
    }
  });

  it("reports fetch_failed when the fetcher throws", async () => {
    const fetcher = mockFetcher(() => {
      throw new Error("ENETUNREACH");
    });
    const r = await fetchOidcDiscovery("https://idp.example", { fetcher });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("fetch_failed");
  });

  it("reports bad_status for non-2xx", async () => {
    const fetcher = mockFetcher(() => new Response("nope", { status: 503 }));
    const r = await fetchOidcDiscovery("https://idp.example", { fetcher });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad_status");
  });

  it("reports bad_json for non-JSON body", async () => {
    const fetcher = mockFetcher(
      () =>
        new Response("<!doctype html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    );
    const r = await fetchOidcDiscovery("https://idp.example", { fetcher });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad_json");
  });

  it("reports missing_issuer when the doc omits issuer", async () => {
    const doc = validDoc() as Record<string, unknown>;
    delete doc.issuer;
    const fetcher = mockFetcher(() => jsonResponse(doc));
    const r = await fetchOidcDiscovery("https://idp.example", { fetcher });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_issuer");
  });

  it("reports issuer_mismatch when the doc advertises a different issuer", async () => {
    const doc = validDoc("https://other.example");
    const fetcher = mockFetcher(() => jsonResponse(doc));
    const r = await fetchOidcDiscovery("https://idp.example", { fetcher });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("issuer_mismatch");
  });

  it("reports missing_endpoint for each required endpoint", async () => {
    for (const field of [
      "authorization_endpoint",
      "token_endpoint",
      "jwks_uri",
    ] as const) {
      const doc = validDoc() as Record<string, unknown>;
      delete doc[field];
      const fetcher = mockFetcher(() => jsonResponse(doc));
      const r = await fetchOidcDiscovery("https://idp.example", { fetcher });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toBe("missing_endpoint");
        expect(r.detail).toBe(field);
      }
    }
  });

  it("reports unsafe_endpoint when a required endpoint is http in prod", async () => {
    const prev = process.env.NODE_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    try {
      const doc = validDoc();
      doc.token_endpoint = "http://idp.example/token";
      const fetcher = mockFetcher(() => jsonResponse(doc));
      const r = await fetchOidcDiscovery("https://idp.example", { fetcher });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("unsafe_endpoint");
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = prev;
    }
  });

  it("reports no_supported_alg when the provider advertises only foreign algs", async () => {
    const doc = validDoc();
    doc.id_token_signing_alg_values_supported = ["HS256"];
    const fetcher = mockFetcher(() => jsonResponse(doc));
    const r = await fetchOidcDiscovery("https://idp.example", { fetcher });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no_supported_alg");
  });

  it("tolerates a provider that omits id_token_signing_alg_values_supported", async () => {
    const doc = validDoc() as Record<string, unknown>;
    delete doc.id_token_signing_alg_values_supported;
    const fetcher = mockFetcher(() => jsonResponse(doc));
    const r = await fetchOidcDiscovery("https://idp.example", { fetcher });
    // Missing list means "we don't know", so we accept it. Signature
    // verification will still enforce supported algs at verify time.
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.id_token_signing_alg_values_supported).toEqual([]);
  });
});
