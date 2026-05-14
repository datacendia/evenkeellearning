// ─────────────────────────────────────────────────────────────────────────────
// lib/lti/state.ts
//
// v1.8.0 — Signed state + nonce binding for the LTI 1.3 OIDC dance.
//
// HOW IT FITS
// ───────────
// The LTI 1.3 launch is OIDC implicit flow with `response_mode=form_post`.
// We MUST:
//   1. Generate an unpredictable `nonce` and `state` during the login
//      initiation step.
//   2. Send them to the LMS as part of the auth redirect.
//   3. Confirm at launch time that the `id_token.nonce` matches what
//      we issued and that the `state` form-field is intact.
//
// Without a server-side database we encode the binding into the
// `state` parameter itself: a short HMAC-signed JSON blob that
// contains the issued nonce, the target_link_uri, the platform id,
// and an expiry. The launch handler reads `state`, validates its
// signature + expiry, and then checks that `id_token.nonce` matches
// the nonce baked into the state. That gives the same security
// guarantee as a server-side store, without the database.
//
// SECRET KEY
// ──────────
// Shares the secret with `lib/auth/server-session.ts` so the same
// rotation drill invalidates both surfaces. Process-local, ephemeral
// fallback in dev (the launch flow is rejected on next process start).
// ─────────────────────────────────────────────────────────────────────────────

import {
  base64UrlToBytes,
  bytesToBase64Url,
  toArrayBuffer,
} from "@/lib/crypto/base64url";

/** Maximum lifetime of an issued login-initiation state. */
export const STATE_TTL_MS = 10 * 60 * 1000;

/** Payload baked into the signed state string. */
export interface LtiStatePayload {
  v: 1;
  /** Stable platform id from the registry. */
  platformId: string;
  /** Nonce we issued for this login attempt. */
  nonce: string;
  /** Target link URI the LMS asked us to bind. */
  targetLinkUri: string;
  /** Unix ms of state expiry. */
  exp: number;
  /** Random per-attempt component for unique state. */
  jti: string;
}

let cachedKey: CryptoKey | null = null;
let cachedSecretSource: string | null = null;

function getSecretMaterial(): string {
  // Reuse ROLE_GUARD_SECRET — admin operations are unified under one
  // rotation drill. Add a per-purpose suffix so collisions across
  // surfaces are impossible.
  const env = process.env.ROLE_GUARD_SECRET;
  if (env && env.length >= 32) return env + "::lti-state";
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "ROLE_GUARD_SECRET is required in production for LTI state signing.",
    );
  }
  if (!cachedSecretSource) {
    cachedSecretSource =
      "evk-dev-lti-state-" +
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

/**
 * Constant-time byte equality. Mirror of the helper in
 * `lib/auth/server-session.ts` — kept local so this module has no
 * cross-dependency on the role-session implementation.
 */
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

/** Generate a fresh nonce (used inside the state and sent to the LMS). */
export function generateNonce(): string {
  return randomB64Url(24);
}

/**
 * Issue a signed state string binding (platformId, nonce, target).
 *
 * Format:  base64url(JSON(payload)) + "." + base64url(HMAC-SHA256(payload))
 */
export async function issueState(args: {
  platformId: string;
  nonce: string;
  targetLinkUri: string;
}): Promise<string> {
  const payload: LtiStatePayload = {
    v: 1,
    platformId: args.platformId,
    nonce: args.nonce,
    targetLinkUri: args.targetLinkUri,
    exp: Date.now() + STATE_TTL_MS,
    jti: randomB64Url(8),
  };
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const key = await getKey();
  const sig = await crypto.subtle.sign("HMAC", key, toArrayBuffer(payloadBytes));
  return (
    bytesToBase64Url(payloadBytes) + "." + bytesToBase64Url(new Uint8Array(sig))
  );
}

/** Stable reasons for state-verification failure. */
export type StateVerificationReason =
  | "missing"
  | "malformed"
  | "bad_signature"
  | "expired"
  | "wrong_version";

export type StateVerificationResult =
  | { ok: true; payload: LtiStatePayload }
  | { ok: false; reason: StateVerificationReason };

/** Verify a state string and return the decoded payload. */
export async function verifyState(
  state: string | undefined | null,
  opts: { nowMs?: number } = {},
): Promise<StateVerificationResult> {
  if (!state || typeof state !== "string") {
    return { ok: false, reason: "missing" };
  }
  const parts = state.split(".");
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

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!isStatePayload(payload)) return { ok: false, reason: "malformed" };
  if (payload.v !== 1) return { ok: false, reason: "wrong_version" };
  const now = opts.nowMs ?? Date.now();
  if (payload.exp <= now) return { ok: false, reason: "expired" };

  return { ok: true, payload };
}

function isStatePayload(v: unknown): v is LtiStatePayload {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    o.v === 1 &&
    typeof o.platformId === "string" &&
    typeof o.nonce === "string" &&
    typeof o.targetLinkUri === "string" &&
    typeof o.exp === "number" &&
    typeof o.jti === "string"
  );
}
