// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/auto-passkey.test.ts
//
// v1.5.5 — audit H-2: `signPayloadWithAutoPasskey` is the entry point CRT
// envelopes and per-submission events use to "prefer passkey, fall back to
// session key." That default is correct for the learner flow (never block
// on a passkey ceremony failure), but it means a session-key envelope is
// the silent default whenever a learner hasn't enrolled. Surfaces that
// need cryptographic identity binding (e.g. high-stakes coursework
// receipts) can now pass `{ requirePasskey: true }` to flip the contract:
// failure raises `PasskeyRequiredError` rather than falling back silently.
//
// This test pins:
//   1. default behaviour (no options) falls back to session-key signing
//      when no passkey is enrolled — the existing v1.5.4 contract.
//   2. `requirePasskey: true` throws `PasskeyRequiredError` with
//      `reason: "not_enrolled"` when the localStorage enrolment is
//      missing — no silent fallback.
//   3. The error type exposes its `reason` discriminator so callers can
//      route recoverable (not_enrolled → prompt enrolment) vs transient
//      (ceremony_failed → retry) failures.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from "vitest";
import {
  signPayloadWithAutoPasskey,
  PasskeyRequiredError,
  resetSessionKeyPair,
  verifyEnvelope,
} from "@/lib/crypto/signing";

const ENROLMENT_KEY = "evenkeel.passkey.enrolment.v1";

beforeEach(() => {
  window.localStorage.removeItem(ENROLMENT_KEY);
  resetSessionKeyPair();
});

describe("signPayloadWithAutoPasskey — default (silent fallback) mode", () => {
  it("falls back to the session key when no passkey is enrolled, and the envelope verifies", async () => {
    const env = await signPayloadWithAutoPasskey({ hello: "world" });
    expect(env.keyType).toBe("session-demo");
    expect(await verifyEnvelope(env)).toBe(true);
  });

  it("accepts `requirePasskey: false` as an explicit opt-out (back-compat)", async () => {
    const env = await signPayloadWithAutoPasskey(
      { hello: "world" },
      { requirePasskey: false },
    );
    expect(env.keyType).toBe("session-demo");
  });
});

describe("signPayloadWithAutoPasskey — requirePasskey strict mode (H-2)", () => {
  it("throws PasskeyRequiredError(not_enrolled) when no enrolment exists", async () => {
    // Sanity: confirm the enrolment is genuinely missing.
    expect(window.localStorage.getItem(ENROLMENT_KEY)).toBeNull();

    let caught: unknown = null;
    try {
      await signPayloadWithAutoPasskey({ hello: "world" }, { requirePasskey: true });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(PasskeyRequiredError);
    if (caught instanceof PasskeyRequiredError) {
      expect(caught.reason).toBe("not_enrolled");
      expect(caught.name).toBe("PasskeyRequiredError");
    }
  });

  it("does NOT silently fall back to the session key when requirePasskey is true", async () => {
    let envelope: { keyType?: string } | null = null;
    try {
      envelope = await signPayloadWithAutoPasskey(
        { sensitive: "evidence" },
        { requirePasskey: true },
      );
    } catch {
      /* expected */
    }
    expect(envelope).toBeNull();
  });
});
