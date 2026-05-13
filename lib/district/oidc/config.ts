// ─────────────────────────────────────────────────────────────────────────────
// lib/district/oidc/config.ts
//
// v1.8.5 — Per-tenant OIDC provider registry loader.
//
// SOURCES (first hit wins)
// ────────────────────────
//   1. `DISTRICT_OIDC_PROVIDERS_JSON`  — JSON array of entries, each:
//        {
//          tenantId: "tenant-a",
//          provider: { id, label, issuer, clientId, clientSecret?, ... }
//        }
//      Highest priority. Production deployments ship this via their
//      secret store (Vault, AWS SSM parameter, Doppler, etc.) and
//      inject it at boot.
//
//   2. Compile-time `BUILTIN_OIDC_PROVIDERS` (dev fixture) — used only
//      when `NODE_ENV !== "production"`. Prevents tests from needing
//      to set an env var.
//
// VALIDATION
// ──────────
// Shape-validated at load time. A bad entry is logged and skipped
// rather than crashing the module — one misconfigured tenant must
// not take down the others.
//
// LOOKUP
// ──────
// `findOidcProvider(tenantId, providerId)` returns either the matching
// `OidcProviderConfig` or null.
// ─────────────────────────────────────────────────────────────────────────────

import type { OidcProviderConfig } from "./provider";

export interface TenantOidcProviderEntry {
  tenantId: string;
  provider: OidcProviderConfig;
}

/**
 * Dev-only fixture. The tests and the Next.js dev server use these
 * unless `DISTRICT_OIDC_PROVIDERS_JSON` is set. Production with no env
 * var gets an empty registry — every login will 404 politely.
 */
export const BUILTIN_OIDC_PROVIDERS: ReadonlyArray<TenantOidcProviderEntry> = [
  {
    tenantId: "dev-tenant",
    provider: {
      id: "google",
      label: "Google",
      issuer: "https://accounts.google.com",
      clientId: "dev-evk-google-client-id.apps.googleusercontent.com",
      clientSecret: "dev-evk-google-client-secret",
    },
  },
];

let cached: ReadonlyArray<TenantOidcProviderEntry> | null = null;

export function loadOidcProviders(): ReadonlyArray<TenantOidcProviderEntry> {
  if (cached) return cached;
  const envJson = process.env.DISTRICT_OIDC_PROVIDERS_JSON;
  let raw: unknown = null;
  if (envJson && envJson.length > 0) {
    try {
      raw = JSON.parse(envJson);
    } catch {
      // eslint-disable-next-line no-console
      console.error(
        "[district/oidc/config] DISTRICT_OIDC_PROVIDERS_JSON could not be parsed; falling back to dev fixture.",
      );
    }
  }
  let candidates: unknown[] = [];
  if (Array.isArray(raw)) {
    candidates = raw;
  } else if (process.env.NODE_ENV !== "production") {
    candidates = BUILTIN_OIDC_PROVIDERS.slice() as unknown as unknown[];
  } else {
    // Production with no config — empty registry. Login attempts 404.
    candidates = [];
  }

  const out: TenantOidcProviderEntry[] = [];
  for (const c of candidates) {
    const p = validateEntryShape(c);
    if (p) out.push(p);
  }
  cached = out;
  return cached;
}

/** Test hook. */
export function resetOidcProvidersCache(): void {
  cached = null;
}

/** Look up a configured provider for a tenant. */
export function findOidcProvider(
  tenantId: string,
  providerId: string,
  entries: ReadonlyArray<TenantOidcProviderEntry> = loadOidcProviders(),
): OidcProviderConfig | null {
  for (const e of entries) {
    if (e.tenantId === tenantId && e.provider.id === providerId) {
      return e.provider;
    }
  }
  return null;
}

function validateEntryShape(v: unknown): TenantOidcProviderEntry | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.tenantId !== "string" || o.tenantId.length === 0) return null;
  const provider = validateProviderShape(o.provider);
  if (!provider) return null;
  return { tenantId: o.tenantId, provider };
}

function validateProviderShape(v: unknown): OidcProviderConfig | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || o.id.length === 0) return null;
  if (typeof o.label !== "string" || o.label.length === 0) return null;
  if (typeof o.issuer !== "string" || !isAcceptableUrl(o.issuer)) return null;
  if (typeof o.clientId !== "string" || o.clientId.length === 0) return null;
  if (o.clientSecret !== undefined && typeof o.clientSecret !== "string") {
    return null;
  }
  const opt = (k: string) =>
    o[k] !== undefined ? (typeof o[k] === "string" ? (o[k] as string) : null) : undefined;
  const authEp = opt("authorizationEndpoint");
  const tokenEp = opt("tokenEndpoint");
  const jwksUri = opt("jwksUri");
  const endSession = opt("endSessionEndpoint");
  if (authEp === null || tokenEp === null || jwksUri === null || endSession === null) {
    return null;
  }
  for (const ep of [authEp, tokenEp, jwksUri, endSession]) {
    if (ep !== undefined && !isAcceptableUrl(ep)) return null;
  }
  const scopes = Array.isArray(o.scopes)
    ? o.scopes.filter((s): s is string => typeof s === "string")
    : undefined;
  const maxAuthAgeSeconds =
    typeof o.maxAuthAgeSeconds === "number" && o.maxAuthAgeSeconds > 0
      ? o.maxAuthAgeSeconds
      : undefined;
  return {
    id: o.id,
    label: o.label,
    issuer: o.issuer,
    clientId: o.clientId,
    clientSecret: typeof o.clientSecret === "string" ? o.clientSecret : undefined,
    scopes,
    authorizationEndpoint: authEp,
    tokenEndpoint: tokenEp,
    jwksUri,
    endSessionEndpoint: endSession,
    maxAuthAgeSeconds,
  };
}

function isAcceptableUrl(s: string): boolean {
  try {
    const u = new URL(s);
    if (u.protocol === "https:") return true;
    if (
      process.env.NODE_ENV !== "production" &&
      (u.hostname === "localhost" || u.hostname === "127.0.0.1")
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
