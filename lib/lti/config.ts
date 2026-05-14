// ─────────────────────────────────────────────────────────────────────────────
// lib/lti/config.ts
//
// v1.8.0 — Platform registration registry for the LTI 1.3 launch handler.
//
// LTI 1.3 PLATFORM REGISTRATION
// ─────────────────────────────
// Each LMS (Canvas, Moodle, Schoology, Blackboard, etc.) deployment we
// support is identified by a triple:
//
//   • issuer       — the LMS's stable iss claim
//                    (e.g. "https://canvas.instructure.com")
//   • client_id    — the OAuth2/OIDC client ID the LMS assigned to
//                    Even Keel when the tool was registered.
//   • deployment_id— a per-deployment identifier (a single platform
//                    may host many deployments).
//
// To validate a launch we additionally need:
//
//   • authLoginUrl — the LMS endpoint where we redirect the browser
//                    for the OIDC auth request.
//   • jwksUrl      — where to fetch the LMS's public JWK set.
//   • tokenUrl     — the LMS token endpoint (for Advantage services,
//                    not used by core launch).
//
// PILOT SCOPE
// ───────────
// Static, hand-edited registry. New deployments require a code change
// + redeploy. Production scale wants a database table instead, but
// for pilot scale (<10 districts) the static registry is honest: it
// gives a grep-able audit trail of every LMS we've ever spoken to.
//
// CONFIG SOURCE
// ─────────────
//   1. Process env `LTI_PLATFORMS_JSON` — full JSON array of platform
//      records. Highest priority. Production deploy ships its own.
//   2. Compile-time `BUILTIN_LTI_PLATFORMS` — a small fixture for dev
//      and tests. NOT used in production (refused by `loadPlatforms`).
// ─────────────────────────────────────────────────────────────────────────────

export interface LtiPlatform {
  /** Stable identifier within Even Keel; not transmitted to the LMS. */
  id: string;
  /** LMS issuer URL (matches the `iss` claim in id_tokens). */
  issuer: string;
  /** OAuth2 client_id this tool was registered with on the LMS. */
  clientId: string;
  /** One or more deployment ids issued by the LMS. */
  deploymentIds: string[];
  /** LMS OIDC auth/login endpoint (browser redirect target). */
  authLoginUrl: string;
  /** URL where the LMS publishes its public JWKS. */
  jwksUrl: string;
  /** LMS OAuth2 token endpoint (used by Advantage services). */
  tokenUrl?: string;
  /** Human label for admin UI. */
  label?: string;
}

/**
 * Dev-only fixture. Two illustrative deployments — Canvas and Moodle
 * with placeholder URLs. The unit tests use these. Production reads
 * from `LTI_PLATFORMS_JSON` and SHOULD NOT use these defaults.
 */
export const BUILTIN_LTI_PLATFORMS: ReadonlyArray<LtiPlatform> = [
  {
    id: "dev-canvas",
    label: "Dev Canvas",
    issuer: "https://canvas.instructure.com",
    clientId: "10000000000001",
    deploymentIds: ["1:abcdef0123456789"],
    authLoginUrl: "https://canvas.instructure.com/api/lti/authorize_redirect",
    jwksUrl: "https://canvas.instructure.com/api/lti/security/jwks",
    tokenUrl: "https://canvas.instructure.com/login/oauth2/token",
  },
  {
    id: "dev-moodle",
    label: "Dev Moodle",
    issuer: "https://moodle.example",
    clientId: "moodle-evenkeel-pilot",
    deploymentIds: ["1"],
    authLoginUrl: "https://moodle.example/mod/lti/auth.php",
    jwksUrl: "https://moodle.example/mod/lti/certs.php",
    tokenUrl: "https://moodle.example/mod/lti/token.php",
  },
];

let cachedPlatforms: ReadonlyArray<LtiPlatform> | null = null;

