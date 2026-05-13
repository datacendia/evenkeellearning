// ─────────────────────────────────────────────────────────────────────────────
// lib/district/in-memory-store.ts
//
// v1.8.2 — Pilot-scale, in-memory implementation of DistrictStore.
//
// PURPOSE
// ───────
// Lets the rest of the district stack (LTI session bridge, SSO, SCIM,
// admin console) be built and tested without a running Postgres
// instance. The interface contract is identical to what the eventual
// Postgres adapter (`postgres-store.ts`, future) must satisfy, so
// swapping the implementation is a one-line dependency-injection
// change in `getDistrictStore()`.
//
// IMPORTANT
// ─────────
// THIS STORE IS PROCESS-LOCAL AND VOLATILE. Restarting the server
// loses every tenant, user, role binding, and audit event. It is
// suitable for:
//   • unit tests
//   • a single-process pilot where data loss is acceptable
//   • local development
//
// It is NOT suitable for any production deployment. The
// `assertNotProduction` helper at the bottom throws if a process
// running in `NODE_ENV=production` tries to instantiate this store
// without an explicit `allowInProduction: true` override (set in a
// deploy that genuinely wants ephemeral storage — e.g. a demo VM).
// ─────────────────────────────────────────────────────────────────────────────

import type {
  AddPasskeyCredentialInput,
  AppendAuditInput,
  CreateTenantInput,
  DistrictStore,
  UpdateUserInput,
  UpsertUserInput,
  UpsertUserResult,
} from "./store";
import type {
  AuditEvent,
  DistrictRole,
  PasskeyCredential,
  RefreshTokenRecord,
  RoleBinding,
  Tenant,
  TenantUser,
} from "./types";

interface InMemoryStoreOptions {
  /**
   * Set to true if you ABSOLUTELY want to use the in-memory store in
   * a process running with `NODE_ENV=production`. Default: refuse.
   */
  allowInProduction?: boolean;
  /**
   * Inject a clock for deterministic tests. Defaults to `Date.now()`.
   */
  now?: () => number;
  /**
   * Inject an id generator for deterministic tests. Defaults to a
   * crypto-strong random.
   */
  newId?: () => string;
}

export class InMemoryDistrictStore implements DistrictStore {
  private tenants = new Map<string, Tenant>();
  private users = new Map<string, TenantUser>(); // keyed by user id
  // Index: tenantId -> externalId -> userId. Lets `getUserByExternalId`
  // be O(1) and enforces the (tenantId, externalId) uniqueness invariant
  // documented in the store contract.
  private externalIndex = new Map<string, Map<string, string>>();
  private bindings: RoleBinding[] = [];
  private audit: AuditEvent[] = [];
  private credentials: PasskeyCredential[] = [];
  private refreshTokens = new Map<string, RefreshTokenRecord>(); // keyed by jti

  private now: () => number;
  private newId: () => string;

  constructor(opts: InMemoryStoreOptions = {}) {
    assertNotProduction(opts);
    this.now = opts.now ?? (() => Date.now());
    this.newId = opts.newId ?? defaultNewId;
  }

  // ── tenants ────────────────────────────────────────────────────────

  async createTenant(input: CreateTenantInput): Promise<Tenant> {
    const tenant: Tenant = {
      id: this.newId(),
      name: input.name,
      jurisdiction: input.jurisdiction,
      issuerDid: input.issuerDid,
      tier: input.tier ?? "pilot",
      createdAtIso: this.iso(),
      suspended: false,
    };
    this.tenants.set(tenant.id, tenant);
    this.externalIndex.set(tenant.id, new Map());
    return cloneTenant(tenant);
  }

  async getTenant(tenantId: string): Promise<Tenant | null> {
    const t = this.tenants.get(tenantId);
    return t ? cloneTenant(t) : null;
  }

  async listTenants(): Promise<Tenant[]> {
    return Array.from(this.tenants.values()).map(cloneTenant);
  }

  async suspendTenant(tenantId: string): Promise<Tenant | null> {
    const t = this.tenants.get(tenantId);
    if (!t) return null;
    t.suspended = true;
    return cloneTenant(t);
  }

  async reactivateTenant(tenantId: string): Promise<Tenant | null> {
    const t = this.tenants.get(tenantId);
    if (!t) return null;
    t.suspended = false;
    return cloneTenant(t);
  }

  // ── users ──────────────────────────────────────────────────────────

