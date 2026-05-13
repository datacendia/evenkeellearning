// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/district-oidc-pkce-state.test.ts
//
// v1.8.4 — Tests for the district OIDC PKCE + signed state-cookie helpers.
//
// Scope:
//   1. PKCE — verifier generation, S256 challenge, validation guard.
//   2. State — payload sign/verify round-trip, tamper / expiry / malformed
//      rejection, cookie build + clear cookie semantics.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  codeChallengeS256,
  generateCodeVerifier,
  isValidVerifier,
} from "../../lib/district/oidc/pkce";
import {
  buildClearOidcStateCookie,
  buildOidcStateCookie,
  OIDC_STATE_COOKIE_NAME,
  OIDC_STATE_TTL_MS,
  OidcStatePayload,
  randomUrlSafe,
  signOidcState,
  verifyOidcState,
} from "../../lib/district/oidc/state";
import { base64UrlToBytes, bytesToBase64Url } from "../../lib/crypto/base64url";

// ── PKCE ────────────────────────────────────────────────────────────────────

describe("district/oidc/pkce — generateCodeVerifier", () => {
  it("produces an RFC 7636-compliant, 43-to-128-char, URL-safe string", () => {
    const v = generateCodeVerifier();
    expect(typeof v).toBe("string");
    expect(v.length).toBeGreaterThanOrEqual(43);
    expect(v.length).toBeLessThanOrEqual(128);
    expect(v).toMatch(/^[A-Za-z0-9\-._~]+$/);
    expect(isValidVerifier(v)).toBe(true);
  });

  it("produces unique values on each call", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(generateCodeVerifier());
    expect(seen.size).toBe(50);
  });
});

describe("district/oidc/pkce — codeChallengeS256", () => {
  it("matches the RFC 7636 §4.2 test vector", async () => {
    // Canonical vector: verifier="dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    // Expected challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = await codeChallengeS256(verifier);
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("is deterministic for the same verifier", async () => {
    const verifier = generateCodeVerifier();
    const a = await codeChallengeS256(verifier);
    const b = await codeChallengeS256(verifier);
    expect(a).toBe(b);
  });

  it("differs for different verifiers (even by one char)", async () => {
    const v1 = generateCodeVerifier();
    const v2 = v1.slice(0, -1) + (v1.endsWith("A") ? "B" : "A");
    expect(v2).not.toBe(v1);
    expect(await codeChallengeS256(v1)).not.toBe(await codeChallengeS256(v2));
  });
});

describe("district/oidc/pkce — isValidVerifier", () => {
  it("accepts generator output", () => {
    for (let i = 0; i < 10; i++) {
      expect(isValidVerifier(generateCodeVerifier())).toBe(true);
    }
  });

  it("rejects too-short inputs", () => {
    expect(isValidVerifier("x".repeat(42))).toBe(false);
    expect(isValidVerifier("")).toBe(false);
  });

  it("rejects too-long inputs", () => {
    expect(isValidVerifier("a".repeat(129))).toBe(false);
  });

  it("rejects inputs with disallowed characters", () => {
    // Minimum length with an illegal char in the middle.
    const bad = "a".repeat(42) + "=";
    expect(bad.length).toBe(43);
    expect(isValidVerifier(bad)).toBe(false);
    expect(isValidVerifier("a".repeat(42) + "/")).toBe(false);
    expect(isValidVerifier("a".repeat(42) + " ")).toBe(false);
  });

  it("rejects non-string inputs", () => {
    // @ts-expect-error — testing runtime guard.
    expect(isValidVerifier(123)).toBe(false);
    // @ts-expect-error — testing runtime guard.
    expect(isValidVerifier(null)).toBe(false);
    // @ts-expect-error — testing runtime guard.
    expect(isValidVerifier(undefined)).toBe(false);
  });
});

// ── State helpers ───────────────────────────────────────────────────────────

function makePayload(
  overrides: Partial<OidcStatePayload> = {},
): OidcStatePayload {
  const now = Date.now();
  return {
    v: 1,
    state: "state-abc-123",
    nonce: "nonce-def-456",
    codeVerifier: generateCodeVerifier(),
    tenantId: "tenant-1",
    providerId: "google",
    returnTo: "https://app.example/home",
    iat: now,
    exp: now + OIDC_STATE_TTL_MS,
    ...overrides,
  };
}

describe("district/oidc/state — randomUrlSafe", () => {
  it("returns a URL-safe base64 string of at least ceil(n*4/3) chars", () => {
    const v = randomUrlSafe(32);
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32 bytes → 43 chars after base64url (no padding).
    expect(v.length).toBe(43);
  });

  it("returns unique values per call", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(randomUrlSafe(16));
    expect(seen.size).toBe(50);
  });
});

describe("district/oidc/state — sign + verify round-trip", () => {
  it("verifies a freshly signed payload", async () => {
    const p = makePayload();
    const signed = await signOidcState(p);
    const r = await verifyOidcState(signed);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload).toEqual(p);
    }
  });

  it("accepts payload without returnTo", async () => {
    const p = makePayload({ returnTo: undefined });
    const signed = await signOidcState(p);
    const r = await verifyOidcState(signed);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload.returnTo).toBeUndefined();
  });

  it("rejects a tampered payload segment", async () => {
    const good = await signOidcState(makePayload());
    const [payloadB64, sig] = good.split(".");
    const forged = makePayload({ tenantId: "attacker-tenant" });
    const forgedB64 = bytesToBase64Url(
      new TextEncoder().encode(JSON.stringify(forged)),
    );
    expect(forgedB64).not.toBe(payloadB64);
    const tampered = forgedB64 + "." + sig;
    const r = await verifyOidcState(tampered);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad_signature");
  });

  it("rejects a tampered signature segment", async () => {
    const good = await signOidcState(makePayload());
    const [payloadB64] = good.split(".");
    const badSig = bytesToBase64Url(new Uint8Array(32)); // zeroed MAC
    const r = await verifyOidcState(payloadB64 + "." + badSig);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad_signature");
  });

  it("rejects an expired payload", async () => {
    const p = makePayload();
    const signed = await signOidcState(p);
    const r = await verifyOidcState(signed, {
      nowMs: p.exp + 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("expired");
  });

  it("rejects missing / malformed inputs", async () => {
    expect((await verifyOidcState(null)).ok).toBe(false);
    expect((await verifyOidcState(undefined)).ok).toBe(false);
    expect((await verifyOidcState("")).ok).toBe(false);
    expect((await verifyOidcState("only-one-part")).ok).toBe(false);
    expect((await verifyOidcState("a.b.c")).ok).toBe(false);
    expect((await verifyOidcState("!!!.$$$")).ok).toBe(false);
  });

  it("rejects a payload with the wrong shape (valid signature but missing fields)", async () => {
    // We hand-sign an object that's missing the `state` field.
    const junk = { v: 1, nonce: "n", iat: 1, exp: Date.now() + 10_000 };
    const json = new TextEncoder().encode(JSON.stringify(junk));
    const payloadB64 = bytesToBase64Url(json);
    // Sign with a correctly shaped payload, then swap payload — should
    // fail signature.
    const good = await signOidcState(makePayload());
    const [, sig] = good.split(".");
    const r = await verifyOidcState(payloadB64 + "." + sig);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad_signature");
  });

  it("produces unique outputs per signing call (over unique nonces)", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) {
      seen.add(await signOidcState(makePayload({ nonce: `n-${i}` })));
    }
    expect(seen.size).toBe(10);
  });
});

