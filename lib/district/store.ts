// ─────────────────────────────────────────────────────────────────────────────
// lib/district/store.ts
//
// v1.8.2 — DistrictStore interface.
//
// PURPOSE
// ───────
// A single, narrow abstraction over the multi-tenant persistence
// layer. Every consumer (LTI session bridge, SSO callback, SCIM
// provisioning endpoint, admin console) goes through this interface
// rather than knowing whether the backing store is in-memory,
// Postgres, or sharded.
//
// CONTRACT INVARIANTS
// ───────────────────
//   1. EVERY method that returns tenant-owned rows accepts `tenantId`
//      as its first non-optional argument. Cross-tenant access is
//      impossible by construction.
//   2. Audit events are APPEND-ONLY. The interface has `appendAudit`
//      but deliberately NO `deleteAudit` / `updateAudit`.
//   3. Methods return `null` for "not found" instead of throwing.
//      Throws are reserved for store-level faults (lost connection,
//      schema mismatch, etc.).
//   4. All write methods are idempotent on the (tenantId, externalId)
//      key tuple. Re-running a SCIM provisioning request must not
//      double-create the user.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  AuditEvent,
  DistrictRole,
  RoleBinding,
  Tenant,
  TenantUser,
} from "./types";

/** Input shape for creating a tenant. The store assigns `id` + dates. */
export interface CreateTenantInput {
  name: string;
  jurisdiction?: string;
  issuerDid?: string;
  tier?: Tenant["tier"];
}

/** Input shape for upserting a user via SCIM / SSO discovery. */
export interface UpsertUserInput {
  externalId: string;
  displayName?: string;
  email?: string;
  active?: boolean;
}

/** Result of `upsertUser` distinguishes create vs. update for audit. */
export interface UpsertUserResult {
  user: TenantUser;
  created: boolean;
}

/** Subset of fields callable to partially update a user. */
export interface UpdateUserInput {
  displayName?: string;
  email?: string;
  active?: boolean;
}

/** Audit-event input — store assigns id + occurredAtIso. */
export interface AppendAuditInput {
  actorUserId?: string;
  action: string;
  targetUserId?: string;
  detail?: Record<string, unknown>;
}

/**
 * The store interface. An implementation MUST satisfy the invariants
 * documented above.
 */
export interface DistrictStore {
  // ── Tenant lifecycle ───────────────────────────────────────────────
  createTenant(input: CreateTenantInput): Promise<Tenant>;
  getTenant(tenantId: string): Promise<Tenant | null>;
  listTenants(): Promise<Tenant[]>;
  suspendTenant(tenantId: string): Promise<Tenant | null>;
  reactivateTenant(tenantId: string): Promise<Tenant | null>;

  // ── User lifecycle (tenant-scoped) ─────────────────────────────────
  upsertUser(tenantId: string, input: UpsertUserInput): Promise<UpsertUserResult>;
  getUser(tenantId: string, userId: string): Promise<TenantUser | null>;
  getUserByExternalId(
    tenantId: string,
    externalId: string,
  ): Promise<TenantUser | null>;
  listUsers(tenantId: string): Promise<TenantUser[]>;
  updateUser(
    tenantId: string,
    userId: string,
    patch: UpdateUserInput,
  ): Promise<TenantUser | null>;

  // ── Role bindings ──────────────────────────────────────────────────
  grantRole(
    tenantId: string,
    userId: string,
    role: DistrictRole,
    grantedByUserId?: string,
  ): Promise<RoleBinding | null>;
  revokeRole(
    tenantId: string,
    userId: string,
    role: DistrictRole,
  ): Promise<boolean>;
  listRolesForUser(
    tenantId: string,
    userId: string,
  ): Promise<RoleBinding[]>;
  listUsersWithRole(
    tenantId: string,
    role: DistrictRole,
  ): Promise<RoleBinding[]>;
  userHasRole(
    tenantId: string,
    userId: string,
    role: DistrictRole,
  ): Promise<boolean>;

  // ── Audit log (append-only) ────────────────────────────────────────
  appendAudit(
    tenantId: string,
    input: AppendAuditInput,
  ): Promise<AuditEvent>;
  listAudit(
    tenantId: string,
    opts?: { limit?: number; sinceIso?: string },
  ): Promise<AuditEvent[]>;
}
