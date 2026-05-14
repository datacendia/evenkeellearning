-- ───────────────────────────────────────────────────────────────────────────
-- lib/district/postgres-schema.sql
--
-- v1.8.2 — Target Postgres DDL for the district backend.
--
-- This file is the SOURCE OF TRUTH for the production schema. The
-- in-memory store implements the same contract; a future Postgres
-- adapter will satisfy this DDL exactly. Migrations land in
-- `migrations/0001-district-init.sql` when that adapter ships.
--
-- DESIGN NOTES
-- ────────────
--   • Multi-tenant rows ALWAYS carry `tenant_id` and ALWAYS index on it.
--     Row-level security policies (NOT shown here — they live in a
--     separate file once the adapter is built) enforce isolation at
--     the DB level so an SQL injection cannot return cross-tenant rows.
--   • Audit table has no UPDATE / DELETE permissions for the app role.
--     Postgres `REVOKE UPDATE, DELETE` enforces append-only.
--   • UUIDs use `gen_random_uuid()` from `pgcrypto`. The shape types
--     in `types.ts` keep `id: string` so the in-memory store can use
--     simpler ids in tests.
-- ───────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Tenants ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  jurisdiction    TEXT,
  issuer_did      TEXT,
  tier            TEXT NOT NULL CHECK (tier IN ('pilot','district','enterprise')),
  suspended       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenants_active ON tenants (suspended);

-- ── Users (tenant-scoped) ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenant_users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  external_id     TEXT NOT NULL,
  display_name    TEXT,
  email           TEXT,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_users_tenant ON tenant_users (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_users_email ON tenant_users (tenant_id, lower(email));

-- ── Role bindings ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS role_bindings (
  tenant_id       UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES tenant_users (id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (
    role IN ('tenant_admin','teacher','learner','compliance_officer','auditor')
  ),
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by      UUID REFERENCES tenant_users (id),
  PRIMARY KEY (tenant_id, user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_role_bindings_user ON role_bindings (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_role_bindings_role ON role_bindings (tenant_id, role);

-- ── Audit log (append-only) ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants (id) ON DELETE RESTRICT,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_user_id   UUID REFERENCES tenant_users (id),
  action          TEXT NOT NULL,
  target_user_id  UUID REFERENCES tenant_users (id),
  detail          JSONB
);

CREATE INDEX IF NOT EXISTS idx_audit_events_tenant_time
  ON audit_events (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor
  ON audit_events (tenant_id, actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_target
  ON audit_events (tenant_id, target_user_id);

-- App role MUST NOT be able to mutate or delete audit rows.
-- (Granted/revoked at deploy time; included here for documentation.)
--
-- REVOKE UPDATE, DELETE ON audit_events FROM evk_app_role;
-- GRANT INSERT, SELECT ON audit_events TO evk_app_role;