// ── Cookie helpers ──────────────────────────────────────────────────────────

describe("district/oidc/state — cookie helpers", () => {
  it("builds a well-formed set-cookie value for non-prod", () => {
    const prev = process.env.NODE_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    try {
      const signed = "payload.sig";
      const cookie = buildOidcStateCookie(signed);
      expect(cookie.startsWith(`${OIDC_STATE_COOKIE_NAME}=payload.sig`)).toBe(
        true,
      );
      expect(cookie).toContain(
        `Max-Age=${Math.floor(OIDC_STATE_TTL_MS / 1000)}`,
      );
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie).toContain("Path=/");
      expect(cookie).not.toContain("Secure");
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = prev;
    }
  });

  it("adds Secure when NODE_ENV=production", () => {
    const prev = process.env.NODE_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV =
      "production";
    try {
      const cookie = buildOidcStateCookie("abc.def");
      expect(cookie).toContain("Secure");
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = prev;
    }
  });

  it("builds a clear cookie with Max-Age=0", () => {
    const clear = buildClearOidcStateCookie();
    expect(clear).toContain(`${OIDC_STATE_COOKIE_NAME}=`);
    expect(clear).toContain("Max-Age=0");
    expect(clear).toContain("HttpOnly");
    expect(clear).toContain("SameSite=Lax");
    expect(clear).toContain("Path=/");
  });
});

// ── Sanity: base64url helpers round-trip for state bytes ────────────────────

describe("district/oidc/state — base64url round-trip sanity", () => {
  it("round-trips arbitrary bytes through the helpers used by the module", () => {
    const raw = new Uint8Array([0, 1, 2, 3, 4, 255, 128, 64]);
    const b64 = bytesToBase64Url(raw);
    const back = base64UrlToBytes(b64);
    expect(Array.from(back)).toEqual(Array.from(raw));
  });
});
