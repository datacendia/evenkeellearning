// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/lti-session.test.ts
//
// v1.8.0 — Tests for the LTI session cookie helpers.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  buildClearLtiSessionCookie,
  buildLtiSessionCookie,
  issueLtiSession,
  LTI_SESSION_COOKIE_NAME,
  LTI_SESSION_TTL_MS,
  verifyLtiSession,
} from "../../lib/lti/session";
import type { LtiLaunch } from "../../lib/lti/launch";

function fixtureLaunch(over: Partial<LtiLaunch> = {}): LtiLaunch {
  return {
    platformId: "dev-canvas",
    issuer: "https://canvas.instructure.com",
    clientId: "client-1",
    deploymentId: "dep-1",
    ltiUserSub: "lms-user-42",
    role: "learner",
    ltiRoles: [
      "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner",
    ],
    targetLinkUri: "https://app.example/learner",
    resourceLinkId: "rl-1",
    contextId: "ctx-1",
    nonce: "n-1",
    custom: {},
    ...over,
  };
}

describe("lti/session — issue + verify round-trip", () => {
  it("issues a token and verifies it back to the same session payload", async () => {
    const { token, session } = await issueLtiSession(fixtureLaunch());
    const r = await verifyLtiSession(token);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.session.platformId).toBe(session.platformId);
      expect(r.session.sub).toBe(session.sub);
      expect(r.session.resourceLinkId).toBe(session.resourceLinkId);
      expect(r.session.exp).toBe(session.exp);
      expect(r.session.role).toBe("learner");
    }
  });

  it("rejects a tampered payload", async () => {
    const { token } = await issueLtiSession(fixtureLaunch());
    const [_p, sig] = token.split(".");
    void _p;
    const evil =
      Buffer.from(
        JSON.stringify({
          platformId: "evil",
          iss: "x",
          deploymentId: "x",
          sub: "x",
          role: "admin",
          resourceLinkId: "x",
          exp: Date.now() + 60_000,
          jti: "x",
        }),
      )
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "") +
      "." +
      sig;
    const r = await verifyLtiSession(evil);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad_signature");
  });

  it("rejects an expired token", async () => {
    const { token } = await issueLtiSession(fixtureLaunch());
    const r = await verifyLtiSession(token, {
      nowMs: Date.now() + LTI_SESSION_TTL_MS + 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("expired");
  });

  it("rejects malformed inputs", async () => {
    expect((await verifyLtiSession(null)).ok).toBe(false);
    expect((await verifyLtiSession("")).ok).toBe(false);
    expect((await verifyLtiSession("just-one-part")).ok).toBe(false);
  });
});

describe("lti/session — cookie helpers", () => {
  it("buildLtiSessionCookie sets HttpOnly + SameSite=None + the cookie name", () => {
    const cookie = buildLtiSessionCookie("abc.def");
    expect(cookie).toMatch(/^evk_lti_session=abc\.def/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=None");
    expect(cookie).toContain(`Max-Age=${Math.floor(LTI_SESSION_TTL_MS / 1000)}`);
  });

  it("buildClearLtiSessionCookie zeroes the cookie", () => {
    const cookie = buildClearLtiSessionCookie();
    expect(cookie).toContain(`${LTI_SESSION_COOKIE_NAME}=`);
    expect(cookie).toContain("Max-Age=0");
  });
});
