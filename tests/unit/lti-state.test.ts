// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/lti-state.test.ts
//
// v1.8.0 — Tests for the signed LTI state / nonce module.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  generateNonce,
  issueState,
  STATE_TTL_MS,
  verifyState,
} from "../../lib/lti/state";

describe("lti/state — generateNonce", () => {
  it("produces a base64url-shaped string", () => {
    const n = generateNonce();
    expect(typeof n).toBe("string");
    expect(n).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(n.length).toBeGreaterThanOrEqual(32);
  });

  it("produces unique values on repeated calls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(generateNonce());
    expect(seen.size).toBe(50);
  });
});

describe("lti/state — issue + verify round trip", () => {
  it("verifies a freshly issued state", async () => {
    const state = await issueState({
      platformId: "dev-canvas",
      nonce: "n-abc",
      targetLinkUri: "https://app.example/learner",
    });
    const r = await verifyState(state);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.platformId).toBe("dev-canvas");
      expect(r.payload.nonce).toBe("n-abc");
      expect(r.payload.targetLinkUri).toBe("https://app.example/learner");
      expect(r.payload.v).toBe(1);
    }
  });

  it("rejects a tampered payload", async () => {
    const state = await issueState({
      platformId: "dev-canvas",
      nonce: "n-abc",
      targetLinkUri: "https://app.example/learner",
    });
    const [_p, sig] = state.split(".");
    void _p;
    const tampered =
      Buffer.from(JSON.stringify({ v: 1, platformId: "evil", nonce: "e", targetLinkUri: "x", exp: Date.now() + 60_000, jti: "x" }))
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "") +
      "." +
      sig;
    const r = await verifyState(tampered);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad_signature");
  });

  it("rejects an expired state", async () => {
    const state = await issueState({
      platformId: "dev-canvas",
      nonce: "n-abc",
      targetLinkUri: "https://app.example/learner",
    });
    // Pretend it's STATE_TTL_MS + 1 in the future.
    const r = await verifyState(state, { nowMs: Date.now() + STATE_TTL_MS + 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("expired");
  });

  it("rejects a malformed input", async () => {
    expect((await verifyState("garbage")).ok).toBe(false);
    expect((await verifyState("only-one-part")).ok).toBe(false);
    expect((await verifyState(null)).ok).toBe(false);
    expect((await verifyState(undefined)).ok).toBe(false);
  });

  it("each issued state is unique even with identical inputs", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const s = await issueState({
        platformId: "dev-canvas",
        nonce: "n-abc",
        targetLinkUri: "https://app.example/learner",
      });
      seen.add(s);
    }
    expect(seen.size).toBe(10);
  });
});
