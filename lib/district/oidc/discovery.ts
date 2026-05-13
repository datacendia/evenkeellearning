// ─────────────────────────────────────────────────────────────────────────────
// lib/district/oidc/discovery.ts
//
// v1.8.4 — OIDC provider-discovery fetcher.
//
// SCOPE
// ─────
// Fetches `${issuer}/.well-known/openid-configuration`, validates the
// minimum fields we care about, and returns a stable shape. TTL-cached
// so a login flurry doesn't hammer the provider. Fetch and clock are
// injectable for deterministic tests.
//
// SECURITY NOTES
// ──────────────
//   1. We enforce HTTPS for issuer URLs (localhost allowed in dev).
//   2. The document's `issuer` MUST equal the issuer URL we fetched from
//      — otherwise an attacker could serve any `.well-known` doc they
//      liked off a hostname that happens to chain back to us.
//   3. We refuse to proceed unless `authorization_endpoint`,
//      `token_endpoint`, and `jwks_uri` are all present and
//      absolute HTTPS (or dev-localhost) URLs.
//   4. The provider's `id_token_signing_alg_values_supported` MUST
//      overlap with ours (RS256 / RS384 / RS512 / ES256); otherwise we
//      couldn't verify anything it issues.
// ─────────────────────────────────────────────────────────────────────────────

import { isAcceptableJwksUrl } from "@/lib/jwt/jwks-fetcher";

export interface OidcDiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
  userinfo_endpoint?: string;
  response_types_supported: string[];
  subject_types_supported: string[];
  id_token_signing_alg_values_supported: string[];
  /** Preserved for callers that need fields we don't explicitly model. */
  raw: Record<string, unknown>;
}

export type OidcDiscoveryReason =
  | "unsafe_issuer"
  | "fetch_failed"
  | "bad_status"
  | "bad_json"
  | "missing_issuer"
  | "issuer_mismatch"
  | "missing_endpoint"
  | "unsafe_endpoint"
  | "no_supported_alg";

export type OidcDiscoveryResult =
  | { ok: true; doc: OidcDiscoveryDocument; cached: boolean }
  | { ok: false; reason: OidcDiscoveryReason; detail?: string };

/** Default cache lifetime — 10 minutes, matching the JWKS cache. */
export const DEFAULT_DISCOVERY_CACHE_TTL_MS = 10 * 60 * 1000;

const OUR_SUPPORTED_ALGS = new Set(["RS256", "RS384", "RS512", "ES256"]);

interface CacheEntry {
  fetchedAtMs: number;
  doc: OidcDiscoveryDocument;
}

const cache = new Map<string, CacheEntry>();

/** Test hook. */
export function resetDiscoveryCache(): void {
  cache.clear();
}

/**
 * Fetch and validate an OIDC discovery document.
 *
 * The cache key is the issuer URL (normalised — trailing slash stripped).
 */
