// ─────────────────────────────────────────────────────────────────────────────
// lib/auth/server-session.ts
//
// v1.6.0 — audit H-1. Real server-verified role sessions for /teacher,
// /compliance and /author. This module REPLACES the demo-grade
// sessionStorage flag that used to live at `lib/auth/role-guard.ts`:
//
// Before (v1.5.x)
// ───────────────
// A child could open devtools and run
//   sessionStorage.setItem("evenkeel/role-guard/teacher", "unlocked")
// and the UI would let them in. The "passphrase check" happened entirely
// in the browser and was effectively a speed bump.
//
// After (v1.6.0)
// ──────────────
// The gate is an HMAC-signed HttpOnly cookie. The secret lives on the
// server (`ROLE_GUARD_SECRET` env var). The cookie is set by the POST
// handler at `/api/auth/role-verify` only after a server-side passphrase
// check. The middleware at `middleware.ts` verifies the cookie signature
// at the edge — the privileged page HTML is never sent to an unauthorised
// client. Devtools JS cannot read or write HttpOnly cookies, so there is
// no client-side bypass.
//
// Threat model (honest)
// ─────────────────────
// - An attacker with the `ROLE_GUARD_SECRET` env var can forge any token.
//   Rotate the secret (`npm run auth:rotate-secret`) on every suspected
//   compromise; the middleware will reject old tokens on the next request.
// - An attacker who knows a role's passphrase can unlock that role.
//   Passphrases are a stepping stone until the full backend lands
//   (see todo d1-backend for passkey-bound refresh tokens).
// - The cookie is bound to nothing — a stolen cookie grants the role
//   until expiry. Mitigations: short TTL (4h), Secure+SameSite=Strict,
//   and a revocation list keyed on `jti` (nonce). Revocation is in
//   `lib/auth/session-revocation.ts`.
//
// Runtime compatibility
// ─────────────────────
// Uses the Web Crypto API (`crypto.subtle`), which is available in both
// the Node.js runtime (Node 18+) and the Next.js Edge runtime. No
// `node:crypto` import, so this file can be imported from `middleware.ts`.
// ─────────────────────────────────────────────────────────────────────────────

import { bytesToBase64Url, base64UrlToBytes, toArrayBuffer } from "@/lib/crypto/base64url";

export type ProtectedRole = "teacher" | "compliance" | "author";
export const PROTECTED_ROLES: ProtectedRole[] = ["teacher", "compliance", "author"];

/** Cookie name for a given role. Kept stable across versions. */
export function cookieNameFor(role: ProtectedRole): string {
  return `evk_role_${role}`;
}

/** Session TTL in milliseconds. 4 hours — short enough to limit stolen-cookie blast radius. */
export const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

/** Shape of the verified session payload encoded in the cookie value. */
export interface RoleSession {
  role: ProtectedRole;
  /** Unix ms at which the session expires. */
  exp: number;
  /** Opaque nonce (jti). Used for revocation lookups. */
  jti: string;
}

/**
 * Cached imported HMAC key. The secret is loaded once per process; if
 * it rotates, the process must restart (which is the behaviour we want
 * — it invalidates every outstanding session).
 */
let cachedKey: CryptoKey | null = null;
let cachedSecretSource: string | null = null;

/**
 * Pull the server secret. In production we REFUSE to start without one.
 * In development and test we fall back to a process-stable random value
 * and log a loud warning so nobody ships the dev secret by accident.
 */
function getSecretMaterial(): string {
  const env = process.env.ROLE_GUARD_SECRET;
  if (env && env.length >= 32) return env;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "ROLE_GUARD_SECRET is required in production and must be at least 32 chars. " +
        "Generate one with `openssl rand -hex 32` and set it in your deployment env.",
    );
  }

  // Dev / test fallback — deterministic per-process, NOT per-deployment.
  // We deliberately do NOT persist this value.
  if (!cachedSecretSource) {
    cachedSecretSource =
      "evk-dev-role-secret-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    // eslint-disable-next-line no-console
    console.warn(
      "[auth/server-session] ROLE_GUARD_SECRET not set — using an ephemeral " +
        "dev secret. All outstanding sessions will be invalid after restart.",
    );
  }
  return cachedSecretSource;
}

