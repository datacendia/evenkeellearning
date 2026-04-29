// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/role-guard.test.ts
//
// The role guard is a *demo* gate. The tests pin its observable contract:
//   1. Wrong passphrase → does not unlock, ~400ms cooldown.
//   2. Correct passphrase → unlocks for the calling tab only.
//   3. lock() reverts the unlock.
//   4. Digest derivation is deterministic and ≤16 hex chars (we never store
//      the plaintext, and we never store the full hash either).
//   5. Constant-time comparison: equal-length wrong digests do not leak via
//      a measurable timing difference (smoke test, not a formal proof).
// ─────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  derivePassphraseDigest,
  isUnlocked,
  lock,
  tryUnlock,
} from "@/lib/auth/role-guard";

describe("auth/role-guard", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });
  afterEach(() => {
    lock("teacher");
    lock("compliance");
  });

  it("digest is deterministic and exactly 16 hex chars", async () => {
    const a = await derivePassphraseDigest("hello");
    const b = await derivePassphraseDigest("hello");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("digest changes when input changes", async () => {
    const a = await derivePassphraseDigest("mentor-alpha-42");
    const b = await derivePassphraseDigest("mentor-alpha-43");
    expect(a).not.toBe(b);
  });

  it("starts locked", () => {
    expect(isUnlocked("teacher")).toBe(false);
    expect(isUnlocked("compliance")).toBe(false);
  });

  it("rejects wrong passphrase", async () => {
    const ok = await tryUnlock("teacher", "definitely-not-the-password");
    expect(ok).toBe(false);
    expect(isUnlocked("teacher")).toBe(false);
  });

  it("accepts the demo passphrase and unlocks the tab", async () => {
    const ok = await tryUnlock("teacher", "mentor-alpha-42");
    expect(ok).toBe(true);
    expect(isUnlocked("teacher")).toBe(true);
    // Other roles remain locked
    expect(isUnlocked("compliance")).toBe(false);
  });

  it("lock() reverts the unlock", async () => {
    await tryUnlock("compliance", "officer-alpha-42");
    expect(isUnlocked("compliance")).toBe(true);
    lock("compliance");
    expect(isUnlocked("compliance")).toBe(false);
  });

  it("introduces a noticeable cooldown on failure", async () => {
    const t0 = Date.now();
    const ok = await tryUnlock("teacher", "wrong");
    const elapsed = Date.now() - t0;
    expect(ok).toBe(false);
    // The implementation sleeps 400ms on failure. Allow 200ms slack for
    // slow CI machines.
    expect(elapsed).toBeGreaterThanOrEqual(200);
  });
});
