// ─────────────────────────────────────────────────────────────────────────────
// lib/district/tokens.ts
//
// v1.8.3 — Refresh + access token issuance for the district auth flow.
//
// FLOW SUMMARY
// ────────────
//   1. User authenticates via SSO / OIDC / SAML / LTI (in scope of
//      `d2-sso-*` and `p2-lti`). The auth callback issues an INITIAL
//      pair: (refresh-token cookie, access-token cookie).
//   2. The access token is short-lived (15 min HMAC JWT-ish). It
//      authorises every API call until it expires.
//   3. When the access token expires, the client calls
//      `POST /api/district/auth/refresh` with the refresh-token
//      cookie AND a fresh WebAuthn assertion bound to the credential
//      stored alongside the refresh token. We verify both, then mint
//      a new access token. The refresh token itself is reused; we
//      bump its `lastUsedAt` and re-issue cookie with same expiry.
//   4. Logout revokes the refresh token by jti and clears the cookie.
//
// TOKEN FORMAT
// ────────────
//   • Both tokens: `<base64url(JSON payload)>.<base64url(HMAC-SHA256(payload))>`.
//   • Refresh token payload: { v, tenantId, userId, credentialIdB64url, jti, exp }.
//   • Access token payload : { v, tenantId, userId, role[], exp, jti }.
//
// REVOCATION MODEL
// ────────────────
//   • Refresh tokens are tracked in the store; revoking a row makes
//     all future refresh attempts fail.
//   • Access tokens are STATELESS and CANNOT be revoked individually.
//     This is intentional — the 15-min TTL bounds the revocation
//     window, and the refresh path is the chokepoint we DO control.
//
// SECRET KEY
// ──────────
// Reuses `ROLE_GUARD_SECRET` with per-purpose suffixes (`::district-refresh`,
// `::district-access`) so rotation affects all three surfaces together
// (role guard, LTI session, district auth).
// ─────────────────────────────────────────────────────────────────────────────

import {
  base64UrlToBytes,
  bytesToBase64Url,
  toArrayBuffer,
} from "@/lib/crypto/base64url";
import type { DistrictRole } from "./types";

// ── TTLs ────────────────────────────────────────────────────────────────────

export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

// ── Cookie names ────────────────────────────────────────────────────────────

export const REFRESH_COOKIE_NAME = "evk_district_refresh";
export const ACCESS_COOKIE_NAME = "evk_district_access";

// ── Payload shapes ──────────────────────────────────────────────────────────

export interface RefreshTokenPayload {
  v: 1;
  tenantId: string;
  userId: string;
  credentialIdB64url: string;
  jti: string;
  /** Unix-ms expiry. */
  exp: number;
}

export interface AccessTokenPayload {
  v: 1;
  tenantId: string;
  userId: string;
  roles: DistrictRole[];
  /** Unix-ms expiry. */
  exp: number;
  /** Stable jti for diagnostic logging (NOT used for revocation). */
  jti: string;
}

// ── Signing key cache (one per purpose) ─────────────────────────────────────

const cachedKeys: Record<string, CryptoKey | null> = {};
let cachedDevSecret: string | null = null;

function devSecret(): string {
  if (!cachedDevSecret) {
    cachedDevSecret =
      "evk-dev-district-tok-" +
      Math.random().toString(36).slice(2) +
      Date.now().toString(36);
  }
  return cachedDevSecret;
}

function secretFor(purpose: "refresh" | "access"): string {
  const base = process.env.ROLE_GUARD_SECRET;
  const tag = purpose === "refresh" ? "::district-refresh" : "::district-access";
  if (base && base.length >= 32) return base + tag;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "ROLE_GUARD_SECRET is required in production for district token signing.",
    );
  }
  return devSecret() + tag;
}

async function getKey(purpose: "refresh" | "access"): Promise<CryptoKey> {
  const existing = cachedKeys[purpose];
  if (existing) return existing;
  const raw = new TextEncoder().encode(secretFor(purpose));
  const k = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(raw),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  cachedKeys[purpose] = k;
  return k;
}

// ── Random helpers ──────────────────────────────────────────────────────────

function randomB64Url(n: number): string {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

/** Generate a fresh challenge for the refresh-time WebAuthn assertion. */
export function generateRefreshChallenge(): string {
  return randomB64Url(32);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ── Signing / parsing ───────────────────────────────────────────────────────

async function sign(
  purpose: "refresh" | "access",
  payload: object,
): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(payload));
  const key = await getKey(purpose);
  const sig = await crypto.subtle.sign("HMAC", key, toArrayBuffer(json));
  return bytesToBase64Url(json) + "." + bytesToBase64Url(new Uint8Array(sig));
}

async function verify(
  purpose: "refresh" | "access",
  token: string,
): Promise<unknown | null> {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  let payloadBytes: Uint8Array;
  let sigBytes: Uint8Array;
  try {
    payloadBytes = base64UrlToBytes(parts[0]);
    sigBytes = base64UrlToBytes(parts[1]);
  } catch {
    return null;
  }
  const key = await getKey(purpose);
  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, toArrayBuffer(payloadBytes)),
  );
  if (!timingSafeEqual(expected, sigBytes)) return null;
  try {
    return JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
}