  async upsertUser(
    tenantId: string,
    input: UpsertUserInput,
  ): Promise<UpsertUserResult> {
    this.requireTenant(tenantId);
    const tenantIndex = this.externalIndex.get(tenantId)!;
    const existingId = tenantIndex.get(input.externalId);
    if (existingId) {
      const existing = this.users.get(existingId)!;
      // Only patch the fields the caller explicitly supplied. SCIM
      // partial-update semantics live in the SCIM adapter, not here.
      if (input.displayName !== undefined) existing.displayName = input.displayName;
      if (input.email !== undefined) existing.email = input.email;
      if (input.active !== undefined) existing.active = input.active;
      existing.updatedAtIso = this.iso();
      return { user: cloneUser(existing), created: false };
    }
    const user: TenantUser = {
      id: this.newId(),
      tenantId,
      externalId: input.externalId,
      displayName: input.displayName,
      email: input.email,
      active: input.active ?? true,
      createdAtIso: this.iso(),
      updatedAtIso: this.iso(),
    };
    this.users.set(user.id, user);
    tenantIndex.set(input.externalId, user.id);
    return { user: cloneUser(user), created: true };
  }

  async getUser(
    tenantId: string,
    userId: string,
  ): Promise<TenantUser | null> {
    const u = this.users.get(userId);
    if (!u || u.tenantId !== tenantId) return null;
    return cloneUser(u);
  }

  async getUserByExternalId(
    tenantId: string,
    externalId: string,
  ): Promise<TenantUser | null> {
    const tenantIndex = this.externalIndex.get(tenantId);
    if (!tenantIndex) return null;
    const id = tenantIndex.get(externalId);
    if (!id) return null;
    const u = this.users.get(id);
    return u ? cloneUser(u) : null;
  }

  async listUsers(tenantId: string): Promise<TenantUser[]> {
    const out: TenantUser[] = [];
    for (const u of this.users.values()) {
      if (u.tenantId === tenantId) out.push(cloneUser(u));
    }
    return out;
  }

  async updateUser(
    tenantId: string,
    userId: string,
    patch: UpdateUserInput,
  ): Promise<TenantUser | null> {
    const u = this.users.get(userId);
    if (!u || u.tenantId !== tenantId) return null;
    if (patch.displayName !== undefined) u.displayName = patch.displayName;
    if (patch.email !== undefined) u.email = patch.email;
    if (patch.active !== undefined) u.active = patch.active;
    u.updatedAtIso = this.iso();
    return cloneUser(u);
  }

  // ── role bindings ──────────────────────────────────────────────────

  async grantRole(
    tenantId: string,
    userId: string,
    role: DistrictRole,
    grantedByUserId?: string,
  ): Promise<RoleBinding | null> {
    // Refuse if user doesn't exist or belongs to a different tenant.
    const u = this.users.get(userId);
    if (!u || u.tenantId !== tenantId) return null;
    // Idempotent: re-granting the same role returns the existing binding.
    const existing = this.bindings.find(
      (b) => b.tenantId === tenantId && b.userId === userId && b.role === role,
    );
    if (existing) return cloneBinding(existing);
    const binding: RoleBinding = {
      tenantId,
      userId,
      role,
      grantedAtIso: this.iso(),
      grantedByUserId,
    };
    this.bindings.push(binding);
    return cloneBinding(binding);
  }

  async revokeRole(
    tenantId: string,
    userId: string,
    role: DistrictRole,
  ): Promise<boolean> {
    const before = this.bindings.length;
    this.bindings = this.bindings.filter(
      (b) => !(b.tenantId === tenantId && b.userId === userId && b.role === role),
    );
    return this.bindings.length < before;
  }

  async listRolesForUser(
    tenantId: string,
    userId: string,
  ): Promise<RoleBinding[]> {
    return this.bindings
      .filter((b) => b.tenantId === tenantId && b.userId === userId)
      .map(cloneBinding);
  }

  async listUsersWithRole(
    tenantId: string,
    role: DistrictRole,
  ): Promise<RoleBinding[]> {
    return this.bindings
      .filter((b) => b.tenantId === tenantId && b.role === role)
      .map(cloneBinding);
  }

  async userHasRole(
    tenantId: string,
    userId: string,
    role: DistrictRole,
  ): Promise<boolean> {
    return this.bindings.some(
      (b) => b.tenantId === tenantId && b.userId === userId && b.role === role,
    );
  }

