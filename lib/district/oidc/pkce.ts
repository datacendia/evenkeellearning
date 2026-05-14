// ─────────────────────────────────────────────────────────────────────────────
// lib/district/oidc/pkce.ts
//
// v1.8.4 — PKCE (RFC 7636) helpers for the OIDC authorization-code flow.
//
// Why PKCE
// ────────
// Without PKCE, an attacker who intercepts the redirect URL (via
// referrer leak, malicious browser extension, or a compromised
// redirect handler) can trade the `code` for tokens. PKCE prevents
// this by binding the authorization code to a secret the server
// generated at /authorize time and that never leaves our server:
//
//    1. Server generates a random `code_verifier` (≥43 chars, base64url).
//    2. Server computes `code_challenge = base64url(SHA-256(verifier))`.
//    3. Server redirects to /authorize?code_challenge=...&code_challenge_method=S256.
//    4. On /callback, server exchanges code with `code_verifier`.
//    5. The IdP verifies SHA-256(verifier) == stored challenge.
//
// We support only the S256 method. The (legacy) "plain" method is
// vulnerable to the same interception attack PKCE is supposed to
// prevent and is explicitly forbidden for new deployments.
// ─────────────────────────────────────────────────────────────────────────────

import {
  bytesToBase64Url,
  toArrayBuffer,
} from "@/lib/crypto/base64url";

/**
 * Generate a fresh 64-byte random `code_verifier`, base64url-encoded.
 * 64 bytes → 86 chars after base64url, well above the RFC 7636 minimum
 * of 43 and under the max of 128.
 */
export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

/**
 * Compute the S256 code_challenge for a given verifier:
 *   `base64url(SHA-256(verifier_ascii))`.
 */
export async function codeChallengeS256(verifier: string): Promise<string> {
  const input = new TextEncoder().encode(verifier);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", toArrayBuffer(input)),
  );
  return bytesToBase64Url(digest);
}

/**
 * RFC 7636 §4.1 allows only `[A-Z][a-z][0-9]-._~` and a length of
 * 43–128 characters. Anything else is a programming error. The
 * generator above always complies; this guard is for when external
 * callers hand us a verifier (e.g. a different server in the future).
 */
export function isValidVerifier(v: string): boolean {
  if (typeof v !== "string") return false;
  if (v.length < 43 || v.length > 128) return false;
  return /^[A-Za-z0-9\-._~]+$/.test(v);
}
