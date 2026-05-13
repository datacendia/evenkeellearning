// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/district-store-auth-extensions.test.ts
//
// v1.8.3 — Tests for the passkey-credential + refresh-token methods
// added to DistrictStore in v1.8.3.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryDistrictStore } from "../../lib/district/in-memory-store";
import type { DistrictStore } from "../../lib/district/store";

function makeIdGen(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${(++n).toString().padStart(4, "0")}`;
}

function makeStore(): DistrictStore {
  let clock = Date.parse("2026-05-01T00:00:00Z");
  return new InMemoryDistrictStore({
    now: () => {
      clock += 1000;
      return clock;
    },
    newId: makeIdGen("id"),
  });
}

interface Ctx {
  store: DistrictStore;
  tenantA: string;
  tenantB: string;
  userA: string;
  userB: string;
}

async function ctx(): Promise<Ctx> {
  const store = makeStore();
  const tA = await store.createTenant({ name: "A" });
  const tB = await store.createTenant({ name: "B" });
  const uA = await store.upsertUser(tA.id, { externalId: "ua" });
  const uB = await store.upsertUser(tB.id, { externalId: "ub" });
  return {
    store,
    tenantA: tA.id,
    tenantB: tB.id,
    userA: uA.user.id,
    userB: uB.user.id,
  };
}

describe("DistrictStore — passkey credentials", () => {
  let c: Ctx;
  beforeEach(async () => {
    c = await ctx();
  });

  it("adds a credential idempotently", async () => {
    const r1 = await c.store.addPasskeyCredential(c.tenantA, c.userA, {
      credentialIdB64url: "cred-1",
      spkiB64url: "spki-1",
      signCount: 0,
      label: "Phone",
    });
    const r2 = await c.store.addPasskeyCredential(c.tenantA, c.userA, {
      credentialIdB64url: "cred-1",
      spkiB64url: "spki-1",
      signCount: 0,
    });
    expect(r1?.id).toBe(r2?.id);
    expect((await c.store.listPasskeyCredentialsForUser(c.tenantA, c.userA)).length).toBe(1);
  });

  it("refuses when the user belongs to a different tenant", async () => {
    expect(
      await c.store.addPasskeyCredential(c.tenantA, c.userB, {
        credentialIdB64url: "cred-x",
        spkiB64url: "spki",
        signCount: 0,
      }),
    ).toBeNull();
  });

  it("getPasskeyCredentialByCredentialId is tenant-scoped", async () => {
    await c.store.addPasskeyCredential(c.tenantA, c.userA, {
      credentialIdB64url: "cred-1",
      spkiB64url: "spki",
      signCount: 0,
    });
    expect(
      await c.store.getPasskeyCredentialByCredentialId(c.tenantA, "cred-1"),
    ).not.toBeNull();
    expect(
      await c.store.getPasskeyCredentialByCredentialId(c.tenantB, "cred-1"),
    ).toBeNull();
  });

  it("revokes a credential and refuses re-revocation", async () => {
    await c.store.addPasskeyCredential(c.tenantA, c.userA, {
      credentialIdB64url: "cred-1",
      spkiB64url: "spki",
      signCount: 0,
    });
    expect(await c.store.revokePasskeyCredential(c.tenantA, "cred-1")).toBe(true);
    expect(await c.store.revokePasskeyCredential(c.tenantA, "cred-1")).toBe(false);
    const rec = await c.store.getPasskeyCredentialByCredentialId(c.tenantA, "cred-1");
    expect(rec?.revokedAtIso).toBeTruthy();
  });

  it("recordPasskeyAssertion advances the ratchet", async () => {
    await c.store.addPasskeyCredential(c.tenantA, c.userA, {
      credentialIdB64url: "cred-1",
      spkiB64url: "spki",
      signCount: 0,
    });
    expect(await c.store.recordPasskeyAssertion(c.tenantA, "cred-1", 5)).toBe(true);
    expect(await c.store.recordPasskeyAssertion(c.tenantA, "cred-1", 5)).toBe(false);
    expect(await c.store.recordPasskeyAssertion(c.tenantA, "cred-1", 4)).toBe(false);
    expect(await c.store.recordPasskeyAssertion(c.tenantA, "cred-1", 10)).toBe(true);
  });

  it("recordPasskeyAssertion tolerates 0=>0 for counter-less authenticators", async () => {
    await c.store.addPasskeyCredential(c.tenantA, c.userA, {
      credentialIdB64url: "cred-1",
      spkiB64url: "spki",
      signCount: 0,
    });
    expect(await c.store.recordPasskeyAssertion(c.tenantA, "cred-1", 0)).toBe(true);
    expect(await c.store.recordPasskeyAssertion(c.tenantA, "cred-1", 0)).toBe(true);
  });

  it("recordPasskeyAssertion refuses revoked credentials", async () => {
    await c.store.addPasskeyCredential(c.tenantA, c.userA, {
      credentialIdB64url: "cred-1",
      spkiB64url: "spki",
      signCount: 0,
    });
    await c.store.revokePasskeyCredential(c.tenantA, "cred-1");
    expect(await c.store.recordPasskeyAssertion(c.tenantA, "cred-1", 1)).toBe(false);
  });

  it("supports multiple credentials per user", async () => {
    await c.store.addPasskeyCredential(c.tenantA, c.userA, {
      credentialIdB64url: "cred-1",
      spkiB64url: "spki-1",
      signCount: 0,
      label: "Phone",
    });
    await c.store.addPasskeyCredential(c.tenantA, c.userA, {
      credentialIdB64url: "cred-2",
      spkiB64url: "spki-2",
      signCount: 0,
      label: "Laptop",
    });
    const list = await c.store.listPasskeyCredentialsForUser(c.tenantA, c.userA);
    expect(list.length).toBe(2);
    expect(list.map((r) => r.label).sort()).toEqual(["Laptop", "Phone"]);
  });
});

describe("DistrictStore — refresh tokens", () => {
  let c: Ctx;
  beforeEach(async () => {
    c = await ctx();
  });

  async function insert(jti: string, expIsoOffsetMs = 60_000): Promise<void> {
    await c.store.insertRefreshToken({
      jti,
      tenantId: c.tenantA,
      userId: c.userA,
      credentialIdB64url: "cred-1",
      issuedAtIso: new Date().toISOString(),
      expiresAtIso: new Date(Date.now() + expIsoOffsetMs).toISOString(),
    });
  }

  it("inserts and retrieves a refresh token", async () => {
    await insert("jti-1");
    const row = await c.store.getRefreshToken(c.tenantA, "jti-1");
    expect(row).not.toBeNull();
    expect(row?.userId).toBe(c.userA);
  });

  it("refuses cross-tenant lookup", async () => {
    await insert("jti-1");
    expect(await c.store.getRefreshToken(c.tenantB, "jti-1")).toBeNull();
  });

  it("revokes by jti and is idempotent", async () => {
    await insert("jti-1");
    expect(await c.store.revokeRefreshToken(c.tenantA, "jti-1")).toBe(true);
    expect(await c.store.revokeRefreshToken(c.tenantA, "jti-1")).toBe(false);
    const row = await c.store.getRefreshToken(c.tenantA, "jti-1");
    expect(row?.revokedAtIso).toBeTruthy();
  });

  it("revokeAllRefreshTokensForUser revokes only that user's tokens", async () => {
    await insert("jti-1");
    await insert("jti-2");
    const otherUser = (
      await c.store.upsertUser(c.tenantA, { externalId: "other" })
    ).user.id;
    await c.store.insertRefreshToken({
      jti: "jti-other",
      tenantId: c.tenantA,
      userId: otherUser,
      credentialIdB64url: "cred-x",
      issuedAtIso: new Date().toISOString(),
      expiresAtIso: new Date(Date.now() + 60_000).toISOString(),
    });
    const n = await c.store.revokeAllRefreshTokensForUser(c.tenantA, c.userA);
    expect(n).toBe(2);
    expect((await c.store.getRefreshToken(c.tenantA, "jti-other"))?.revokedAtIso).toBeFalsy();
  });

  it("revokeAllRefreshTokensForCredential revokes all rows bound to one passkey", async () => {
    await insert("jti-1");
    await insert("jti-2");
    const n = await c.store.revokeAllRefreshTokensForCredential(c.tenantA, "cred-1");
    expect(n).toBe(2);
  });

  it("listActiveRefreshTokensForUser hides revoked and expired rows", async () => {
    // This test exercises the "is the row expired?" branch in the
    // store, which compares against the store's own `now`. We use a
    // FRESH store with the real wall clock so the test's
    // `Date.now() - offset` matches the store's notion of "now".
    const fresh = new InMemoryDistrictStore();
    const tenant = (await fresh.createTenant({ name: "T" })).id;
    const user = (await fresh.upsertUser(tenant, { externalId: "u" })).user.id;
    const issuedAt = new Date().toISOString();
    await fresh.insertRefreshToken({
      jti: "active",
      tenantId: tenant,
      userId: user,
      credentialIdB64url: "c",
      issuedAtIso: issuedAt,
      expiresAtIso: new Date(Date.now() + 60_000).toISOString(),
    });
    await fresh.insertRefreshToken({
      jti: "revoked",
      tenantId: tenant,
      userId: user,
      credentialIdB64url: "c",
      issuedAtIso: issuedAt,
      expiresAtIso: new Date(Date.now() + 60_000).toISOString(),
    });
    await fresh.insertRefreshToken({
      jti: "expired",
      tenantId: tenant,
      userId: user,
      credentialIdB64url: "c",
      issuedAtIso: issuedAt,
      expiresAtIso: new Date(Date.now() - 1000).toISOString(),
    });
    await fresh.revokeRefreshToken(tenant, "revoked");
    const list = await fresh.listActiveRefreshTokensForUser(tenant, user);
    expect(list.map((r) => r.jti)).toEqual(["active"]);
  });

  it("touchRefreshToken bumps lastUsedAt only when active", async () => {
    await insert("jti-1");
    expect(await c.store.touchRefreshToken(c.tenantA, "jti-1")).toBe(true);
    const row = await c.store.getRefreshToken(c.tenantA, "jti-1");
    expect(row?.lastUsedAtIso).toBeTruthy();
    await c.store.revokeRefreshToken(c.tenantA, "jti-1");
    expect(await c.store.touchRefreshToken(c.tenantA, "jti-1")).toBe(false);
  });
});
