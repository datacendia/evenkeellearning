// ─────────────────────────────────────────────────────────────────────────────
// lib/district/index.ts
//
// v1.8.2 — Public surface of the district backend module.
//
// `getDistrictStore()` is the dependency-injection seam. Today it
// always returns the in-memory pilot store; once the Postgres
// adapter ships it will switch on `process.env.DISTRICT_STORE`
// ("memory" | "postgres") and route accordingly.
// ─────────────────────────────────────────────────────────────────────────────

import { InMemoryDistrictStore } from "./in-memory-store";
import type { DistrictStore } from "./store";

let cachedStore: DistrictStore | null = null;

/**
 * Return the singleton `DistrictStore` for this process.
 *
 * Today: always in-memory. Future: Postgres-backed when
 * `DISTRICT_STORE=postgres` and `DATABASE_URL` are set.
 */
export function getDistrictStore(): DistrictStore {
  if (cachedStore) return cachedStore;
  // The in-memory store refuses to instantiate in production unless
  // `allowInProduction: true` is passed. Until the Postgres adapter
  // exists, a production deploy MUST set `DISTRICT_STORE_PROD_OK=1`
  // to acknowledge the pilot-grade ephemeral storage.
  const allowInProduction = process.env.DISTRICT_STORE_PROD_OK === "1";
  cachedStore = new InMemoryDistrictStore({ allowInProduction });
  return cachedStore;
}

/** Test hook — reset the cached store so a fresh one is built next call. */
export function resetDistrictStore(): void {
  cachedStore = null;
}

export type {
  AppendAuditInput,
  CreateTenantInput,
  DistrictStore,
  UpdateUserInput,
  UpsertUserInput,
  UpsertUserResult,
} from "./store";
export type {
  AuditEvent,
  DistrictRole,
  RoleBinding,
  Tenant,
  TenantUser,
} from "./types";
export { InMemoryDistrictStore } from "./in-memory-store";
