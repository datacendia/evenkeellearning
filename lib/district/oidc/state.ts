// ─────────────────────────────────────────────────────────────────────────────
// lib/district/oidc/state.ts
//
// v1.8.4 — Server-signed state cookie for the OIDC authorization-code flow.
//
// PURPOSE
// ───────
// Between /authorize redirect and /callback we need to carry:
//   • CSRF `state` value (echoed back to the IdP; must match on return)
//   • OIDC `nonce` (checked against the ID-token `nonce` claim)
//   • PKCE `code_verifier` (never sent until the code exchange)
//   • `tenantId` + `providerId` (disambiguate multi-tenant callbacks)
//   • optional `returnTo` (where to send the user after success)
//   • issued-at + expiry (short TTL — 10 min is plenty; the IdP session
//     it replaces is 5 min typical)
//
// We store all of this in an HttpOnly, SameSite=Lax cookie signed with
// the same ROLE_GUARD_SECRET used elsewhere (plus the `::oidc-state`
// tag so key rotation propagates together).
//
// We keep the cookie to ≤4KB and opaque to the browser. The cookie is
// deleted in `completeOidcLogin` as soon as it's consumed, so a second
// /callback with the same cookie is rejected as "already consumed".
// (We also store a random `consumedToken` sentinel for belt-and-braces,
// but the typical failure mode — IdP double-posting the callback — is
// caught by the first use deleting the cookie.)
// ─────────────────────────────────────────────────────────────────────────────

import {
  base64UrlToBytes,
  bytesToBase64Url,
  toArrayBuffer,
} from "@/lib/crypto/base64url";

export interface OidcStatePayload {
  v: 1;
  state: string;
  nonce: string;
  codeVerifier: string;
  tenantId: string;
  providerId: string;
  /** Absolute URL to redirect to after a successful login. */
  returnTo?: string;
  /** Unix ms. */
  iat: number;
  /** Unix ms. */
  exp: number;
}

export const OIDC_STATE_COOKIE_NAME = "evk_oidc_state";
export const OIDC_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ── Secret key cache ────────────────────────────────────────────────────────

let cachedKey: CryptoKey | null = null;
let cachedDevSecret: string | null = null;

function devSecret(): string {
  if (!cachedDevSecret) {
    cachedDevSecret =
      "evk-dev-oidc-state-" +
      Math.random().toString(36).slice(2) +
      Date.now().toString(36);
  }
  return cachedDevSecret;
}

function secret(): string {
  const base = process.env.ROLE_GUARD_SECRET;
  if (base && base.length >= 32) return base + "::oidc-state";
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "ROLE_GUARD_SECRET is required in production for OIDC state signing.",
    );
  }
  return devSecret() + "::oidc-state";
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

// ── Random helpers ──────────────────────────────────────────────────────────

export function randomUrlSafe(n: number): string {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ── Sign / verify ───────────────────────────────────────────────────────────

export async function signOidcState(payload: OidcStatePayload): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(payload));
  const key = await getKey();
  const sig = await crypto.subtle.sign("HMAC", key, toArrayBuffer(json));
  return bytesToBase64Url(json) + "." + bytesToBase64Url(new Uint8Array(sig));
}

export type OidcStateVerifyResult =
  | { ok: true; payload: OidcStatePayload }
  | {
      ok: false;
      reason: "missing" | "malformed" | "bad_signature" | "expired";
    };

export async function verifyOidcState(
  cookieValue: string | undefined | null,
  opts: { nowMs?: number } = {},
): Promise<OidcStateVerifyResult> {
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
  if (!isStatePayload(decoded)) return { ok: false, reason: "malformed" };
  const now = opts.nowMs ?? Date.now();
  if (decoded.exp <= now) return { ok: false, reason: "expired" };
  return { ok: true, payload: decoded };
}

function isStatePayload(v: unknown): v is OidcStatePayload {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (o.v !== 1) return false;
  if (typeof o.state !== "string") return false;
  if (typeof o.nonce !== "string") return false;
  if (typeof o.codeVerifier !== "string") return false;
  if (typeof o.tenantId !== "string") return false;
  if (typeof o.providerId !== "string") return false;
  if (o.returnTo !== undefined && typeof o.returnTo !== "string") return false;
  if (typeof o.iat !== "number") return false;
  if (typeof o.exp !== "number") return false;
  return true;
}

// ── Cookie helpers ──────────────────────────────────────────────────────────
//
// SameSite=Lax (not Strict) — this cookie MUST survive the top-level
// redirect back from the IdP. Strict would kill that navigation.
// HttpOnly + Secure (in prod) are preserved.

export function buildOidcStateCookie(signedValue: string): string {
  const parts = [
    `${OIDC_STATE_COOKIE_NAME}=${signedValue}`,
    `Max-Age=${Math.floor(OIDC_STATE_TTL_MS / 1000)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

export function buildClearOidcStateCookie(): string {
  const parts = [
    `${OIDC_STATE_COOKIE_NAME}=`,
    "Max-Age=0",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}