export async function fetchOidcDiscovery(
  issuerUrl: string,
  opts: {
    cacheTtlMs?: number;
    fetcher?: typeof fetch;
    nowMs?: number;
  } = {},
): Promise<OidcDiscoveryResult> {
  const ttl = opts.cacheTtlMs ?? DEFAULT_DISCOVERY_CACHE_TTL_MS;
  const fetcher = opts.fetcher ?? fetch;
  const now = opts.nowMs ?? Date.now();

  const normalised = normaliseIssuer(issuerUrl);
  if (!normalised || !isSafeIssuerUrl(normalised)) {
    return { ok: false, reason: "unsafe_issuer" };
  }

  const cached = cache.get(normalised);
  if (cached && now - cached.fetchedAtMs < ttl) {
    return { ok: true, doc: cached.doc, cached: true };
  }

  const configUrl = buildConfigUrl(normalised);

  let resp: Response;
  try {
    resp = await fetcher(configUrl, {
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
  if (!json || typeof json !== "object") {
    return { ok: false, reason: "bad_json" };
  }

  const raw = json as Record<string, unknown>;

  const iss = raw.issuer;
  if (typeof iss !== "string" || iss.length === 0) {
    return { ok: false, reason: "missing_issuer" };
  }
  if (normaliseIssuer(iss) !== normalised) {
    return {
      ok: false,
      reason: "issuer_mismatch",
      detail: `doc=${iss} requested=${issuerUrl}`,
    };
  }

  const authEp = raw.authorization_endpoint;
  const tokenEp = raw.token_endpoint;
  const jwksUri = raw.jwks_uri;

  if (typeof authEp !== "string") {
    return { ok: false, reason: "missing_endpoint", detail: "authorization_endpoint" };
  }
  if (typeof tokenEp !== "string") {
    return { ok: false, reason: "missing_endpoint", detail: "token_endpoint" };
  }
  if (typeof jwksUri !== "string") {
    return { ok: false, reason: "missing_endpoint", detail: "jwks_uri" };
  }

  if (!isAcceptableJwksUrl(authEp)) {
    return { ok: false, reason: "unsafe_endpoint", detail: `authorization_endpoint=${authEp}` };
  }
  if (!isAcceptableJwksUrl(tokenEp)) {
    return { ok: false, reason: "unsafe_endpoint", detail: `token_endpoint=${tokenEp}` };
  }
  if (!isAcceptableJwksUrl(jwksUri)) {
    return { ok: false, reason: "unsafe_endpoint", detail: `jwks_uri=${jwksUri}` };
  }

  const endSessionEp =
    typeof raw.end_session_endpoint === "string" ? raw.end_session_endpoint : undefined;
  if (endSessionEp && !isAcceptableJwksUrl(endSessionEp)) {
    return {
      ok: false,
      reason: "unsafe_endpoint",
      detail: `end_session_endpoint=${endSessionEp}`,
    };
  }

  const userinfoEp =
    typeof raw.userinfo_endpoint === "string" ? raw.userinfo_endpoint : undefined;
  if (userinfoEp && !isAcceptableJwksUrl(userinfoEp)) {
    return {
      ok: false,
      reason: "unsafe_endpoint",
      detail: `userinfo_endpoint=${userinfoEp}`,
    };
  }

  const responseTypes = stringArray(raw.response_types_supported);
  const subjectTypes = stringArray(raw.subject_types_supported);
  const idTokenAlgs = stringArray(raw.id_token_signing_alg_values_supported);

  if (idTokenAlgs.length > 0 && !idTokenAlgs.some((a) => OUR_SUPPORTED_ALGS.has(a))) {
    return {
      ok: false,
      reason: "no_supported_alg",
      detail: idTokenAlgs.join(","),
    };
  }

  const doc: OidcDiscoveryDocument = {
    issuer: iss,
    authorization_endpoint: authEp,
    token_endpoint: tokenEp,
    jwks_uri: jwksUri,
    end_session_endpoint: endSessionEp,
    userinfo_endpoint: userinfoEp,
    response_types_supported: responseTypes,
    subject_types_supported: subjectTypes,
    id_token_signing_alg_values_supported: idTokenAlgs,
    raw,
  };
  cache.set(normalised, { fetchedAtMs: now, doc });
  return { ok: true, doc, cached: false };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function normaliseIssuer(v: string): string | null {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v);
    // Drop query + fragment; strip trailing slash in pathname.
    u.search = "";
    u.hash = "";
    let pathname = u.pathname;
    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.replace(/\/+$/, "");
    }
    return `${u.protocol}//${u.host}${pathname}`;
  } catch {
    return null;
  }
}

function isSafeIssuerUrl(url: string): boolean {
  return isAcceptableJwksUrl(url); // same rule: HTTPS in prod, localhost in dev.
}

function buildConfigUrl(normalised: string): string {
  // Normalised never ends in '/' except when the pathname is the root.
  // Per spec, issuer may have a path component (e.g.
  // https://example.com/realms/foo), and we append /.well-known/… after.
  return `${normalised.replace(/\/$/, "")}/.well-known/openid-configuration`;
}

function stringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}
