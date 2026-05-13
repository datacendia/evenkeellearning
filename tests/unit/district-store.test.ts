// ─────────────────────────────────────────────────────────────────────────────
// tests/unit/district-store.test.ts
//
// v1.8.2 — Comprehensive tests for the InMemoryDistrictStore against
// the DistrictStore interface contract.
//
// The same test suite will be applied to the Postgres adapter once it
// ships — every assertion here is a contract clause every adapter must
// satisfy.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryDistrictStore } from "../../lib/district/in-memory-store";
import type { DistrictStore } from "../../lib/district/store";

// Deterministic id generator for predictable test output.
function makeIdGen(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${(++n).toString().padStart(4, "0")}`;
}

function makeStore(): DistrictStore {
  let clock = Date.parse("2026-05-01T00:00:00Z");
  return new InMemoryDistrictStore({
    now: () => {
      clock += 1000; // 1s per call → deterministic ordering
      return clock;
    },
    newId: makeIdGen("id"),
  });
}

describe("DistrictStore — tenants", () => {
  let store: DistrictStore;
  beforeEach(() => {
    store = makeStore();
  });

  it("creates a tenant with defaults", async () => {
    const t = await store.createTenant({ name: "Acme District" });
    expect(t.name).toBe("Acme District");
    expect(t.tier).toBe("pilot");
    expect(t.suspended).toBe(false);
    expect(t.id).toBeTruthy();
    expect(t.createdAtIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("getTenant returns null for unknown id", async () => {
    expect(await store.getTenant("nope")).toBeNull();
  });

  it("getTenant returns a copy (caller can't mutate stored row)", async () => {
    const t = await store.createTenant({ name: "Acme" });
    t.name = "Mutated";
    const refetched = await store.getTenant(t.id);
    expect(refetched?.name).toBe("Acme");
  });

  it("listTenants returns all created tenants", async () => {
    await store.createTenant({ name: "A" });
    await store.createTenant({ name: "B" });
    expect((await store.listTenants()).length).toBe(2);
  });

  it("suspend / reactivate toggle the suspended flag", async () => {
    const t = await store.createTenant({ name: "Acme" });
    expect((await store.suspendTenant(t.id))?.suspended).toBe(true);
    expect((await store.reactivateTenant(t.id))?.suspended).toBe(false);
  });

  it("suspend / reactivate return null for unknown id", async () => {
    expect(await store.suspendTenant("nope")).toBeNull();
    expect(await store.reactivateTenant("nope")).toBeNull();
  });
});

describe("DistrictStore — users", () => {
  let store: DistrictStore;
  let tenantA: string;
  let tenantB: string;
  beforeEach(async () => {
    store = makeStore();
    tenantA = (await store.createTenant({ name: "A" })).id;
    tenantB = (await store.createTenant({ name: "B" })).id;
  });

  it("upsertUser creates a fresh user", async () => {
    const { user, created } = await store.upsertUser(tenantA, {
      externalId: "ext-1",
      displayName: "Alex",
      email: "alex@example",
    });
    expect(created).toBe(true);
    expect(user.tenantId).toBe(tenantA);
    expect(user.externalId).toBe("ext-1");
    expect(user.displayName).toBe("Alex");
    expect(user.active).toBe(true);
  });

  it("upsertUser is idempotent on (tenantId, externalId)", async () => {
    const r1 = await store.upsertUser(tenantA, {
      externalId: "ext-1",
      displayName: "Alex",
    });
    const r2 = await store.upsertUser(tenantA, {
      externalId: "ext-1",
      displayName: "Alex Updated",
    });
    expect(r1.created).toBe(true);
    expect(r2.created).toBe(false);
    expect(r2.user.id).toBe(r1.user.id);
    expect(r2.user.displayName).toBe("Alex Updated");
  });

  it("the same externalId in different tenants creates two distinct users", async () => {
    const u1 = await store.upsertUser(tenantA, { externalId: "shared" });
    const u2 = await store.upsertUser(tenantB, { externalId: "shared" });
    expect(u1.user.id).not.toBe(u2.user.id);
  });

  it("getUser refuses to leak a user across tenants", async () => {
    const u = await store.upsertUser(tenantA, { externalId: "x" });
    expect(await store.getUser(tenantA, u.user.id)).not.toBeNull();
    // tenant B asking for tenant A's user MUST get null
    expect(await store.getUser(tenantB, u.user.id)).toBeNull();
  });

  it("getUserByExternalId returns the user for the right tenant", async () => {
    await store.upsertUser(tenantA, { externalId: "ext-1" });
    const got = await store.getUserByExternalId(tenantA, "ext-1");
    expect(got).not.toBeNull();
    expect(got?.externalId).toBe("ext-1");
  });

  it("getUserByExternalId returns null in the wrong tenant", async () => {
    await store.upsertUser(tenantA, { externalId: "ext-1" });
    expect(await store.getUserByExternalId(tenantB, "ext-1")).toBeNull();
  });

  it("listUsers is scoped per tenant", async () => {
    await store.upsertUser(tenantA, { externalId: "a" });
    await store.upsertUser(tenantA, { externalId: "b" });
    await store.upsertUser(tenantB, { externalId: "c" });
    expect((await store.listUsers(tenantA)).length).toBe(2);
    expect((await store.listUsers(tenantB)).length).toBe(1);
  });

  it("updateUser patches only the supplied fields", async () => {
    const { user } = await store.upsertUser(tenantA, {
      externalId: "ext-1",
      displayName: "Alex",
      email: "alex@example",
    });
    const patched = await store.updateUser(tenantA, user.id, { email: "new@example" });
    expect(patched?.email).toBe("new@example");
    expect(patched?.displayName).toBe("Alex");
  });

  it("updateUser returns null when the user is in a different tenant", async () => {
    const { user } = await store.upsertUser(tenantA, { externalId: "ext-1" });
    expect(
      await store.updateUser(tenantB, user.id, { displayName: "x" }),
    ).toBeNull();
  });

  it("updateUser can mark a user inactive (soft-delete)", async () => {
    const { user } = await store.upsertUser(tenantA, { externalId: "ext-1" });
    const patched = await store.updateUser(tenantA, user.id, { active: false });
    expect(patched?.active).toBe(false);
  });

  it("upsertUser refuses unknown tenant", async () => {
    await expect(
      store.upsertUser("unknown-tenant", { externalId: "x" }),
    ).rejects.toThrow(/tenant_not_found/);
  });
});

describe("DistrictStore — role bindings", () => {
  let store: DistrictStore;
  let tenantA: string;
  let tenantB: string;
  let userA: string;
  let userB: string;
  beforeEach(async () => {
    store = makeStore();
    tenantA = (await store.createTenant({ name: "A" })).id;
    tenantB = (await store.createTenant({ name: "B" })).id;
    userA = (await store.upsertUser(tenantA, { externalId: "ua" })).user.id;
    userB = (await store.upsertUser(tenantB, { externalId: "ub" })).user.id;
  });

  it("grants and lists a role", async () => {
    const binding = await store.grantRole(tenantA, userA, "teacher");
    expect(binding?.role).toBe("teacher");
    const list = await store.listRolesForUser(tenantA, userA);
    expect(list.map((b) => b.role)).toEqual(["teacher"]);
  });

  it("grantRole is idempotent (re-granting returns the same binding)", async () => {
    const b1 = await store.grantRole(tenantA, userA, "teacher");
    const b2 = await store.grantRole(tenantA, userA, "teacher");
    expect(b1?.grantedAtIso).toBe(b2?.grantedAtIso);
    const list = await store.listRolesForUser(tenantA, userA);
    expect(list.length).toBe(1);
  });

  it("revokeRole removes the binding and reports it", async () => {
    await store.grantRole(tenantA, userA, "teacher");
    expect(await store.revokeRole(tenantA, userA, "teacher")).toBe(true);
    expect(await store.userHasRole(tenantA, userA, "teacher")).toBe(false);
  });

  it("revokeRole returns false when there's nothing to revoke", async () => {
    expect(await store.revokeRole(tenantA, userA, "teacher")).toBe(false);
  });

  it("listRolesForUser is tenant-scoped", async () => {
    await store.grantRole(tenantA, userA, "teacher");
    expect((await store.listRolesForUser(tenantB, userA)).length).toBe(0);
  });

  it("listUsersWithRole returns only bindings in that tenant + role", async () => {
    await store.grantRole(tenantA, userA, "teacher");
    await store.grantRole(tenantB, userB, "teacher");
    const onlyA = await store.listUsersWithRole(tenantA, "teacher");
    expect(onlyA.length).toBe(1);
    expect(onlyA[0].userId).toBe(userA);
  });

  it("grantRole refuses a user from a different tenant", async () => {
    const r = await store.grantRole(tenantA, userB, "teacher");
    expect(r).toBeNull();
  });

  it("userHasRole returns true / false correctly", async () => {
    expect(await store.userHasRole(tenantA, userA, "teacher")).toBe(false);
    await store.grantRole(tenantA, userA, "teacher");
    expect(await store.userHasRole(tenantA, userA, "teacher")).toBe(true);
    expect(await store.userHasRole(tenantA, userA, "tenant_admin")).toBe(false);
  });

  it("supports multiple roles on the same user", async () => {
    await store.grantRole(tenantA, userA, "teacher");
    await store.grantRole(tenantA, userA, "compliance_officer");
    const roles = (await store.listRolesForUser(tenantA, userA)).map((b) => b.role);
    expect(roles.sort()).toEqual(["compliance_officer", "teacher"]);
  });
});

describe("DistrictStore — audit log", () => {
  let store: DistrictStore;
  let tenantA: string;
  let tenantB: string;
  beforeEach(async () => {
    store = makeStore();
    tenantA = (await store.createTenant({ name: "A" })).id;
    tenantB = (await store.createTenant({ name: "B" })).id;
  });

  it("appends and lists an event", async () => {
    const e = await store.appendAudit(tenantA, {
      action: "user.created",
      detail: { externalId: "ext-1" },
    });
    expect(e.id).toBeTruthy();
    expect(e.action).toBe("user.created");
    const list = await store.listAudit(tenantA);
    expect(list.length).toBe(1);
    expect(list[0].detail?.externalId).toBe("ext-1");
  });

  it("listAudit is tenant-scoped", async () => {
    await store.appendAudit(tenantA, { action: "a" });
    await store.appendAudit(tenantB, { action: "b" });
    expect((await store.listAudit(tenantA)).map((e) => e.action)).toEqual(["a"]);
    expect((await store.listAudit(tenantB)).map((e) => e.action)).toEqual(["b"]);
  });

  it("listAudit honours `limit` (returns the most recent N)", async () => {
    for (let i = 0; i < 5; i++) {
      await store.appendAudit(tenantA, { action: `act-${i}` });
    }
    const got = await store.listAudit(tenantA, { limit: 2 });
    expect(got.map((e) => e.action)).toEqual(["act-3", "act-4"]);
  });

  it("listAudit honours `sinceIso`", async () => {
    const e1 = await store.appendAudit(tenantA, { action: "a" });
    await store.appendAudit(tenantA, { action: "b" });
    const after = await store.listAudit(tenantA, { sinceIso: e1.occurredAtIso });
    // Both events occur at or after e1 (e1 itself included because >=).
    expect(after.length).toBeGreaterThanOrEqual(1);
  });

  it("appendAudit defensively clones the detail object (caller can't mutate stored event)", async () => {
    const detail = { a: 1 };
    const e = await store.appendAudit(tenantA, { action: "x", detail });
    detail.a = 2;
    const got = (await store.listAudit(tenantA))[0];
    expect(got.detail?.a).toBe(1);
    // And the returned object is also a fresh copy.
    e.detail!.a = 99;
    const refetched = (await store.listAudit(tenantA))[0];
    expect(refetched.detail?.a).toBe(1);
  });

  it("appendAudit refuses unknown tenant", async () => {
    await expect(
      store.appendAudit("unknown", { action: "x" }),
    ).rejects.toThrow(/tenant_not_found/);
  });
});

describe("DistrictStore — cross-tenant isolation invariants", () => {
  let store: DistrictStore;
  beforeEach(() => {
    store = makeStore();
  });

  it("a user id from tenant A is invisible to tenant B for ALL read paths", async () => {
    const tA = (await store.createTenant({ name: "A" })).id;
    const tB = (await store.createTenant({ name: "B" })).id;
    const u = (await store.upsertUser(tA, { externalId: "x" })).user;
    await store.grantRole(tA, u.id, "teacher");
    // Direct fetch
    expect(await store.getUser(tB, u.id)).toBeNull();
    // External-id fetch
    expect(await store.getUserByExternalId(tB, "x")).toBeNull();
    // Roles
    expect((await store.listRolesForUser(tB, u.id)).length).toBe(0);
    // Tenant listing
    expect((await store.listUsers(tB)).length).toBe(0);
    expect((await store.listUsersWithRole(tB, "teacher")).length).toBe(0);
  });
});

describe("InMemoryDistrictStore — production guard", () => {
  it("refuses to instantiate when NODE_ENV=production unless explicitly allowed", () => {
    const prev = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      expect(() => new InMemoryDistrictStore()).toThrow(/refuses to run in production/);
      // Override is allowed if the caller acknowledges.
      expect(
        () => new InMemoryDistrictStore({ allowInProduction: true }),
      ).not.toThrow();
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
