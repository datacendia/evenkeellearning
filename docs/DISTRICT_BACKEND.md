# District Backend — Multi-tenant Foundation

**Status:** v1.8.2 — pilot scope. In-memory store only. Postgres adapter deferred to a follow-up commit (still tracked under `d1-backend`).

## Why this exists

The pilot platform stores everything browser-side (IndexedDB) or in process memory. That's correct for a single-classroom pilot but breaks down the moment a district wants:

- Cross-device session continuity for the same user
- A central audit log a compliance officer can review
- Role bindings that survive a server restart
- SSO / SCIM provisioning (which need a stable user identity)

The district backend is the explicit step where Even Keel acquires a real persistence layer. This commit lands the **abstraction** and an **in-memory implementation** so the rest of the district stack (`d1-auth`, `d2-sso-oidc`, `d2-sso-saml`, `d3-scim`, `d4-admin`) can be built and tested against a contract, with the Postgres adapter to follow.

## Data model

Four entities, every one tenant-scoped:

```
Tenant ─┬─ TenantUser ─┬─ RoleBinding ─→ DistrictRole
        │              └─ AuditEvent (target)
        └─ AuditEvent (actor)
```

| Entity | Key | Purpose |
|---|---|---|
| `Tenant` | `id` (UUID) | A district / school / pilot classroom |
| `TenantUser` | `(tenantId, externalId)` unique | An instructor / learner / admin |
| `RoleBinding` | `(tenantId, userId, role)` PK | Grants a `DistrictRole` to a user |
| `AuditEvent` | `id` (UUID); append-only | Security-relevant action record |

Full shapes in `lib/district/types.ts`. The target Postgres DDL is in `lib/district/postgres-schema.sql` (with row-level security policies, audit-table revoke-update-delete, and indexes).

## Roles

```ts
type DistrictRole =
  | "tenant_admin"        // full tenant control
  | "teacher"             // instructor surface
  | "learner"             // learner surface
  | "compliance_officer"  // safeguarding dispatch + audit
  | "auditor";            // read-only audit access
```

A user MAY hold multiple roles simultaneously. The runtime guard always asks `userHasRole(tenantId, userId, role)` and never assumes mutual exclusion.

## Contract invariants

Every implementation of `DistrictStore` must satisfy:

1. **Tenant isolation** — every read/write that returns or modifies tenant-owned rows takes `tenantId` as the first non-optional argument. A read across the wrong tenant returns `null`; a write throws.
2. **Append-only audit** — `appendAudit` is the only mutation; there is no `deleteAudit` or `updateAudit`. The Postgres adapter enforces this with `REVOKE UPDATE, DELETE` on the app role.
3. **Idempotent writes** — `upsertUser(tenantId, { externalId, ... })` and `grantRole(tenantId, userId, role)` are safe to call repeatedly. SCIM/SSO retries don't double-create.
4. **Null vs throw** — `null` is "not found". Throws are reserved for store-level faults (lost connection, schema mismatch).
5. **Defensive cloning** — reads return FRESH copies; a caller mutating the returned object cannot mutate stored state.

The contract is codified in `tests/unit/district-store.test.ts`. The same suite will be run against the Postgres adapter when it lands.

## In-memory store

`InMemoryDistrictStore` is the v1 implementation. Properties:

- Process-local, volatile — restart loses everything.
- Refuses to instantiate when `NODE_ENV=production` unless `allowInProduction: true` is explicitly passed (acknowledging ephemeral storage).
- O(1) lookups via internal indexes (`Map<tenantId, Map<externalId, userId>>`).
- Defensive clones on every read.

Use `getDistrictStore()` from `lib/district/index.ts` everywhere — it returns a singleton and is the dependency-injection seam for swapping in the Postgres adapter later.

## Postgres adapter (deferred)

The target schema is checked into `lib/district/postgres-schema.sql`. The adapter will:

- Use `pg` driver (or `postgres.js`) directly — no ORM dependency.
- Honour `DATABASE_URL` env var.
- Enable row-level security policies keyed on `app.current_tenant` (set per-request via `SET LOCAL`).
- Revoke `UPDATE, DELETE` on `audit_events` from the app role.
- Run migrations via a tiny `scripts/migrate.mjs` runner — no migration tool dependency.

Until that adapter ships, production deploys MUST set `DISTRICT_STORE_PROD_OK=1` to opt in to ephemeral storage. Without it, instantiating the store throws on startup.

## How downstream features use this

| Feature | Usage |
|---|---|
| `d1-auth` refresh tokens | One row per token, stored alongside the user (extension table). |
| `d2-sso-oidc` | OIDC callback resolves the user via `upsertUser(tenantId, { externalId: sub })`. |
| `d2-sso-saml` | Same pattern, externalId is the SAML NameID. |
| `d3-scim` | SCIM provisioning maps directly to `upsertUser` / `updateUser` / `active: false`. |
| `d4-admin` | Tenant admin console pages render `listUsers`, `listAudit`, role binding CRUD. |
| `lib/lti/launch.ts` | Existing LTI session bridge will be extended to upsert the LMS user into a tenant. |

## Limitations

- **Single-process** until Postgres adapter ships.
- **No row-level encryption** for `email` / `display_name` — those are stored in clear. PII minimisation: we keep these fields *optional* and most surfaces avoid them.
- **Audit query API is thin** — `limit` + `sinceIso` only. Time-window + actor filtering lands with the admin console.

## Source

| File | Purpose |
|---|---|
| `lib/district/types.ts` | Shape types |
| `lib/district/store.ts` | `DistrictStore` interface contract |
| `lib/district/in-memory-store.ts` | Pilot implementation |
| `lib/district/postgres-schema.sql` | Target Postgres DDL |
| `lib/district/index.ts` | `getDistrictStore()` factory + public re-exports |
| `tests/unit/district-store.test.ts` | 34 contract tests |
