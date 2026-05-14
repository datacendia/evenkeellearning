// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/district-auth.test.ts
//
// v1.8.3 — End-to-end tests for the district auth orchestrator
// (establishSession + refreshAccessToken + revokeSession).
//
// We use real ECDSA-P256 keys and synthesize valid WebAuthn assertions
// so the verifier path is exercised genuinely.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from "vitest";
import { bytesToBase64Url, toArrayBuffer } from "../../lib/crypto/base64url";
import {
  establishSession,
  refreshAccessToken,
  revokeSession,
} from "../../lib/district/auth";
import { InMemoryDistrictStore } from "../../lib/district/in-memory-store";
import type { DistrictStore } from "../../lib/district/store";
import type { PasskeyAssertionInput } from "../../lib/district/passkey-verify";

interface KeyMat {
  privateKey: CryptoKey;
  spkiB64url: string;
  credentialIdB64url: string;
}

async function makeKeyMat(): Promise<KeyMat> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  return {
    privateKey: pair.privateKey,
    spkiB64url: bytesToBase64Url(spki),
    credentialIdB64url: bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16))),
  };
}

async function sha256(b: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(b)));
}

async function synthAssertion(
  km: KeyMat,
  challengeB64url: string,
  opts: { rpId?: string; origin?: string; signCount?: number } = {},
): Promise<Omit<PasskeyAssertionInput, "spkiB64url">> {
  const rpId = opts.rpId ?? "evenkeel.local";
  const origin = opts.origin ?? "https://app.example";
  const clientData = JSON.stringify({
    type: "webauthn.get",
    challenge: challengeB64url,
    origin,
  });
  const clientDataBytes = new TextEncoder().encode(clientData);
  const rpIdHash = await sha256(new TextEncoder().encode(rpId));
  const signCount = opts.signCount ?? 1;
  const authData = new Uint8Array(37);
  authData.set(rpIdHash, 0);
  authData[32] = 0x01;
  authData[33] = (signCount >>> 24) & 0xff;
  authData[34] = (signCount >>> 16) & 0xff;
  authData[35] = (signCount >>> 8) & 0xff;
  authData[36] = signCount & 0xff;
  const cdh = await sha256(clientDataBytes);
  const signedBytes = new Uint8Array(authData.length + cdh.length);
  signedBytes.set(authData, 0);
  signedBytes.set(cdh, authData.length);
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      km.privateKey,
      toArrayBuffer(signedBytes),
    ),
  );
  return {
    expectedChallengeB64url: challengeB64url,
    allowedOrigins: [origin],
    rpId,
    credentialIdB64url: km.credentialIdB64url,
    authenticatorDataB64url: bytesToBase64Url(authData),
    clientDataJsonB64url: bytesToBase64Url(clientDataBytes),
    signatureB64url: bytesToBase64Url(sig),
  };
}

interface Setup {
  store: DistrictStore;
  tenantId: string;
  userId: string;
  km: KeyMat;
}

async function setupSession(): Promise<Setup> {
  const store = new InMemoryDistrictStore();
  const tenant = await store.createTenant({ name: "Acme" });
  const u = await store.upsertUser(tenant.id, {
    externalId: "ext-1",
    displayName: "Alex",
  });
  await store.grantRole(tenant.id, u.user.id, "teacher");
  const km = await makeKeyMat();
  await store.addPasskeyCredential(tenant.id, u.user.id, {
    credentialIdB64url: km.credentialIdB64url,
    spkiB64url: km.spkiB64url,
    signCount: 0,
    label: "Phone",
  });
  return { store, tenantId: tenant.id, userId: u.user.id, km };
}

describe("district/auth — establishSession", () => {
  let s: Setup;
  beforeEach(async () => {
    s = await setupSession();
  });

  it("issues a refresh + access token and persists the refresh row", async () => {
    const result = await establishSession({
      store: s.store,
      tenantId: s.tenantId,
      userId: s.userId,
      credentialIdB64url: s.km.credentialIdB64url,
      roles: ["teacher"],
      source: "lti",
    });
    expect(result.refreshToken).toBeTruthy();
    expect(result.accessToken).toBeTruthy();
    expect(result.accessPayload.roles).toEqual(["teacher"]);

    const row = await s.store.getRefreshToken(s.tenantId, result.refreshPayload.jti);
    expect(row).not.toBeNull();
    expect(row?.credentialIdB64url).toBe(s.km.credentialIdB64url);
  });

  it("writes an audit row tagged with the source", async () => {
    await establishSession({
      store: s.store,
      tenantId: s.tenantId,
      userId: s.userId,
      credentialIdB64url: s.km.credentialIdB64url,
      roles: ["teacher"],
      source: "sso.oidc.google",
    });
    const audit = await s.store.listAudit(s.tenantId);
    expect(audit.some((a) => a.action === "district.session.established")).toBe(true);
    const evt = audit.find((a) => a.action === "district.session.established");
    expect(evt?.detail?.source).toBe("sso.oidc.google");
  });
});

