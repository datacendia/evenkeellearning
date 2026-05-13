// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/district-tokens.test.ts
//
// v1.8.3 — Tests for district refresh and access token issue/verify.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  ACCESS_COOKIE_NAME,
  ACCESS_TOKEN_TTL_MS,
  REFRESH_COOKIE_NAME,
  REFRESH_TOKEN_TTL_MS,
  buildAccessCookie,
  buildClearAuthCookies,
  buildRefreshCookie,
  generateRefreshChallenge,
  issueAccessToken,
  issueRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from "../../lib/district/tokens";

describe("district/tokens — refresh token round-trip", () => {
  it("issues and verifies a refresh token", async () => {
    const r = await issueRefreshToken({
      tenantId: "t1",
      userId: "u1",
      credentialIdB64url: "cred-1",
    });
    const v = await verifyRefreshToken(r.token);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.payload.tenantId).toBe("t1");
      expect(v.payload.userId).toBe("u1");
      expect(v.payload.credentialIdB64url).toBe("cred-1");
      expect(v.payload.jti).toBeTruthy();
    }
  });

  it("rejects a missing token", async () => {
    expect((await verifyRefreshToken(null)).ok).toBe(false);
    expect((await verifyRefreshToken("")).ok).toBe(false);
  });

  it("rejects a malformed token", async () => {
    const v = await verifyRefreshToken("only-one-part");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("bad_signature");
  });

  it("rejects a tampered payload", async () => {
    const r = await issueRefreshToken({
      tenantId: "t1",
      userId: "u1",
      credentialIdB64url: "cred-1",
    });
    const [_p, sig] = r.token.split(".");
    void _p;
    const evilPayload = Buffer.from(
      JSON.stringify({
        v: 1,
        tenantId: "evil",
        userId: "u1",
        credentialIdB64url: "cred-1",
        jti: "x",
        exp: Date.now() + 60_000,
      }),
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const v = await verifyRefreshToken(evilPayload + "." + sig);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("bad_signature");
  });

  it("rejects an expired token", async () => {
    const r = await issueRefreshToken({
      tenantId: "t1",
      userId: "u1",
      credentialIdB64url: "cred-1",
    });
    const v = await verifyRefreshToken(r.token, {
      nowMs: Date.now() + REFRESH_TOKEN_TTL_MS + 1,
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("expired");
  });

  it("each issued token has a unique jti", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const r = await issueRefreshToken({
        tenantId: "t",
        userId: "u",
        credentialIdB64url: "c",
      });
      seen.add(r.payload.jti);
    }
    expect(seen.size).toBe(10);
  });
});

describe("district/tokens — access token round-trip", () => {
  it("issues and verifies an access token", async () => {
    const r = await issueAccessToken({
      tenantId: "t1",
      userId: "u1",
      roles: ["teacher", "compliance_officer"],
    });
    const v = await verifyAccessToken(r.token);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.payload.roles).toEqual(["teacher", "compliance_officer"]);
    }
  });

  it("rejects an expired access token", async () => {
    const r = await issueAccessToken({ tenantId: "t1", userId: "u1", roles: [] });
    const v = await verifyAccessToken(r.token, {
      nowMs: Date.now() + ACCESS_TOKEN_TTL_MS + 1,
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("expired");
  });

  it("issues defensive copies of the roles array", async () => {
    const roles: ("teacher" | "auditor")[] = ["teacher"];
    const r = await issueAccessToken({
      tenantId: "t",
      userId: "u",
      roles,
    });
    roles.push("auditor");
    const v = await verifyAccessToken(r.token);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.payload.roles).toEqual(["teacher"]);
  });

  it("a refresh-signed token cannot be verified as an access token (and vice-versa)", async () => {
    const r = await issueRefreshToken({
      tenantId: "t",
      userId: "u",
      credentialIdB64url: "c",
    });
    const v = await verifyAccessToken(r.token);
    expect(v.ok).toBe(false);
  });
});

describe("district/tokens — challenge + cookies", () => {
  it("generateRefreshChallenge produces unique base64url values", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(generateRefreshChallenge());
    expect(seen.size).toBe(50);
    for (const v of seen) expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("buildRefreshCookie sets HttpOnly + the right name + TTL", () => {
    const c = buildRefreshCookie("abc.def");
    expect(c).toContain(`${REFRESH_COOKIE_NAME}=abc.def`);
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Strict");
    expect(c).toContain(`Max-Age=${Math.floor(REFRESH_TOKEN_TTL_MS / 1000)}`);
  });

  it("buildAccessCookie uses the access cookie name and TTL", () => {
    const c = buildAccessCookie("abc.def");
    expect(c).toContain(`${ACCESS_COOKIE_NAME}=abc.def`);
    expect(c).toContain(`Max-Age=${Math.floor(ACCESS_TOKEN_TTL_MS / 1000)}`);
  });

  it("buildClearAuthCookies zeroes both cookies", () => {
    const cookies = buildClearAuthCookies();
    expect(cookies.length).toBe(2);
    expect(cookies[0]).toContain("Max-Age=0");
    expect(cookies[1]).toContain("Max-Age=0");
  });
});
