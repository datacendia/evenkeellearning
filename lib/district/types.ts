// ─────────────────────────────────────────────────────────────────────────────
// lib/district/types.ts
//
// v1.8.2 — Multi-tenant district backend shape types.
//
// SCOPE
// ─────
// Shapes only. No persistence, no validation logic. Persistence lives
// in `lib/district/store.ts` (the interface) and one of its concrete
// implementations (`in-memory-store.ts` for pilot, a Postgres adapter
// for production — see `postgres-schema.sql` for the target DDL).
//
// MULTI-TENANCY MODEL
// ───────────────────
// EVERY persisted row is scoped by `tenantId`. The store enforces
// this: a fetch that omits `tenantId` is a programming error, and a
// fetch that supplies the wrong `tenantId` returns null (never leaks
// cross-tenant data, even by accident).
//
// IDS
// ───
// Stable UUIDs (RFC 4122 v4). The shape uses `string` so the in-
// memory store can use shorter ids in tests; the production
// (Postgres) adapter enforces UUID at the column level.
// ─────────────────────────────────────────────────────────────────────────────

/** Tenant = a single district / school / standalone classroom. */
export interface Tenant {
  /** Stable tenant identifier. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Optional jurisdiction (e.g. "GB", "US-NY", "IE-DL"). */
  jurisdiction?: string;
  /** Optional did:web identifier published as the issuer of this tenant's credentials. */
  issuerDid?: string;
  /** Subscription tier — affects feature flags, not capacity. */
  tier: "pilot" | "district" | "enterprise";
  /** When the tenant was provisioned. */
  createdAtIso: string;
  /** Soft-delete flag — true means the tenant is suspended. */
  suspended: boolean;
}

/** A tenant-scoped user account (instructor, learner, admin, IT staff). */
export interface TenantUser {
  /** Stable user id, scoped to the tenant. */
  id: string;
  /** Tenant this user belongs to. */
  tenantId: string;
  /**
   * External identifier — the value the LMS / SSO IdP uses to refer
   * to this user (SAML NameID, OIDC sub, SCIM externalId). Globally
   * unique within the tenant.
   */
  externalId: string;
  /**
   * Optional human-readable display name. NOT used for authentication.
   * Pilot keeps this short and bounded.
   */
  displayName?: string;
  /** Optional email — never used as a primary key. */
  email?: string;
  /** Whether this user is currently provisioned (active). */
  active: boolean;
  /** When the user was first seen. */
  createdAtIso: string;
  /** When the user was last updated. */
  updatedAtIso: string;
}

/** Role categories that can be granted to a tenant user. */
export type DistrictRole =
  | "tenant_admin" // full tenant control
  | "teacher" // instructor surface
  | "learner" // learner surface
  | "compliance_officer" // safeguarding dispatch + audit
  | "auditor"; // read-only audit access

/** Role binding = (user, role) pair within a tenant. */
export interface RoleBinding {
  /** Tenant this binding belongs to. */
  tenantId: string;
  /** User this role is granted to. */
  userId: string;
  /** Granted role. */
  role: DistrictRole;
  /** When the binding was granted. */
  grantedAtIso: string;
  /** Optional grantor user id (null for system-granted bindings). */
  grantedByUserId?: string;
}

/**
 * An audit event recording a security- or compliance-relevant action.
 * Audit events are APPEND-ONLY — nothing in the store may overwrite
 * or delete them. The Postgres adapter enforces this with a trigger.
 */
export interface AuditEvent {
  id: string;
  tenantId: string;
  /** ISO timestamp. */
  occurredAtIso: string;
  /** User who initiated the action; null for system events. */
  actorUserId?: string;
  /** Stable action code (e.g. "role_binding.granted", "user.suspended"). */
  action: string;
  /** Target user id, if the action is user-scoped. */
  targetUserId?: string;
  /** Free-form JSON-serialisable detail. */
  detail?: Record<string, unknown>;
}

/**
 * Server-side record of a passkey credential enrolled for a tenant user.
 *
 * The credentialId is the public, browser-visible identifier for the
 * key the authenticator created. The SPKI is the corresponding public
 * key (ECDSA-P256). The PRIVATE key never leaves the user's device.
 *
 * One user MAY have multiple passkey credentials (e.g. a phone + a
 * laptop + a hardware key). On revocation we set `revokedAtIso`
 * rather than deleting, so audit trails remain intact.
 */
export interface PasskeyCredential {
  id: string;
  tenantId: string;
  userId: string;
  /** Base64url credentialId returned by the authenticator. Unique per-tenant. */
  credentialIdB64url: string;
  /** Base64url SubjectPublicKeyInfo bytes (P-256 ES256 only). */
  spkiB64url: string;
  /** Most-recent signCount we observed (replay-detection ratchet). */
  signCount: number;
  /** Optional friendly label ("Alex's iPhone"). */
  label?: string;
  enrolledAtIso: string;
  lastUsedAtIso?: string;
  /** Set when the credential is revoked (lost device etc). null = active. */
  revokedAtIso?: string;
}

/**
 * Long-lived refresh token bound to a specific passkey credential.
 *
 * On refresh the client MUST produce a fresh WebAuthn assertion using
 * `credentialId`. The server verifies the assertion against the
 * stored SPKI before minting a new access token. An exfiltrated
 * refresh-token cookie is therefore useless without physical access
 * to the user's authenticator.
 *
 * The store row carries:
 *   • `jti`        — opaque token id (in the cookie body)
 *   • `credentialId` — the passkey it's bound to
 *   • `expiresAtIso`, `lastUsedAtIso` — TTL bookkeeping
 *   • `revokedAtIso` — logout / admin revocation
 */
export interface RefreshTokenRecord {
  jti: string;
  tenantId: string;
  userId: string;
  /** The passkey credential id this token is bound to. */
  credentialIdB64url: string;
  issuedAtIso: string;
  expiresAtIso: string;
  lastUsedAtIso?: string;
  revokedAtIso?: string;
}