async function getHmacKey(): Promise<CryptoKey> {
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

/** Constant-time byte-string equality. Never short-circuits. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Issue a signed session token for a role. The returned string is safe
 * to place in a cookie value.
 *
 * Format:  base64url(JSON(payload)) + "." + base64url(HMAC-SHA256(payload))
 */
export async function issueSession(role: ProtectedRole): Promise<{ token: string; session: RoleSession }> {
  const jtiBytes = new Uint8Array(16);
  crypto.getRandomValues(jtiBytes);
  const session: RoleSession = {
    role,
    exp: Date.now() + SESSION_TTL_MS,
    jti: bytesToBase64Url(jtiBytes),
  };
  const payloadBytes = new TextEncoder().encode(JSON.stringify(session));
  const key = await getHmacKey();
  const sigBuf = await crypto.subtle.sign("HMAC", key, toArrayBuffer(payloadBytes));
  const token = bytesToBase64Url(payloadBytes) + "." + bytesToBase64Url(new Uint8Array(sigBuf));
  return { token, session };
}

/**
 * Verify a token string. Returns the decoded session on success, or null
 * for any failure (bad shape, bad signature, expired, revoked). Does not
 * throw on untrusted input.
 *
 * Failure cases are deliberately indistinguishable from each other in the
 * return value; callers that need to differentiate (e.g. to show
 * "session expired, please sign in again") can pass `opts.verbose` and
 * inspect the `reason` field. The public endpoints never leak the reason
 * to clients.
 */
export async function verifySession(
  token: string | undefined | null,
  opts: { verbose?: boolean } = {},
): Promise<RoleSession | null | { session: null; reason: VerifyFailure }> {
  const fail = (reason: VerifyFailure) =>
    opts.verbose ? { session: null as null, reason } : null;

  if (!token || typeof token !== "string") return fail("missing");
  const parts = token.split(".");
  if (parts.length !== 2) return fail("malformed");

  let payloadBytes: Uint8Array;
  let sigBytes: Uint8Array;
  try {
    payloadBytes = base64UrlToBytes(parts[0]);
    sigBytes = base64UrlToBytes(parts[1]);
  } catch {
    return fail("malformed");
  }

  const key = await getHmacKey();
  const expectedSigBuf = await crypto.subtle.sign("HMAC", key, toArrayBuffer(payloadBytes));
  const expectedSig = new Uint8Array(expectedSigBuf);
  if (!timingSafeEqual(expectedSig, sigBytes)) return fail("bad_signature");

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return fail("malformed");
  }
  if (!isRoleSession(payload)) return fail("malformed");
  if (payload.exp <= Date.now()) return fail("expired");
  if (await isRevoked(payload.jti)) return fail("revoked");

  return opts.verbose ? { session: payload, reason: "ok" as const } as never : payload;
}

export type VerifyFailure = "ok" | "missing" | "malformed" | "bad_signature" | "expired" | "revoked";

function isRoleSession(v: unknown): v is RoleSession {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    (o.role === "teacher" || o.role === "compliance" || o.role === "author") &&
    typeof o.exp === "number" &&
    typeof o.jti === "string"
  );
}

// ── Revocation ──────────────────────────────────────────────────────────────
//
// Revocation is stored as a process-local Set. In a multi-instance deploy
// this must be backed by Redis / a database (see todo d1-backend). The
// current in-memory implementation means a revoked `jti` is only blocked
// on the instance that handled the logout; short session TTL (4h) bounds
// the damage. For a single-instance pilot deployment this is fine.

const revokedJtis = new Set<string>();
async function isRevoked(jti: string): Promise<boolean> {
  return revokedJtis.has(jti);
}
/** Revoke a session by its `jti`. Survives only until process restart. */
export function revokeSession(jti: string): void {
  revokedJtis.add(jti);
}

// ── Cookie helpers ──────────────────────────────────────────────────────────

/**
 * Build a Set-Cookie value for a role session. Production flags:
 *   HttpOnly — no JS access
 *   Secure   — only sent over TLS
 *   SameSite=Strict — no cross-origin send
 *   Path=/
 *   Max-Age=<SESSION_TTL>
 * In dev we drop `Secure` so the cookie works over plain http://localhost.
 */
export function buildSetCookieHeader(role: ProtectedRole, token: string): string {
  const parts = [
    `${cookieNameFor(role)}=${token}`,
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

/** Build a Set-Cookie value that expires the session cookie immediately. */
export function buildClearCookieHeader(role: ProtectedRole): string {
  const parts = [
    `${cookieNameFor(role)}=`,
    "Max-Age=0",
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

// ── Server-side passphrase check ────────────────────────────────────────────
//
// Passphrases are configured per role via env vars. Compared timing-safely
// against a SHA-256 digest so an error log never exposes the plaintext.
// Defaults are ONLY honoured outside production; in production the env
// vars are mandatory.

const DEV_DEFAULT_PASSPHRASES: Record<ProtectedRole, string> = {
  teacher: "mentor-alpha-42",
  compliance: "officer-alpha-42",
  author: "reviewer-alpha-42",
};

function expectedPassphraseFor(role: ProtectedRole): string {
  const envKey =
    role === "teacher"
      ? process.env.ROLE_GUARD_TEACHER_PASSPHRASE
      : role === "compliance"
        ? process.env.ROLE_GUARD_COMPLIANCE_PASSPHRASE
        : process.env.ROLE_GUARD_AUTHOR_PASSPHRASE;
  if (envKey && envKey.length > 0) return envKey;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `ROLE_GUARD_${role.toUpperCase()}_PASSPHRASE is required in production. ` +
        "Set one per role in your deployment env — do not ship the dev default.",
    );
  }
  return DEV_DEFAULT_PASSPHRASES[role];
}

async function sha256(input: string): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest("SHA-256", toArrayBuffer(new TextEncoder().encode(input)));
  return new Uint8Array(buf);
}

/** Server-side passphrase check. Returns true iff the input matches. */
export async function checkPassphrase(role: ProtectedRole, input: string): Promise<boolean> {
  if (!input || typeof input !== "string") return false;
  const expected = expectedPassphraseFor(role);
  const [a, b] = await Promise.all([sha256(input), sha256(expected)]);
  return timingSafeEqual(a, b);
}
