// ─────────────────────────────────────────────────────────────────────────────
// lib/district/oidc/login-intent.ts
//
// v1.8.5 — Short-lived server-signed "login intent" cookie.
//
// WHAT IT IS
// ──────────
// After a successful OIDC callback we have a **verified upstream
// identity** bound to a tenant user row, but not yet a district
// session — that still requires a passkey assertion (or fresh
// enrollment). We bridge the gap with a signed intermediate cookie
// that:
//
//   • carries (tenantId, userId, externalId, providerId, source, iat, exp)
//   • has a 5-minute TTL (enough for passkey enroll / assert; short
//     enough to contain replay risk)
//   • is consumed exactly once by the subsequent "complete login"
//     endpoint, which then mints the real refresh + access tokens.
//
// It is *not* a session. Holding a valid login-intent cookie lets a
// user talk to the complete-login endpoint to bind/authenticate a
// passkey, nothing else.
//
// SIGNING KEY
// ───────────
// Shares `ROLE_GUARD_SECRET` with the rest of the platform, tagged
// with `::oidc-login-intent` for key-rotation isolation.
// ─────────────────────────────────────────────────────────────────────────────

import {
  base64UrlToBytes,
  bytesToBase64Url,
  toArrayBuffer,
} from "@/lib/crypto/base64url";

export interface OidcLoginIntentPayload {
  v: 1;
  tenantId: string;
  userId: string;
  /** Raw IdP `sub` (audit / diagnostic). */
  externalId: string;
  providerId: string;
  /** Stable source tag for audit ("sso.oidc.google"). */
  source: string;
  /** True if the user was just created by resolveOidcIdentity. */
  newUser: boolean;
  /** Whether the tenant user already has at least one active passkey. */
  hasExistingPasskey: boolean;
  /** Unix ms. */
  iat: number;
  /** Unix ms. */
  exp: number;
}

export const OIDC_LOGIN_INTENT_COOKIE_NAME = "evk_oidc_login_intent";
export const OIDC_LOGIN_INTENT_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ── Secret key cache ────────────────────────────────────────────────────────

let cachedKey: CryptoKey | null = null;
let cachedDevSecret: string | null = null;

function devSecret(): string {
  if (!cachedDevSecret) {
    cachedDevSecret =
      "evk-dev-oidc-login-intent-" +
      Math.random().toString(36).slice(2) +
      Date.now().toString(36);
  }
  return cachedDevSecret;
}

function secret(): string {
  const base = process.env.ROLE_GUARD_SECRET;
  if (base && base.length >= 32) return base + "::oidc-login-intent";
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "ROLE_GUARD_SECRET is required in production for OIDC login-intent signing.",
    );
  }
  return devSecret() + "::oidc-login-intent";
}

async function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const raw = new TextEncoder().encode(secret());
  cachedKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(raw),
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

// ── Sign / verify ───────────────────────────────────────────────────────────

export async function signOidcLoginIntent(
  payload: OidcLoginIntentPayload,
): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(payload));
  const key = await getKey();
  const sig = await crypto.subtle.sign("HMAC", key, toArrayBuffer(json));
  return bytesToBase64Url(json) + "." + bytesToBase64Url(new Uint8Array(sig));
}

export type OidcLoginIntentVerifyResult =
  | { ok: true; payload: OidcLoginIntentPayload }
  | {
      ok: false;
      reason: "missing" | "malformed" | "bad_signature" | "expired";
    };

export async function verifyOidcLoginIntent(
  cookieValue: string | undefined | null,
  opts: { nowMs?: number } = {},
): Promise<OidcLoginIntentVerifyResult> {
  if (!cookieValue) return { ok: false, reason: "missing" };
  const parts = cookieValue.split(".");
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
  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, toArrayBuffer(payloadBytes)),
  );
  if (!timingSafeEqual(expected, sigBytes)) {
    return { ok: false, reason: "bad_signature" };
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!isIntentPayload(decoded)) return { ok: false, reason: "malformed" };
  const now = opts.nowMs ?? Date.now();
  if (decoded.exp <= now) return { ok: false, reason: "expired" };
  return { ok: true, payload: decoded };
}

function isIntentPayload(v: unknown): v is OidcLoginIntentPayload {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (o.v !== 1) return false;
  if (typeof o.tenantId !== "string") return false;
  if (typeof o.userId !== "string") return false;
  if (typeof o.externalId !== "string") return false;
  if (typeof o.providerId !== "string") return false;
  if (typeof o.source !== "string") return false;
  if (typeof o.newUser !== "boolean") return false;
  if (typeof o.hasExistingPasskey !== "boolean") return false;
  if (typeof o.iat !== "number") return false;
  if (typeof o.exp !== "number") return false;
  return true;
}

// ── Cookie helpers ──────────────────────────────────────────────────────────

export function buildOidcLoginIntentCookie(signedValue: string): string {
  const parts = [
    `${OIDC_LOGIN_INTENT_COOKIE_NAME}=${signedValue}`,
    `Max-Age=${Math.floor(OIDC_LOGIN_INTENT_TTL_MS / 1000)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

export function buildClearOidcLoginIntentCookie(): string {
  const parts = [
    `${OIDC_LOGIN_INTENT_COOKIE_NAME}=`,
    "Max-Age=0",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}