describe("district/auth — refreshAccessToken happy path", () => {
  it("mints a fresh access token when the assertion is valid", async () => {
    const s = await setupSession();
    const session = await establishSession({
      store: s.store,
      tenantId: s.tenantId,
      userId: s.userId,
      credentialIdB64url: s.km.credentialIdB64url,
      roles: ["teacher"],
      source: "lti",
    });
    const challenge = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(24)));
    const assertion = await synthAssertion(s.km, challenge, { signCount: 1 });

    const result = await refreshAccessToken({
      store: s.store,
      refreshTokenCookie: session.refreshToken,
      passkeyAssertion: { ...assertion, spkiB64url: s.km.spkiB64url },
      roles: ["teacher"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.accessPayload.userId).toBe(s.userId);
      expect(result.accessPayload.roles).toEqual(["teacher"]);
    }
  });

  it("advances the signCount ratchet on each successful refresh", async () => {
    const s = await setupSession();
    const session = await establishSession({
      store: s.store,
      tenantId: s.tenantId,
      userId: s.userId,
      credentialIdB64url: s.km.credentialIdB64url,
      roles: ["teacher"],
      source: "lti",
    });
    // First refresh
    const c1 = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(24)));
    const r1 = await refreshAccessToken({
      store: s.store,
      refreshTokenCookie: session.refreshToken,
      passkeyAssertion: {
        ...(await synthAssertion(s.km, c1, { signCount: 5 })),
        spkiB64url: s.km.spkiB64url,
      },
      roles: ["teacher"],
    });
    expect(r1.ok).toBe(true);

    // Replay the SAME signCount → rejected
    const c2 = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(24)));
    const r2 = await refreshAccessToken({
      store: s.store,
      refreshTokenCookie: session.refreshToken,
      passkeyAssertion: {
        ...(await synthAssertion(s.km, c2, { signCount: 5 })),
        spkiB64url: s.km.spkiB64url,
      },
      roles: ["teacher"],
    });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe("signcount_replay");
  });
});

