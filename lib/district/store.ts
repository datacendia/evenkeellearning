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
  PasskeyCredential,
  RefreshTokenRecord,
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

  // ── Passkey credentials ────────────────────────────────────────────
  /**
   * Register a new passkey credential for a user. Idempotent on
   * `credentialIdB64url`: re-enroling the same credential returns the
   * existing row without bumping `enrolledAtIso`.
   */
  addPasskeyCredential(
    tenantId: string,
    userId: string,
    input: AddPasskeyCredentialInput,
  ): Promise<PasskeyCredential | null>;
  /** Look up a credential by its base64url id. */
  getPasskeyCredentialByCredentialId(
    tenantId: string,
    credentialIdB64url: string,
  ): Promise<PasskeyCredential | null>;
  listPasskeyCredentialsForUser(
    tenantId: string,
    userId: string,
  ): Promise<PasskeyCredential[]>;
  /**
   * Mark a credential as revoked. Returns true if a row was changed.
   * Does NOT cascade to refresh tokens — caller decides whether to
   * also `revokeAllRefreshTokensForCredential`.
   */
  revokePasskeyCredential(
    tenantId: string,
    credentialIdB64url: string,
  ): Promise<boolean>;
  /**
   * Update `signCount` + `lastUsedAtIso` after a successful
   * verification. The store enforces the ratchet: signCount MUST
   * strictly increase, otherwise the call returns false (the caller
   * treats this as a potential clone attack).
   */
  recordPasskeyAssertion(
    tenantId: string,
    credentialIdB64url: string,
    newSignCount: number,
  ): Promise<boolean>;

  // ── Refresh tokens ─────────────────────────────────────────────────
  /** Insert a new refresh-token record. */
  insertRefreshToken(
    record: RefreshTokenRecord,
  ): Promise<RefreshTokenRecord>;
  /** Look up by jti within a tenant. */
  getRefreshToken(
    tenantId: string,
    jti: string,
  ): Promise<RefreshTokenRecord | null>;
  /** Mark a refresh token revoked. Returns true if a row was changed. */
  revokeRefreshToken(tenantId: string, jti: string): Promise<boolean>;
  /** Revoke every active refresh token for a user. Returns count. */
  revokeAllRefreshTokensForUser(
    tenantId: string,
    userId: string,
  ): Promise<number>;
  /** Revoke every active refresh token bound to a passkey credential. */
  revokeAllRefreshTokensForCredential(
    tenantId: string,
    credentialIdB64url: string,
  ): Promise<number>;
  /** List active (non-revoked, non-expired) tokens for a user. */
  listActiveRefreshTokensForUser(
    tenantId: string,
    userId: string,
  ): Promise<RefreshTokenRecord[]>;
  /** Record a successful refresh (bumps `lastUsedAtIso`). */
  touchRefreshToken(tenantId: string, jti: string): Promise<boolean>;
}

/** Input for `addPasskeyCredential`. */
export interface AddPasskeyCredentialInput {
  credentialIdB64url: string;
  spkiB64url: string;
  signCount: number;
  label?: string;
}
