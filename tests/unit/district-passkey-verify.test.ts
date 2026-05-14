// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/district-passkey-verify.test.ts
//
// v1.8.3 — Tests for the server-side WebAuthn assertion verifier.
//
// We construct a real ECDSA-P256 keypair, synthesize valid
// authenticatorData + clientDataJSON, sign them, and run the verifier.
// This covers the happy path and every named failure code.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeAll } from "vitest";
import { bytesToBase64Url, toArrayBuffer } from "../../lib/crypto/base64url";
import {
  verifyPasskeyAssertion,
  type PasskeyAssertionInput,
} from "../../lib/district/passkey-verify";

interface Fixture {
  privateKey: CryptoKey;
  spkiB64url: string;
  rpId: string;
  origin: string;
  credentialIdB64url: string;
}

async function makeFixture(): Promise<Fixture> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  return {
    privateKey: pair.privateKey,
    spkiB64url: bytesToBase64Url(spki),
    rpId: "evenkeel.local",
    origin: "https://app.example",
    credentialIdB64url: bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16))),
  };
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes)));
}

function buildAuthenticatorData(
  rpIdHash: Uint8Array,
  flags: number,
  signCount: number,
): Uint8Array {
  const data = new Uint8Array(37);
  data.set(rpIdHash, 0);
  data[32] = flags;
  data[33] = (signCount >>> 24) & 0xff;
  data[34] = (signCount >>> 16) & 0xff;
  data[35] = (signCount >>> 8) & 0xff;
  data[36] = signCount & 0xff;
  return data;
}

async function synthAssertion(
  f: Fixture,
  opts: {
    challengeB64url?: string;
    origin?: string;
    type?: string;
    rpIdOverride?: string;
    flags?: number;
    signCount?: number;
    tamperedSig?: boolean;
  } = {},
): Promise<PasskeyAssertionInput> {
  const challenge =
    opts.challengeB64url ??
    bytesToBase64Url(crypto.getRandomValues(new Uint8Array(24)));
  const clientData = JSON.stringify({
    type: opts.type ?? "webauthn.get",
    challenge,
    origin: opts.origin ?? f.origin,
  });
  const clientDataBytes = new TextEncoder().encode(clientData);
  const rpIdHash = await sha256(
    new TextEncoder().encode(opts.rpIdOverride ?? f.rpId),
  );
  const flags = opts.flags ?? 0x01; // UP set
  const signCount = opts.signCount ?? 1;
  const authData = buildAuthenticatorData(rpIdHash, flags, signCount);
  const clientDataHash = await sha256(clientDataBytes);
  const signedBytes = new Uint8Array(authData.length + clientDataHash.length);
  signedBytes.set(authData, 0);
  signedBytes.set(clientDataHash, authData.length);
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      f.privateKey,
      toArrayBuffer(signedBytes),
    ),
  );
  if (opts.tamperedSig) sig[0] ^= 0xff;
  return {
    expectedChallengeB64url: challenge,
    allowedOrigins: [f.origin],
    rpId: f.rpId,
    credentialIdB64url: f.credentialIdB64url,
    authenticatorDataB64url: bytesToBase64Url(authData),
    clientDataJsonB64url: bytesToBase64Url(clientDataBytes),
    signatureB64url: bytesToBase64Url(sig),
    spkiB64url: f.spkiB64url,
  };
}

describe("district/passkey-verify — happy path", () => {
  let fixture: Fixture;
  beforeAll(async () => {
    fixture = await makeFixture();
  });

  it("verifies a freshly synthesised assertion", async () => {
    const input = await synthAssertion(fixture);
    const r = await verifyPasskeyAssertion(input);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.signCount).toBe(1);
      expect(r.flags & 0x01).toBe(0x01);
    }
  });

  it("returns the parsed signCount", async () => {
    const input = await synthAssertion(fixture, { signCount: 42 });
    const r = await verifyPasskeyAssertion(input);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.signCount).toBe(42);
  });
});

describe("district/passkey-verify — claim failures", () => {
  let fixture: Fixture;
  beforeAll(async () => {
    fixture = await makeFixture();
  });

  it("rejects a wrong clientDataJSON type", async () => {
    const input = await synthAssertion(fixture, { type: "webauthn.create" });
    const r = await verifyPasskeyAssertion(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("wrong_type");
  });

  it("rejects when the challenge does not match", async () => {
    const input = await synthAssertion(fixture);
    input.expectedChallengeB64url = "DIFFERENT_CHALLENGE_VALUE";
    const r = await verifyPasskeyAssertion(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("wrong_challenge");
  });

  it("rejects an untrusted origin", async () => {
    const input = await synthAssertion(fixture, {
      origin: "https://attacker.example",
    });
    const r = await verifyPasskeyAssertion(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("untrusted_origin");
  });

  it("rejects a wrong rpId (rpIdHash mismatch)", async () => {
    const input = await synthAssertion(fixture, { rpIdOverride: "other.example" });
    const r = await verifyPasskeyAssertion(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("wrong_rp_id");
  });

  it("rejects when the User-Present flag is clear", async () => {
    const input = await synthAssertion(fixture, { flags: 0x00 });
    const r = await verifyPasskeyAssertion(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("user_not_present");
  });

  it("rejects a tampered signature", async () => {
    const input = await synthAssertion(fixture, { tamperedSig: true });
    const r = await verifyPasskeyAssertion(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("bad_signature");
  });

  it("rejects malformed clientDataJSON (not JSON)", async () => {
    const input = await synthAssertion(fixture);
    input.clientDataJsonB64url = bytesToBase64Url(new TextEncoder().encode("not-json"));
    const r = await verifyPasskeyAssertion(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("malformed_client_data");
  });

  it("rejects malformed authenticatorData (too short)", async () => {
    const input = await synthAssertion(fixture);
    input.authenticatorDataB64url = bytesToBase64Url(new Uint8Array(10));
    const r = await verifyPasskeyAssertion(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("malformed_authenticator_data");
  });

  it("rejects an SPKI that cannot be imported", async () => {
    const input = await synthAssertion(fixture);
    input.spkiB64url = bytesToBase64Url(new Uint8Array(20));
    const r = await verifyPasskeyAssertion(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("import_failed");
  });
});