  // ── audit ──────────────────────────────────────────────────────────

  async appendAudit(
    tenantId: string,
    input: AppendAuditInput,
  ): Promise<AuditEvent> {
    this.requireTenant(tenantId);
    const event: AuditEvent = {
      id: this.newId(),
      tenantId,
      occurredAtIso: this.iso(),
      actorUserId: input.actorUserId,
      action: input.action,
      targetUserId: input.targetUserId,
      detail: input.detail
        ? // Defensive clone — caller shouldn't be able to mutate stored audit.
          JSON.parse(JSON.stringify(input.detail))
        : undefined,
    };
    this.audit.push(event);
    return cloneAudit(event);
  }

  async listAudit(
    tenantId: string,
    opts: { limit?: number; sinceIso?: string } = {},
  ): Promise<AuditEvent[]> {
    let rows = this.audit.filter((e) => e.tenantId === tenantId);
    if (opts.sinceIso) {
      rows = rows.filter((e) => e.occurredAtIso >= opts.sinceIso!);
    }
    rows = rows.slice().sort((a, b) => a.occurredAtIso.localeCompare(b.occurredAtIso));
    if (opts.limit !== undefined && opts.limit >= 0) {
      rows = rows.slice(-opts.limit);
    }
    return rows.map(cloneAudit);
  }

  // ── passkey credentials ────────────────────────────────────────────

  async addPasskeyCredential(
    tenantId: string,
    userId: string,
    input: AddPasskeyCredentialInput,
  ): Promise<PasskeyCredential | null> {
    const u = this.users.get(userId);
    if (!u || u.tenantId !== tenantId) return null;
    // Idempotent on credentialIdB64url within the tenant.
    const existing = this.credentials.find(
      (c) =>
        c.tenantId === tenantId &&
        c.credentialIdB64url === input.credentialIdB64url,
    );
    if (existing) return cloneCredential(existing);
    const record: PasskeyCredential = {
      id: this.newId(),
      tenantId,
      userId,
      credentialIdB64url: input.credentialIdB64url,
      spkiB64url: input.spkiB64url,
      signCount: input.signCount,
      label: input.label,
      enrolledAtIso: this.iso(),
    };
    this.credentials.push(record);
    return cloneCredential(record);
  }

  async getPasskeyCredentialByCredentialId(
    tenantId: string,
    credentialIdB64url: string,
  ): Promise<PasskeyCredential | null> {
    const c = this.credentials.find(
      (x) =>
        x.tenantId === tenantId && x.credentialIdB64url === credentialIdB64url,
    );
    return c ? cloneCredential(c) : null;
  }

  async listPasskeyCredentialsForUser(
    tenantId: string,
    userId: string,
  ): Promise<PasskeyCredential[]> {
    return this.credentials
      .filter((c) => c.tenantId === tenantId && c.userId === userId)
      .map(cloneCredential);
  }

  async revokePasskeyCredential(
    tenantId: string,
    credentialIdB64url: string,
  ): Promise<boolean> {
    const c = this.credentials.find(
      (x) =>
        x.tenantId === tenantId && x.credentialIdB64url === credentialIdB64url,
    );
    if (!c) return false;
    if (c.revokedAtIso) return false; // already revoked
    c.revokedAtIso = this.iso();
    return true;
  }

  async recordPasskeyAssertion(
    tenantId: string,
    credentialIdB64url: string,
    newSignCount: number,
  ): Promise<boolean> {
    const c = this.credentials.find(
      (x) =>
        x.tenantId === tenantId && x.credentialIdB64url === credentialIdB64url,
    );
    if (!c) return false;
    if (c.revokedAtIso) return false;
    // Strict ratchet: a stale or equal signCount is rejected because
    // the FIDO spec says authenticators MUST monotonically increment.
    // The only legitimate case for signCount === 0 is an authenticator
    // that doesn't implement counters; in that case both sides remain
    // 0 forever and we tolerate equality only when both are 0.
    if (newSignCount === 0 && c.signCount === 0) {
      c.lastUsedAtIso = this.iso();
      return true;
    }
    if (newSignCount <= c.signCount) return false;
    c.signCount = newSignCount;
    c.lastUsedAtIso = this.iso();
    return true;
  }

  // ── refresh tokens ─────────────────────────────────────────────────

