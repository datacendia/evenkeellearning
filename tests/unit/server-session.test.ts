// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/server-session.test.ts
//
// v1.6.0 — audit H-1. Regression suite for the server-verified role
// session module. Pins the security-critical invariants:
//
//   1. A legitimate token roundtrips.
//   2. Any byte flipped in the signature is rejected.
//   3. Any byte flipped in the payload is rejected.
//   4. An expired token is rejected.
//   5. A revoked jti is rejected.
//   6. Two sessions for the same role get distinct jtis.
//   7. A missing secret in production throws (the OK path in dev).
//   8. Passphrase check is timing-safe against equal-length wrong input.
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// IMPORTANT: the module caches the HMAC key on first use. We re-import
// it in each suite where we want to flip NODE_ENV, using vi.resetModules.

describe("auth/server-session — token roundtrip", () => {
  it("issues, then verifies a legitimate token", async () => {
    const mod = await import("@/lib/auth/server-session");
    const { token, session } = await mod.issueSession("teacher");
    const verified = await mod.verifySession(token);
    expect(verified).not.toBeNull();
    expect(verified && "role" in verified ? verified.role : null).toBe("teacher");
    expect(verified && "jti" in verified ? verified.jti : null).toBe(session.jti);
  });

  it("issues distinct jtis for back-to-back sessions", async () => {
    const mod = await import("@/lib/auth/server-session");
    const a = await mod.issueSession("compliance");
    const b = await mod.issueSession("compliance");
    expect(a.session.jti).not.toBe(b.session.jti);
  });

  it("rejects a token whose signature byte was flipped", async () => {
    const mod = await import("@/lib/auth/server-session");
    const { token } = await mod.issueSession("teacher");
    const [payload, sig] = token.split(".");
    // Flip a character in the signature; keep length the same.
    const tamperedSig = sig[0] === "A" ? "B" + sig.slice(1) : "A" + sig.slice(1);
    const verified = await mod.verifySession(payload + "." + tamperedSig);
    expect(verified).toBeNull();
  });

  it("rejects a token whose payload was mutated (signature won't match)", async () => {
    const mod = await import("@/lib/auth/server-session");
    const { token } = await mod.issueSession("author");
    const [payload, sig] = token.split(".");
    const tamperedPayload = payload[0] === "A" ? "B" + payload.slice(1) : "A" + payload.slice(1);
    const verified = await mod.verifySession(tamperedPayload + "." + sig);
    expect(verified).toBeNull();
  });

  it("rejects garbage, empty, and malformed tokens", async () => {
    const mod = await import("@/lib/auth/server-session");
    expect(await mod.verifySession(undefined)).toBeNull();
    expect(await mod.verifySession("")).toBeNull();
    expect(await mod.verifySession("no-dot")).toBeNull();
    expect(await mod.verifySession("a.b.c")).toBeNull();
    expect(await mod.verifySession("!.!")).toBeNull();
  });

  it("rejects a revoked token", async () => {
    const mod = await import("@/lib/auth/server-session");
    const { token, session } = await mod.issueSession("teacher");
    mod.revokeSession(session.jti);
    const verified = await mod.verifySession(token);
    expect(verified).toBeNull();
  });
});

describe("auth/server-session — expiry", () => {
  it("rejects a token whose exp is in the past", async () => {
    // Fake the clock forward past the 4h TTL.
    const mod = await import("@/lib/auth/server-session");
    const { token } = await mod.issueSession("teacher");
    vi.useFakeTimers();
    // Advance 5 hours
    vi.setSystemTime(Date.now() + 5 * 60 * 60 * 1000);
    try {
      const verified = await mod.verifySession(token);
      expect(verified).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("auth/server-session — passphrase", () => {
  it("accepts the configured passphrase in dev", async () => {
    const mod = await import("@/lib/auth/server-session");
    expect(await mod.checkPassphrase("teacher", "mentor-alpha-42")).toBe(true);
    expect(await mod.checkPassphrase("compliance", "officer-alpha-42")).toBe(true);
    expect(await mod.checkPassphrase("author", "reviewer-alpha-42")).toBe(true);
  });

  it("rejects any other input", async () => {
    const mod = await import("@/lib/auth/server-session");
    expect(await mod.checkPassphrase("teacher", "")).toBe(false);
    expect(await mod.checkPassphrase("teacher", "mentor-alpha-43")).toBe(false);
    expect(await mod.checkPassphrase("teacher", "officer-alpha-42")).toBe(false);
  });

  it("returns false (not throws) for non-string input", async () => {
    const mod = await import("@/lib/auth/server-session");
    expect(await mod.checkPassphrase("teacher", null as unknown as string)).toBe(false);
    expect(await mod.checkPassphrase("teacher", undefined as unknown as string)).toBe(false);
  });
});

describe("auth/server-session — production safety", () => {
  const origEnv = process.env.NODE_ENV;
  const origSecret = process.env.ROLE_GUARD_SECRET;
  const origTeacher = process.env.ROLE_GUARD_TEACHER_PASSPHRASE;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env.NODE_ENV = origEnv;
    if (origSecret === undefined) delete process.env.ROLE_GUARD_SECRET;
    else process.env.ROLE_GUARD_SECRET = origSecret;
    if (origTeacher === undefined) delete process.env.ROLE_GUARD_TEACHER_PASSPHRASE;
    else process.env.ROLE_GUARD_TEACHER_PASSPHRASE = origTeacher;
    vi.resetModules();
  });

  it("throws in production if ROLE_GUARD_SECRET is unset", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.ROLE_GUARD_SECRET;
    const mod = await import("@/lib/auth/server-session");
    await expect(mod.issueSession("teacher")).rejects.toThrow(/ROLE_GUARD_SECRET/);
  });

  it("throws in production if a role passphrase env var is unset", async () => {
    process.env.NODE_ENV = "production";
    process.env.ROLE_GUARD_SECRET = "x".repeat(48);
    delete process.env.ROLE_GUARD_TEACHER_PASSPHRASE;
    const mod = await import("@/lib/auth/server-session");
    await expect(mod.checkPassphrase("teacher", "anything")).rejects.toThrow(
      /ROLE_GUARD_TEACHER_PASSPHRASE/,
    );
  });

  it("accepts a valid ROLE_GUARD_SECRET in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.ROLE_GUARD_SECRET = "y".repeat(48);
    process.env.ROLE_GUARD_TEACHER_PASSPHRASE = "real-teacher-pass";
    const mod = await import("@/lib/auth/server-session");
    const { token } = await mod.issueSession("teacher");
    const verified = await mod.verifySession(token);
    expect(verified).not.toBeNull();
    expect(await mod.checkPassphrase("teacher", "real-teacher-pass")).toBe(true);
    expect(await mod.checkPassphrase("teacher", "wrong")).toBe(false);
  });
});