/**
 * Load the platform registry. Reads `LTI_PLATFORMS_JSON` in production;
 * falls back to the dev fixture in non-production environments.
 *
 * Validation: refuses entries missing any required field. Logs once
 * and skips the bad entry rather than crash the whole tool.
 */
export function loadPlatforms(): ReadonlyArray<LtiPlatform> {
  if (cachedPlatforms) return cachedPlatforms;
  const envJson = process.env.LTI_PLATFORMS_JSON;
  let raw: unknown = null;
  if (envJson && envJson.length > 0) {
    try {
      raw = JSON.parse(envJson);
    } catch {
      // eslint-disable-next-line no-console
      console.error(
        "[lti/config] LTI_PLATFORMS_JSON could not be parsed; falling back to dev fixture.",
      );
    }
  }
  let candidates: unknown[] = [];
  if (Array.isArray(raw)) {
    candidates = raw;
  } else if (process.env.NODE_ENV !== "production") {
    candidates = BUILTIN_LTI_PLATFORMS.slice() as unknown as unknown[];
  } else {
    // Production with no config — empty registry. Every launch will
    // 404 against `findPlatform`, which is the correct safe default.
    candidates = [];
  }

  const out: LtiPlatform[] = [];
  for (const c of candidates) {
    const p = validatePlatformShape(c);
    if (p) out.push(p);
  }
  cachedPlatforms = out;
  return cachedPlatforms;
}

/** Test hook — clears the cached platforms list. */
export function resetPlatformsCache(): void {
  cachedPlatforms = null;
}

/**
 * Find a platform record by (issuer, clientId, deploymentId). All
 * three must match. Returns null if no registered platform fits.
 */
export function findPlatform(
  issuer: string,
  clientId: string,
  deploymentId: string,
  platforms: ReadonlyArray<LtiPlatform> = loadPlatforms(),
): LtiPlatform | null {
  for (const p of platforms) {
    if (
      p.issuer === issuer &&
      p.clientId === clientId &&
      p.deploymentIds.includes(deploymentId)
    ) {
      return p;
    }
  }
  return null;
}

/**
 * Find a platform by (issuer, clientId) without a deployment id.
 * Used by the OIDC login initiation step, which has issuer + client_id
 * but does not yet know the deployment.
 */
export function findPlatformByIssuer(
  issuer: string,
  clientId: string,
  platforms: ReadonlyArray<LtiPlatform> = loadPlatforms(),
): LtiPlatform | null {
  for (const p of platforms) {
    if (p.issuer === issuer && p.clientId === clientId) return p;
  }
  return null;
}

function validatePlatformShape(v: unknown): LtiPlatform | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || o.id.length === 0) return null;
  if (typeof o.issuer !== "string" || !isHttpsUrl(o.issuer)) return null;
  if (typeof o.clientId !== "string" || o.clientId.length === 0) return null;
  if (
    !Array.isArray(o.deploymentIds) ||
    o.deploymentIds.length === 0 ||
    !o.deploymentIds.every((d) => typeof d === "string" && d.length > 0)
  ) {
    return null;
  }
  if (typeof o.authLoginUrl !== "string" || !isHttpsUrl(o.authLoginUrl)) {
    return null;
  }
  if (typeof o.jwksUrl !== "string" || !isHttpsUrl(o.jwksUrl)) return null;
  if (
    o.tokenUrl !== undefined &&
    (typeof o.tokenUrl !== "string" || !isHttpsUrl(o.tokenUrl))
  ) {
    return null;
  }
  return {
    id: o.id,
    issuer: o.issuer,
    clientId: o.clientId,
    deploymentIds: o.deploymentIds as string[],
    authLoginUrl: o.authLoginUrl,
    jwksUrl: o.jwksUrl,
    tokenUrl: typeof o.tokenUrl === "string" ? o.tokenUrl : undefined,
    label: typeof o.label === "string" ? o.label : undefined,
  };
}

function isHttpsUrl(s: string): boolean {
  try {
    const u = new URL(s);
    // Tolerate http://localhost for dev fixtures only.
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