  async insertRefreshToken(
    record: RefreshTokenRecord,
  ): Promise<RefreshTokenRecord> {
    // Defensive copy on the way in so the caller can't mutate the
    // stored row by holding onto their input reference.
    const stored: RefreshTokenRecord = { ...record };
    this.refreshTokens.set(stored.jti, stored);
    return cloneRefreshToken(stored);
  }

  async getRefreshToken(
    tenantId: string,
    jti: string,
  ): Promise<RefreshTokenRecord | null> {
    const r = this.refreshTokens.get(jti);
    if (!r || r.tenantId !== tenantId) return null;
    return cloneRefreshToken(r);
  }

  async revokeRefreshToken(tenantId: string, jti: string): Promise<boolean> {
    const r = this.refreshTokens.get(jti);
    if (!r || r.tenantId !== tenantId) return false;
    if (r.revokedAtIso) return false;
    r.revokedAtIso = this.iso();
    return true;
  }

  async revokeAllRefreshTokensForUser(
    tenantId: string,
    userId: string,
  ): Promise<number> {
    let count = 0;
    for (const r of this.refreshTokens.values()) {
      if (r.tenantId === tenantId && r.userId === userId && !r.revokedAtIso) {
        r.revokedAtIso = this.iso();
        count++;
      }
    }
    return count;
  }

  async revokeAllRefreshTokensForCredential(
    tenantId: string,
    credentialIdB64url: string,
  ): Promise<number> {
    let count = 0;
    for (const r of this.refreshTokens.values()) {
      if (
        r.tenantId === tenantId &&
        r.credentialIdB64url === credentialIdB64url &&
        !r.revokedAtIso
      ) {
        r.revokedAtIso = this.iso();
        count++;
      }
    }
    return count;
  }

  async listActiveRefreshTokensForUser(
    tenantId: string,
    userId: string,
  ): Promise<RefreshTokenRecord[]> {
    const nowIso = this.iso();
    const out: RefreshTokenRecord[] = [];
    for (const r of this.refreshTokens.values()) {
      if (r.tenantId !== tenantId) continue;
      if (r.userId !== userId) continue;
      if (r.revokedAtIso) continue;
      if (r.expiresAtIso <= nowIso) continue;
      out.push(cloneRefreshToken(r));
    }
    return out;
  }

  async touchRefreshToken(tenantId: string, jti: string): Promise<boolean> {
    const r = this.refreshTokens.get(jti);
    if (!r || r.tenantId !== tenantId) return false;
    if (r.revokedAtIso) return false;
    r.lastUsedAtIso = this.iso();
    return true;
  }

  // ── helpers ────────────────────────────────────────────────────────

  private iso(): string {
    return new Date(this.now()).toISOString();
  }

  private requireTenant(tenantId: string): void {
    if (!this.tenants.has(tenantId)) {
      throw new Error(`tenant_not_found: ${tenantId}`);
    }
  }
}

function defaultNewId(): string {
  // RFC 4122 v4-ish: 16 random bytes, hex with dashes. Sufficient for
  // pilot scale. Production (Postgres) uses `gen_random_uuid()`.
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 1
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20)}`;
}

function assertNotProduction(opts: InMemoryStoreOptions): void {
  if (
    process.env.NODE_ENV === "production" &&
    !opts.allowInProduction
  ) {
    throw new Error(
      "InMemoryDistrictStore refuses to run in production unless `allowInProduction: true` is explicitly passed. " +
        "Wire up the Postgres adapter instead — see lib/district/postgres-schema.sql.",
    );
  }
}

// ── Defensive cloning ────────────────────────────────────────────────
//
// The store hands callers FRESH copies so a mutation by the caller
// can't ever rewrite a stored row. The Postgres adapter gets this
// for free; the in-memory store needs explicit clones.

function cloneTenant(t: Tenant): Tenant {
  return { ...t };
}
function cloneUser(u: TenantUser): TenantUser {
  return { ...u };
}
function cloneBinding(b: RoleBinding): RoleBinding {
  return { ...b };
}
function cloneAudit(e: AuditEvent): AuditEvent {
  return {
    ...e,
    detail: e.detail ? JSON.parse(JSON.stringify(e.detail)) : undefined,
  };
}
function cloneCredential(c: PasskeyCredential): PasskeyCredential {
  return { ...c };
}
function cloneRefreshToken(r: RefreshTokenRecord): RefreshTokenRecord {
  return { ...r };
}
