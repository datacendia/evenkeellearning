// ─────────────────────────────────────────────────────────────────────────────
// lib/jwt/jwks-fetcher.ts
//
// v1.8.4 — Generic TTL-cached JWKS fetcher (formerly `lib/lti/jwks-fetcher.ts`).
//
// SCOPE
// ─────
// One narrow job: given a `jwks_uri`, return the decoded JWKS. Cache
// successful responses for `cacheTtlMs` so a launch/login flurry
// doesn't hammer the remote public-keys endpoint. Refuse non-HTTPS URLs
// unless they point at localhost in dev.
//
// THIS FILE IS DELIBERATELY TINY
// ──────────────────────────────
// Everything sensitive (signature verification, claim validation) is
// in `jwt.ts` / `launch.ts` / `id-token.ts`. The fetcher just
// transports bytes.
// ─────────────────────────────────────────────────────────────────────────────

import type { JsonWebKeySet } from "./jwks";

/** Default cache lifetime — 10 minutes is the OIDC convention. */
export const DEFAULT_JWKS_CACHE_TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
  fetchedAtMs: number;
  jwks: JsonWebKeySet;
}

const cache = new Map<string, CacheEntry>();

/** Test hook — clears the JWKS cache. */
export function resetJwksCache(): void {
  cache.clear();
}

/** Stable error reasons. */
export type JwksFetchReason =
  | "unsafe_url"
  | "fetch_failed"
  | "bad_status"
  | "bad_json"
  | "bad_shape";

export type JwksFetchResult =
  | { ok: true; jwks: JsonWebKeySet; cached: boolean }
  | { ok: false; reason: JwksFetchReason; detail?: string };

/**
 * Fetch a JWKS, with caching. The fetcher is injectable for tests
 * (defaults to global `fetch`). Returns a deterministic discriminated
 * result so callers can branch on `ok` cleanly.
 */
export async function fetchJwks(
  url: string,
  opts: {
    cacheTtlMs?: number;
    fetcher?: typeof fetch;
    nowMs?: number;
  } = {},
): Promise<JwksFetchResult> {
  const ttl = opts.cacheTtlMs ?? DEFAULT_JWKS_CACHE_TTL_MS;
  const fetcher = opts.fetcher ?? fetch;
  const now = opts.nowMs ?? Date.now();

  if (!isAcceptableJwksUrl(url)) {
    return { ok: false, reason: "unsafe_url" };
  }

  const hit = cache.get(url);
  if (hit && now - hit.fetchedAtMs < ttl) {
    return { ok: true, jwks: hit.jwks, cached: true };
  }

  let resp: Response;
  try {
    resp = await fetcher(url, {
      method: "GET",
      headers: { accept: "application/json" },
    });
  } catch (e) {
    return {
      ok: false,
      reason: "fetch_failed",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
  if (!resp.ok) {
    return { ok: false, reason: "bad_status", detail: String(resp.status) };
  }

  let json: unknown;
  try {
    json = await resp.json();
  } catch {
    return { ok: false, reason: "bad_json" };
  }
  if (!isJwks(json)) return { ok: false, reason: "bad_shape" };
  cache.set(url, { fetchedAtMs: now, jwks: json });
  return { ok: true, jwks: json, cached: false };
}

export function isAcceptableJwksUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === "https:") return true;
  if (
    process.env.NODE_ENV !== "production" &&
    (u.hostname === "localhost" || u.hostname === "127.0.0.1")
  ) {
    return true;
  }
  return false;
}

function isJwks(v: unknown): v is JsonWebKeySet {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.keys)) return false;
  for (const k of o.keys) {
    if (!k || typeof k !== "object") return false;
    if (typeof (k as Record<string, unknown>).kty !== "string") return false;
  }
  return true;
}