// ── Refresh token issue / verify ────────────────────────────────────────────

export interface IssueRefreshTokenArgs {
  tenantId: string;
  userId: string;
  credentialIdB64url: string;
  nowMs?: number;
}

export interface IssuedRefreshToken {
  token: string;
  payload: RefreshTokenPayload;
}

export async function issueRefreshToken(
  args: IssueRefreshTokenArgs,
): Promise<IssuedRefreshToken> {
  const now = args.nowMs ?? Date.now();
  const payload: RefreshTokenPayload = {
    v: 1,
    tenantId: args.tenantId,
    userId: args.userId,
    credentialIdB64url: args.credentialIdB64url,
    jti: randomB64Url(16),
    exp: now + REFRESH_TOKEN_TTL_MS,
  };
  const token = await sign("refresh", payload);
  return { token, payload };
}

export type RefreshTokenVerifyResult =
  | { ok: true; payload: RefreshTokenPayload }
  | { ok: false; reason: "missing" | "malformed" | "bad_signature" | "expired" };

export async function verifyRefreshToken(
  token: string | undefined | null,
  opts: { nowMs?: number } = {},
): Promise<RefreshTokenVerifyResult> {
  if (!token) return { ok: false, reason: "missing" };
  const decoded = (await verify("refresh", token)) as unknown;
  if (!decoded) return { ok: false, reason: "bad_signature" };
  if (!isRefreshPayload(decoded)) return { ok: false, reason: "malformed" };
  const now = opts.nowMs ?? Date.now();
  if (decoded.exp <= now) return { ok: false, reason: "expired" };
  return { ok: true, payload: decoded };
}

function isRefreshPayload(v: unknown): v is RefreshTokenPayload {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    o.v === 1 &&
    typeof o.tenantId === "string" &&
    typeof o.userId === "string" &&
    typeof o.credentialIdB64url === "string" &&
    typeof o.jti === "string" &&
    typeof o.exp === "number"
  );
}

// ── Access token issue / verify ─────────────────────────────────────────────

export interface IssueAccessTokenArgs {
  tenantId: string;
  userId: string;
  roles: DistrictRole[];
  nowMs?: number;
}

export interface IssuedAccessToken {
  token: string;
  payload: AccessTokenPayload;
}

export async function issueAccessToken(
  args: IssueAccessTokenArgs,
): Promise<IssuedAccessToken> {
  const now = args.nowMs ?? Date.now();
  const payload: AccessTokenPayload = {
    v: 1,
    tenantId: args.tenantId,
    userId: args.userId,
    roles: args.roles.slice(), // defensive copy
    exp: now + ACCESS_TOKEN_TTL_MS,
    jti: randomB64Url(8),
  };
  const token = await sign("access", payload);
  return { token, payload };
}

export type AccessTokenVerifyResult =
  | { ok: true; payload: AccessTokenPayload }
  | { ok: false; reason: "missing" | "malformed" | "bad_signature" | "expired" };

export async function verifyAccessToken(
  token: string | undefined | null,
  opts: { nowMs?: number } = {},
): Promise<AccessTokenVerifyResult> {
  if (!token) return { ok: false, reason: "missing" };
  const decoded = (await verify("access", token)) as unknown;
  if (!decoded) return { ok: false, reason: "bad_signature" };
  if (!isAccessPayload(decoded)) return { ok: false, reason: "malformed" };
  const now = opts.nowMs ?? Date.now();
  if (decoded.exp <= now) return { ok: false, reason: "expired" };
  return { ok: true, payload: decoded };
}

function isAccessPayload(v: unknown): v is AccessTokenPayload {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (o.v !== 1) return false;
  if (typeof o.tenantId !== "string") return false;
  if (typeof o.userId !== "string") return false;
  if (!Array.isArray(o.roles)) return false;
  for (const r of o.roles) {
    if (typeof r !== "string") return false;
  }
  if (typeof o.exp !== "number") return false;
  if (typeof o.jti !== "string") return false;
  return true;
}

// ── Cookie helpers ──────────────────────────────────────────────────────────

function buildCookie(
  name: string,
  value: string,
  maxAgeSec: number,
): string {
  const parts = [
    `${name}=${value}`,
    `Max-Age=${maxAgeSec}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

function buildClearCookie(name: string): string {
  const parts = [`${name}=`, "Max-Age=0", "Path=/", "HttpOnly", "SameSite=Strict"];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

export function buildRefreshCookie(token: string): string {
  return buildCookie(REFRESH_COOKIE_NAME, token, Math.floor(REFRESH_TOKEN_TTL_MS / 1000));
}

export function buildAccessCookie(token: string): string {
  return buildCookie(ACCESS_COOKIE_NAME, token, Math.floor(ACCESS_TOKEN_TTL_MS / 1000));
}

export function buildClearAuthCookies(): string[] {
  return [buildClearCookie(REFRESH_COOKIE_NAME), buildClearCookie(ACCESS_COOKIE_NAME)];
}
