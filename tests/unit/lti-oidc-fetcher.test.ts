// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/lti-oidc-fetcher.test.ts
//
// v1.8.0 — Tests for the OIDC login parsing/redirect helpers and the
// JWKS fetcher's caching + safety logic.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from "vitest";
import {
  buildAuthRedirectUrl,
  parseLoginInitiation,
} from "../../lib/lti/oidc";
import {
  fetchJwks,
  isAcceptableJwksUrl,
  resetJwksCache,
} from "../../lib/lti/jwks-fetcher";

describe("lti/oidc — parseLoginInitiation", () => {
  function p(o: Record<string, string>): URLSearchParams {
    return new URLSearchParams(o);
  }

  it("parses a complete request", () => {
    const r = parseLoginInitiation(
      p({
        iss: "https://canvas.instructure.com",
        login_hint: "user-42",
        target_link_uri: "https://app.example/learner",
        client_id: "client-1",
        lti_message_hint: "hint-x",
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.params.iss).toBe("https://canvas.instructure.com");
      expect(r.params.loginHint).toBe("user-42");
      expect(r.params.targetLinkUri).toBe("https://app.example/learner");
      expect(r.params.clientId).toBe("client-1");
      expect(r.params.ltiMessageHint).toBe("hint-x");
    }
  });

  it("rejects when iss is missing", () => {
    const r = parseLoginInitiation(
      p({ login_hint: "u", target_link_uri: "https://x/y" }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_iss");
  });

  it("rejects when login_hint is missing", () => {
    const r = parseLoginInitiation(
      p({ iss: "https://x", target_link_uri: "https://x/y" }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_login_hint");
  });

  it("rejects when target_link_uri is missing", () => {
    const r = parseLoginInitiation(p({ iss: "https://x", login_hint: "u" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_target_link_uri");
  });

  it("rejects an unparseable target_link_uri", () => {
    const r = parseLoginInitiation(
      p({
        iss: "https://x",
        login_hint: "u",
        target_link_uri: "not-a-url",
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_target_link_uri");
  });
});

describe("lti/oidc — buildAuthRedirectUrl", () => {
  it("constructs an LMS auth URL with all required OIDC parameters", () => {
    const url = buildAuthRedirectUrl({
      authLoginUrl: "https://canvas.instructure.com/api/lti/authorize_redirect",
      clientId: "client-1",
      redirectUri: "https://app.example/api/lti/launch",
      loginHint: "user-42",
      nonce: "n-1",
      state: "s-1",
      ltiMessageHint: "mh-1",
    });
    const u = new URL(url);
    expect(u.origin).toBe("https://canvas.instructure.com");
    expect(u.searchParams.get("scope")).toBe("openid");
    expect(u.searchParams.get("response_type")).toBe("id_token");
    expect(u.searchParams.get("response_mode")).toBe("form_post");
    expect(u.searchParams.get("prompt")).toBe("none");
    expect(u.searchParams.get("client_id")).toBe("client-1");
    expect(u.searchParams.get("redirect_uri")).toBe(
      "https://app.example/api/lti/launch",
    );
    expect(u.searchParams.get("login_hint")).toBe("user-42");
    expect(u.searchParams.get("nonce")).toBe("n-1");
    expect(u.searchParams.get("state")).toBe("s-1");
    expect(u.searchParams.get("lti_message_hint")).toBe("mh-1");
  });

  it("omits lti_message_hint when not supplied", () => {
    const url = buildAuthRedirectUrl({
      authLoginUrl: "https://canvas.instructure.com/api/lti/authorize_redirect",
      clientId: "client-1",
      redirectUri: "https://app.example/api/lti/launch",
      loginHint: "user-42",
      nonce: "n-1",
      state: "s-1",
    });
    const u = new URL(url);
    expect(u.searchParams.has("lti_message_hint")).toBe(false);
  });

  it("preserves pre-existing query parameters on the authLoginUrl", () => {
    const url = buildAuthRedirectUrl({
      authLoginUrl: "https://lms.test/auth?platform=canvas",
      clientId: "client-1",
      redirectUri: "https://app.example/api/lti/launch",
      loginHint: "user-42",
      nonce: "n-1",
      state: "s-1",
    });
    const u = new URL(url);
    expect(u.searchParams.get("platform")).toBe("canvas");
    expect(u.searchParams.get("client_id")).toBe("client-1");
  });
});

describe("lti/jwks-fetcher — isAcceptableJwksUrl", () => {
  it("accepts https URLs", () => {
    expect(isAcceptableJwksUrl("https://lms.test/jwks")).toBe(true);
  });

  it("rejects http URLs to non-localhost hosts", () => {
    expect(isAcceptableJwksUrl("http://lms.test/jwks")).toBe(false);
  });

  it("accepts http://localhost in dev", () => {
    expect(isAcceptableJwksUrl("http://localhost:4000/jwks")).toBe(true);
  });

  it("rejects unparseable URLs", () => {
    expect(isAcceptableJwksUrl("not a url")).toBe(false);
  });
});

describe("lti/jwks-fetcher — fetchJwks", () => {
  beforeEach(() => resetJwksCache());

  function mockFetcher(
    impl: (url: string) => Promise<{
      status: number;
      json: () => Promise<unknown>;
      ok?: boolean;
    }>,
  ): typeof fetch {
    return (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      const r = await impl(url);
      return {
        ok: r.ok ?? (r.status >= 200 && r.status < 300),
        status: r.status,
        json: r.json,
      } as Response;
    }) as typeof fetch;
  }

  it("fetches and parses a well-formed JWKS", async () => {
    const fetcher = mockFetcher(async () => ({
      status: 200,
      json: async () => ({ keys: [{ kty: "RSA", n: "x", e: "y", kid: "1" }] }),
    }));
    const r = await fetchJwks("https://lms.test/jwks", { fetcher });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.jwks.keys.length).toBe(1);
      expect(r.cached).toBe(false);
    }
  });

  it("returns cached on the second call within the TTL", async () => {
    let hits = 0;
    const fetcher = mockFetcher(async () => {
      hits++;
      return {
        status: 200,
        json: async () => ({ keys: [{ kty: "RSA", n: "x", e: "y" }] }),
      };
    });
    const first = await fetchJwks("https://lms.test/jwks", { fetcher });
    expect(first.ok).toBe(true);
    const second = await fetchJwks("https://lms.test/jwks", { fetcher });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.cached).toBe(true);
    expect(hits).toBe(1);
  });

  it("re-fetches when the cache TTL has expired", async () => {
    let hits = 0;
    const fetcher = mockFetcher(async () => {
      hits++;
      return {
        status: 200,
        json: async () => ({ keys: [{ kty: "RSA", n: "x", e: "y" }] }),
      };
    });
    await fetchJwks("https://lms.test/jwks", {
      fetcher,
      cacheTtlMs: 100,
      nowMs: 1000,
    });
    await fetchJwks("https://lms.test/jwks", {
      fetcher,
      cacheTtlMs: 100,
      nowMs: 2000, // beyond TTL
    });
    expect(hits).toBe(2);
  });

  it("refuses non-https, non-localhost URLs", async () => {
    const fetcher = mockFetcher(async () => ({
      status: 200,
      json: async () => ({ keys: [] }),
    }));
    const r = await fetchJwks("http://lms.test/jwks", { fetcher });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unsafe_url");
  });

  it("returns bad_status on a non-2xx response", async () => {
    const fetcher = mockFetcher(async () => ({
      status: 503,
      json: async () => ({}),
    }));
    const r = await fetchJwks("https://lms.test/jwks", { fetcher });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad_status");
  });

  it("returns bad_shape on non-JWKS payload", async () => {
    const fetcher = mockFetcher(async () => ({
      status: 200,
      json: async () => ({ not: "a-jwks" }),
    }));
    const r = await fetchJwks("https://lms.test/jwks", { fetcher });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad_shape");
  });
});
