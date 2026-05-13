// ─────────────────────────────────────────────────────────────────────────────
// lib/district/passkey-verify.ts
//
// v1.8.3 — Server-side WebAuthn assertion verifier.
//
// PURPOSE
// ───────
// The browser-side `lib/crypto/passkey.ts` verifies that a passkey
// signature commits to a payload digest. The server needs STRONGER
// checks for the refresh-token flow:
//
//   1. The clientDataJSON `challenge` MUST equal the challenge the
//      server itself issued moments earlier (not just any digest).
//   2. The clientDataJSON `origin` MUST be one of the allowed
//      origins for this tool.
//   3. The `rpIdHash` in authenticatorData MUST equal SHA-256 of the
//      relying-party id.
//   4. The User-Present (UP) flag MUST be set.
//   5. The signCount MUST strictly increase (FIDO clone-detection).
//      The store enforces this via `recordPasskeyAssertion`.
//   6. The ECDSA signature MUST verify against the stored SPKI public
//      key over `authenticatorData || sha256(clientDataJSON)`.
//
// This module performs (1)–(4) and (6); the store handles (5).
//
// RUNTIME
// ───────
// Pure Web Crypto. Works in the Node and Edge runtimes.
// ─────────────────────────────────────────────────────────────────────────────

import { base64UrlToBytes, toArrayBuffer } from "@/lib/crypto/base64url";

/** Stable failure reasons. */
export type PasskeyAssertionFailure =
  | "malformed_client_data"
  | "wrong_type"
  | "wrong_challenge"
  | "untrusted_origin"
  | "malformed_authenticator_data"
  | "wrong_rp_id"
  | "user_not_present"
  | "bad_signature"
  | "import_failed"
  | "verify_threw";

export interface PasskeyAssertionInput {
  /** Challenge the server issued and persisted; expected in clientData. */
  expectedChallengeB64url: string;
  /** Allowed origin values (e.g. ["https://app.example"]). */
  allowedOrigins: ReadonlyArray<string>;
  /** RP id used at enrolment time (must match the rpIdHash). */
  rpId: string;
  /** Base64url credentialId the client claims (used by caller to look up SPKI). */
  credentialIdB64url: string;
  /** Base64url authenticatorData blob. */
  authenticatorDataB64url: string;
  /** Base64url clientDataJSON UTF-8 bytes. */
  clientDataJsonB64url: string;
  /** Base64url raw ECDSA signature (r||s, 64 bytes for P-256). */
  signatureB64url: string;
  /** Base64url SPKI public key from the store record. */
  spkiB64url: string;
}

export type PasskeyAssertionResult =
  | {
      ok: true;
      /** signCount extracted from authenticatorData. */
      signCount: number;
      /** Flags byte from authenticatorData (UP, UV, AT, ED, etc). */
      flags: number;
    }
  | { ok: false; reason: PasskeyAssertionFailure; detail?: string };

/**
 * Verify a WebAuthn assertion produced by `navigator.credentials.get`.
 *
 * The caller is responsible for:
 *   • generating + persisting the challenge with a short TTL
 *   • looking up the stored credential row (SPKI + previous signCount)
 *   • calling `store.recordPasskeyAssertion` AFTER this returns ok
 */
export async function verifyPasskeyAssertion(
  input: PasskeyAssertionInput,
): Promise<PasskeyAssertionResult> {
  // ── (A) clientDataJSON: type, challenge, origin ──────────────────
  let clientData: Uint8Array;
  try {
    clientData = base64UrlToBytes(input.clientDataJsonB64url);
  } catch {
    return { ok: false, reason: "malformed_client_data" };
  }
  let cdj: { type?: string; challenge?: string; origin?: string };
  try {
    cdj = JSON.parse(new TextDecoder().decode(clientData));
  } catch {
    return { ok: false, reason: "malformed_client_data" };
  }
  if (cdj.type !== "webauthn.get") {
    return { ok: false, reason: "wrong_type", detail: String(cdj.type) };
  }
  if (cdj.challenge !== input.expectedChallengeB64url) {
    return { ok: false, reason: "wrong_challenge" };
  }
  if (typeof cdj.origin !== "string" || !input.allowedOrigins.includes(cdj.origin)) {
    return { ok: false, reason: "untrusted_origin", detail: cdj.origin };
  }

  // ── (B) authenticatorData: rpIdHash, flags, signCount ────────────
  let authData: Uint8Array;
  try {
    authData = base64UrlToBytes(input.authenticatorDataB64url);
  } catch {
    return { ok: false, reason: "malformed_authenticator_data" };
  }
  if (authData.length < 37) {
    return { ok: false, reason: "malformed_authenticator_data" };
  }
  const rpIdHash = authData.slice(0, 32);
  const flags = authData[32];
  const signCount =
    (authData[33] << 24) |
    (authData[34] << 16) |
    (authData[35] << 8) |
    authData[36];
  // Bit 0 of flags = User Present.
  if ((flags & 0x01) === 0) {
    return { ok: false, reason: "user_not_present" };
  }
  const expectedRpHash = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      toArrayBuffer(new TextEncoder().encode(input.rpId)),
    ),
  );
  if (!constantTimeEqual(rpIdHash, expectedRpHash)) {
    return { ok: false, reason: "wrong_rp_id" };
  }

  // ── (C) Signature verify ──────────────────────────────────────────
  let pubKey: CryptoKey;
  try {
    pubKey = await crypto.subtle.importKey(
      "spki",
      toArrayBuffer(base64UrlToBytes(input.spkiB64url)),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
  } catch {
    return { ok: false, reason: "import_failed" };
  }
  const clientDataHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", toArrayBuffer(clientData)),
  );
  const signedBytes = concat(authData, clientDataHash);
  let sigBytes: Uint8Array;
  try {
    sigBytes = base64UrlToBytes(input.signatureB64url);
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      pubKey,
      toArrayBuffer(sigBytes),
      toArrayBuffer(signedBytes),
    );
  } catch {
    return { ok: false, reason: "verify_threw" };
  }
  if (!valid) return { ok: false, reason: "bad_signature" };

  return { ok: true, signCount, flags };
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
