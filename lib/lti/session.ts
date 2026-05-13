// ─────────────────────────────────────────────────────────────────────────────
// lib/lti/session.ts
//
// v1.8.0 — Short-lived signed LTI session cookie.
//
// PURPOSE
// ───────
// After a successful LTI 1.3 launch, the platform needs to remember
// who the launched user is across subsequent navigation inside the
// Even Keel tool. This module mirrors `lib/auth/server-session.ts`
// but stores a smaller LTI-specific payload (issuer, deployment,
// user sub, role, resource link).
//
// SECURITY NOTES
// ──────────────
//   • HMAC-SHA256 with the same `ROLE_GUARD_SECRET` (suffix "::lti").
//   • TTL is 2 hours — shorter than a role session, because a launch
//     is typically a single sitting.
//   • Cookie is HttpOnly + Secure + SameSite=None (because the LMS
//     iframes the tool cross-origin; SameSite=Lax/Strict would drop
//     the cookie on the next click inside the iframe).
// ─────────────────────────────────────────────────────────────────────────────

import {
  base64UrlToBytes,
  bytesToBase64Url,
  toArrayBuffer,
} from "@/lib/crypto/base64url";
import type { EvenKeelLtiRole, LtiLaunch } from "./launch";

export const LTI_SESSION_COOKIE_NAME = "evk_lti_session";
export const LTI_SESSION_TTL_MS = 2 * 60 * 60 * 1000;

export interface LtiSession {
  /** Stable platform id (matches the registry). */
  platformId: string;
  /** LTI issuer (informational; the platformId is the security key). */
  iss: string;
  /** LTI deployment id used for this launch. */
  deploymentId: string;
  /** Opaque LMS user sub. */
  sub: string;
  /** Even Keel role projected from LTI roles. */
  role: EvenKeelLtiRole;
  /** Resource link id (per-launch context). */
  resourceLinkId: string;
  /** Course / context id, if the launch provided one. */
  contextId?: string;
  /** Unix-ms expiry. */
  exp: number;
  /** Random nonce; revocation lookup. */
  jti: string;
}

let cachedKey: CryptoKey | null = null;
let cachedSecretSource: string | null = null;

function getSecretMaterial(): string {
  const env = process.env.ROLE_GUARD_SECRET;
  if (env && env.length >= 32) return env + "::lti";
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "ROLE_GUARD_SECRET is required in production for LTI session signing.",
    );
  }
  if (!cachedSecretSource) {
    cachedSecretSource =
      "evk-dev-lti-sess-" +
      Math.random().toString(36).slice(2) +
      Date.now().toString(36);
  }
  return cachedSecretSource;
}

async function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const secret = new TextEncoder().encode(getSecretMaterial());
  cachedKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return cachedKey;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function randomB64Url(n: number): string {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

/**
 * Build a session payload from a validated launch and sign it.
 */
export async function issueLtiSession(
  launch: LtiLaunch,
): Promise<{ token: string; session: LtiSession }> {
  const session: LtiSession = {
    platformId: launch.platformId,
    iss: launch.issuer,
    deploymentId: launch.deploymentId,
    sub: launch.ltiUserSub,
    role: launch.role,
    resourceLinkId: launch.resourceLinkId,
    contextId: launch.contextId,
    exp: Date.now() + LTI_SESSION_TTL_MS,
    jti: randomB64Url(12),
  };
  const payloadBytes = new TextEncoder().encode(JSON.stringify(session));
  const key = await getKey();
  const sig = await crypto.subtle.sign("HMAC", key, toArrayBuffer(payloadBytes));
  const token =
    bytesToBase64Url(payloadBytes) + "." + bytesToBase64Url(new Uint8Array(sig));
  return { token, session };
}

export type LtiSessionVerificationFailure =
  | "missing"
  | "malformed"
  | "bad_signature"
  | "expired";

export type LtiSessionVerificationResult =
  | { ok: true; session: LtiSession }
  | { ok: false; reason: LtiSessionVerificationFailure };

/** Verify a session token from a cookie. */
export async function verifyLtiSession(
  token: string | undefined | null,
  opts: { nowMs?: number } = {},
): Promise<LtiSessionVerificationResult> {
  if (!token || typeof token !== "string") return { ok: false, reason: "missing" };
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };

  let payloadBytes: Uint8Array;
  let sigBytes: Uint8Array;
  try {
    payloadBytes = base64UrlToBytes(parts[0]);
    sigBytes = base64UrlToBytes(parts[1]);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const key = await getKey();
  const expectedSig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, toArrayBuffer(payloadBytes)),
  );
  if (!timingSafeEqual(expectedSig, sigBytes)) {
    return { ok: false, reason: "bad_signature" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!isLtiSession(parsed)) return { ok: false, reason: "malformed" };
  const now = opts.nowMs ?? Date.now();
  if (parsed.exp <= now) return { ok: false, reason: "expired" };
  return { ok: true, session: parsed };
}

function isLtiSession(v: unknown): v is LtiSession {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o.platformId !== "string") return false;
  if (typeof o.iss !== "string") return false;
  if (typeof o.deploymentId !== "string") return false;
  if (typeof o.sub !== "string") return false;
  if (typeof o.resourceLinkId !== "string") return false;
  if (typeof o.exp !== "number") return false;
  if (typeof o.jti !== "string") return false;
  // role
  if (
    o.role !== "teacher" &&
    o.role !== "learner" &&
    o.role !== "admin" &&
    o.role !== "unknown"
  ) {
    return false;
  }
  return true;
}

/**
 * Build a Set-Cookie header value for the LTI session.
 *
 * SameSite=None is REQUIRED for cross-origin iframe launches from an
 * LMS; production deploys MUST be HTTPS for the browser to accept it.
 */
export function buildLtiSessionCookie(token: string): string {
  const parts = [
    `${LTI_SESSION_COOKIE_NAME}=${token}`,
    `Max-Age=${Math.floor(LTI_SESSION_TTL_MS / 1000)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=None",
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

/** Build a header that clears the LTI session cookie. */
export function buildClearLtiSessionCookie(): string {
  const parts = [
    `${LTI_SESSION_COOKIE_NAME}=`,
    "Max-Age=0",
    "Path=/",
    "HttpOnly",
    "SameSite=None",
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}