describe("district/auth — refreshAccessToken failures", () => {
  it("rejects a missing refresh cookie", async () => {
    const s = await setupSession();
    const challenge = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(24)));
    const r = await refreshAccessToken({
      store: s.store,
      refreshTokenCookie: null,
      passkeyAssertion: {
        ...(await synthAssertion(s.km, challenge, { signCount: 1 })),
        spkiB64url: s.km.spkiB64url,
      },
      roles: ["teacher"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing_refresh_cookie");
  });

  it("rejects after the refresh token has been revoked", async () => {
    const s = await setupSession();
    const session = await establishSession({
      store: s.store,
      tenantId: s.tenantId,
      userId: s.userId,
      credentialIdB64url: s.km.credentialIdB64url,
      roles: ["teacher"],
      source: "lti",
    });
    await s.store.revokeRefreshToken(s.tenantId, session.refreshPayload.jti);
    const challenge = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(24)));
    const r = await refreshAccessToken({
      store: s.store,
      refreshTokenCookie: session.refreshToken,
      passkeyAssertion: {
        ...(await synthAssertion(s.km, challenge, { signCount: 1 })),
        spkiB64url: s.km.spkiB64url,
      },
      roles: ["teacher"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("refresh_revoked");
  });

  it("rejects when the user has been deactivated", async () => {
    const s = await setupSession();
    const session = await establishSession({
      store: s.store,
      tenantId: s.tenantId,
      userId: s.userId,
      credentialIdB64url: s.km.credentialIdB64url,
      roles: ["teacher"],
      source: "lti",
    });
    await s.store.updateUser(s.tenantId, s.userId, { active: false });
    const challenge = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(24)));
    const r = await refreshAccessToken({
      store: s.store,
      refreshTokenCookie: session.refreshToken,
      passkeyAssertion: {
        ...(await synthAssertion(s.km, challenge, { signCount: 1 })),
        spkiB64url: s.km.spkiB64url,
      },
      roles: ["teacher"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("user_inactive");
  });

  it("rejects when the credential has been revoked", async () => {
    const s = await setupSession();
    const session = await establishSession({
      store: s.store,
      tenantId: s.tenantId,
      userId: s.userId,
      credentialIdB64url: s.km.credentialIdB64url,
      roles: ["teacher"],
      source: "lti",
    });
    await s.store.revokePasskeyCredential(s.tenantId, s.km.credentialIdB64url);
    const challenge = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(24)));
    const r = await refreshAccessToken({
      store: s.store,
      refreshTokenCookie: session.refreshToken,
      passkeyAssertion: {
        ...(await synthAssertion(s.km, challenge, { signCount: 1 })),
        spkiB64url: s.km.spkiB64url,
      },
      roles: ["teacher"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("credential_revoked");
  });

  it("rejects when the assertion uses a DIFFERENT credential than the refresh binding", async () => {
    const s = await setupSession();
    const session = await establishSession({
      store: s.store,
      tenantId: s.tenantId,
      userId: s.userId,
      credentialIdB64url: s.km.credentialIdB64url,
      roles: ["teacher"],
      source: "lti",
    });
    // Enrol a second passkey for the SAME user, then assert with it.
    const km2 = await makeKeyMat();
    await s.store.addPasskeyCredential(s.tenantId, s.userId, {
      credentialIdB64url: km2.credentialIdB64url,
      spkiB64url: km2.spkiB64url,
      signCount: 0,
    });
    const challenge = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(24)));
    const r = await refreshAccessToken({
      store: s.store,
      refreshTokenCookie: session.refreshToken,
      passkeyAssertion: {
        ...(await synthAssertion(km2, challenge, { signCount: 1 })),
        spkiB64url: km2.spkiB64url,
      },
      roles: ["teacher"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("credential_mismatch");
  });

  it("rejects when the assertion itself fails verification (wrong origin)", async () => {
    const s = await setupSession();
    const session = await establishSession({
      store: s.store,
      tenantId: s.tenantId,
      userId: s.userId,
      credentialIdB64url: s.km.credentialIdB64url,
      roles: ["teacher"],
      source: "lti",
    });
    const challenge = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(24)));
    const assertion = await synthAssertion(s.km, challenge, {
      origin: "https://attacker.example",
      signCount: 1,
    });
    // Force allowedOrigins to NOT include the spoofed origin.
    assertion.allowedOrigins = ["https://app.example"];
    const r = await refreshAccessToken({
      store: s.store,
      refreshTokenCookie: session.refreshToken,
      passkeyAssertion: { ...assertion, spkiB64url: s.km.spkiB64url },
      roles: ["teacher"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("assertion_failed");
  });
});

describe("district/auth — revokeSession", () => {
  it("revokes the bound refresh row and writes audit", async () => {
    const s = await setupSession();
    const session = await establishSession({
      store: s.store,
      tenantId: s.tenantId,
      userId: s.userId,
      credentialIdB64url: s.km.credentialIdB64url,
      roles: ["teacher"],
      source: "lti",
    });
    const result = await revokeSession({
      store: s.store,
      refreshTokenCookie: session.refreshToken,
    });
    expect(result.revoked).toBe(true);
    const audit = await s.store.listAudit(s.tenantId);
    expect(audit.some((a) => a.action === "district.session.revoked")).toBe(true);
  });

  it("is idempotent on a missing cookie", async () => {
    const s = await setupSession();
    const result = await revokeSession({
      store: s.store,
      refreshTokenCookie: null,
    });
    expect(result.revoked).toBe(false);
  });

  it("returns revoked=false on a second logout with the same cookie", async () => {
    const s = await setupSession();
    const session = await establishSession({
      store: s.store,
      tenantId: s.tenantId,
      userId: s.userId,
      credentialIdB64url: s.km.credentialIdB64url,
      roles: ["teacher"],
      source: "lti",
    });
    await revokeSession({
      store: s.store,
      refreshTokenCookie: session.refreshToken,
    });
    const second = await revokeSession({
      store: s.store,
      refreshTokenCookie: session.refreshToken,
    });
    expect(second.revoked).toBe(false);
  });
});
