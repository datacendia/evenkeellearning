// Unit tests for lib/crypto/signing.ts. We rely on happy-dom's WebCrypto.

import { describe, it, expect, beforeEach } from "vitest";
import {
  signPayload,
  verifyEnvelope,
  contentDigest,
  resetSessionKeyPair,
  shortSignature,
} from "@/lib/crypto/signing";

describe("crypto/signing", () => {
  beforeEach(() => {
    resetSessionKeyPair();
  });

  it("contentDigest is deterministic across equal payloads", async () => {
    const a = await contentDigest({ x: 1, y: [2, 3] });
    const b = await contentDigest({ x: 1, y: [2, 3] });
    expect(a).toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("signPayload produces a verifiable envelope", async () => {
    const env = await signPayload({ ok: true, n: 42 });
    expect(env.algorithm).toBe("ECDSA-P256-SHA256");
    expect(env.signatureB64url.length).toBeGreaterThan(40);
    expect(env.publicKeyB64url.length).toBeGreaterThan(40);
    const ok = await verifyEnvelope(env);
    expect(ok).toBe(true);
  });

  it("verifyEnvelope rejects a tampered payload", async () => {
    const env = await signPayload({ ok: true, n: 42 });
    const tampered = { ...env, payload: { ok: true, n: 43 } };
    const ok = await verifyEnvelope(tampered);
    expect(ok).toBe(false);
  });

  it("verifyEnvelope rejects a tampered signature", async () => {
    const env = await signPayload({ ok: true, n: 42 });
    // Flip the first byte of the signature to a value guaranteed to differ.
    // Replacing the *last* char is unsafe: base64url's last char only carries
    // 2 useful bits for a 64-byte ECDSA signature, so a random change there
    // can collide back to the original byte and the envelope still verifies.
    // The first char carries 6 bits and a flip is always observable.
    const orig = env.signatureB64url;
    const firstAlt = orig[0] === "A" ? "B" : "A";
    const tamperedSig = firstAlt + orig.slice(1);
    expect(tamperedSig).not.toBe(orig);
    const tampered = { ...env, signatureB64url: tamperedSig };
    const ok = await verifyEnvelope(tampered);
    expect(ok).toBe(false);
  });

  it("shortSignature returns the first 12 chars + ellipsis", async () => {
    const env = await signPayload({ ok: true });
    const s = shortSignature(env);
    expect(s.length).toBe(13);
    expect(s.endsWith("…")).toBe(true);
  });
});
