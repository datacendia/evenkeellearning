// ─────────────────────────────────────────────────────────────────────────────
// lib/district/auth.ts
//
// v1.8.3 — High-level district auth orchestration.
//
// PUBLIC OPERATIONS
// ─────────────────
//   • `establishSession`           — called by SSO/LTI callback after a
//                                    successful upstream authentication.
//                                    Mints initial (refresh, access) pair.
//                                    Issues a new refresh-token DB row.
//   • `refreshAccessToken`         — called by `POST /api/district/auth/refresh`.
//                                    Verifies refresh cookie + passkey
//                                    assertion + signCount ratchet; mints
//                                    a fresh access token.
//   • `revokeSession`              — called by `POST /api/district/auth/logout`.
//                                    Revokes the current refresh row by
//                                    jti; idempotent.
//   • `loadCurrentSession`         — read-only: returns the access-token
//                                    payload from the cookie, or null.
//
// AUDIT
// ─────
// Every successful establish / refresh / revocation writes a row into
// `audit_events` via the DistrictStore. The action codes are stable:
//
//     district.session.established
//     district.session.refreshed
//     district.session.revoked
//     district.session.refresh_failed
// ─────────────────────────────────────────────────────────────────────────────

import type { DistrictStore } from "./store";
import {
  verifyPasskeyAssertion,
  type PasskeyAssertionInput,
} from "./passkey-verify";
import {
  ACCESS_TOKEN_TTL_MS,
  REFRESH_TOKEN_TTL_MS,
  issueAccessToken,
  issueRefreshToken,
  verifyRefreshToken,
  type AccessTokenPayload,
  type RefreshTokenPayload,
} from "./tokens";
import type { DistrictRole } from "./types";

// ── establishSession ────────────────────────────────────────────────────────

export interface EstablishSessionArgs {
  store: DistrictStore;
  tenantId: string;
  userId: string;
  /** Passkey credential the session is bound to. */
  credentialIdB64url: string;
  /** Roles to bake into the initial access token. */
  roles: DistrictRole[];
  /**
   * Tag describing how the user authenticated upstream — written to
   * the audit log. Examples: "lti", "sso.oidc.google", "sso.saml".
   */
  source: string;
  nowMs?: number;
}

export interface EstablishSessionResult {
  refreshToken: string;
  refreshPayload: RefreshTokenPayload;
  accessToken: string;
  accessPayload: AccessTokenPayload;
}

export async function establishSession(
  args: EstablishSessionArgs,
): Promise<EstablishSessionResult> {
  const { store, tenantId, userId, credentialIdB64url, roles, source } = args;
  const now = args.nowMs ?? Date.now();

  const refresh = await issueRefreshToken({
    tenantId,
    userId,
    credentialIdB64url,
    nowMs: now,
  });
  await store.insertRefreshToken({
    jti: refresh.payload.jti,
    tenantId,
    userId,
    credentialIdB64url,
    issuedAtIso: new Date(now).toISOString(),
    expiresAtIso: new Date(refresh.payload.exp).toISOString(),
  });

  const access = await issueAccessToken({ tenantId, userId, roles, nowMs: now });

  await store.appendAudit(tenantId, {
    actorUserId: userId,
    action: "district.session.established",
    targetUserId: userId,
    detail: { source, credentialIdB64url, jti: refresh.payload.jti },
  });

  return {
    refreshToken: refresh.token,
    refreshPayload: refresh.payload,
    accessToken: access.token,
    accessPayload: access.payload,
  };
}

// ── refreshAccessToken ──────────────────────────────────────────────────────

export type RefreshFailure =
  | "missing_refresh_cookie"
  | "bad_refresh_signature"
  | "malformed_refresh"
  | "refresh_expired"
  | "refresh_revoked"
  | "refresh_not_in_store"
  | "user_inactive"
  | "credential_not_found"
  | "credential_revoked"
  | "credential_mismatch"
  | "assertion_failed"
  | "signcount_replay";

export interface RefreshArgs {
  store: DistrictStore;
  /** Refresh-token cookie value. */
  refreshTokenCookie: string | null | undefined;
  /** WebAuthn assertion the client just produced over a server challenge. */
  passkeyAssertion: PasskeyAssertionInput;
  /** Roles to bake into the new access token (caller re-checks them). */
  roles: DistrictRole[];
  nowMs?: number;
}

export type RefreshResult =
  | {
      ok: true;
      accessToken: string;
      accessPayload: AccessTokenPayload;
    }
  | { ok: false; reason: RefreshFailure; detail?: string };

export async function refreshAccessToken(
  args: RefreshArgs,
): Promise<RefreshResult> {
  const { store, refreshTokenCookie, passkeyAssertion, roles } = args;
  const now = args.nowMs ?? Date.now();

  // (1) Refresh-token cookie shape + HMAC + expiry.
  const v = await verifyRefreshToken(refreshTokenCookie, { nowMs: now });
  if (!v.ok) {
    return mapRefreshFailure(v.reason);
  }
  const { payload } = v;

  // (2) The token row in the store must exist and not be revoked.
  const row = await store.getRefreshToken(payload.tenantId, payload.jti);
  if (!row) {
    return failAudit(
      store,
      payload.tenantId,
      payload.userId,
      "refresh_not_in_store",
    );
  }
  if (row.revokedAtIso) {
    return failAudit(
      store,
      payload.tenantId,
      payload.userId,
      "refresh_revoked",
    );
  }

  // (3) User must still be active.
  const user = await store.getUser(payload.tenantId, payload.userId);
  if (!user || !user.active) {
    return failAudit(
      store,
      payload.tenantId,
      payload.userId,
      "user_inactive",
    );
  }

  // (4) Passkey credential lookup, active, and matches the token binding.
  const credential = await store.getPasskeyCredentialByCredentialId(
    payload.tenantId,
    passkeyAssertion.credentialIdB64url,
  );
  if (!credential) {
    return failAudit(
      store,
      payload.tenantId,
      payload.userId,
      "credential_not_found",
    );
  }
  if (credential.revokedAtIso) {
    return failAudit(
      store,
      payload.tenantId,
      payload.userId,
      "credential_revoked",
    );
  }
  if (credential.credentialIdB64url !== payload.credentialIdB64url) {
    return failAudit(
      store,
      payload.tenantId,
      payload.userId,
      "credential_mismatch",
    );
  }
  if (credential.userId !== payload.userId) {
    return failAudit(
      store,
      payload.tenantId,
      payload.userId,
      "credential_mismatch",
    );
  }

  // (5) Verify the WebAuthn assertion using the stored SPKI.
  const assertion = await verifyPasskeyAssertion({
    ...passkeyAssertion,
    spkiB64url: credential.spkiB64url,
  });
  if (!assertion.ok) {
    return failAudit(
      store,
      payload.tenantId,
      payload.userId,
      "assertion_failed",
      assertion.reason,
    );
  }

  // (6) Apply the signCount ratchet via the store.
  const ratcheted = await store.recordPasskeyAssertion(
    payload.tenantId,
    credential.credentialIdB64url,
    assertion.signCount,
  );
  if (!ratcheted) {
    return failAudit(
      store,
      payload.tenantId,
      payload.userId,
      "signcount_replay",
    );
  }

  // (7) Bump the refresh row's lastUsed (DOES NOT extend expiry).
  await store.touchRefreshToken(payload.tenantId, payload.jti);

  // (8) Mint a fresh access token.
  const access = await issueAccessToken({
    tenantId: payload.tenantId,
    userId: payload.userId,
    roles,
    nowMs: now,
  });

  await store.appendAudit(payload.tenantId, {
    actorUserId: payload.userId,
    action: "district.session.refreshed",
    targetUserId: payload.userId,
    detail: { jti: payload.jti, accessJti: access.payload.jti },
  });

  return { ok: true, accessToken: access.token, accessPayload: access.payload };
}

function mapRefreshFailure(
  reason: "missing" | "malformed" | "bad_signature" | "expired",
): RefreshResult {
  switch (reason) {
    case "missing":
      return { ok: false, reason: "missing_refresh_cookie" };
    case "malformed":
      return { ok: false, reason: "malformed_refresh" };
    case "bad_signature":
      return { ok: false, reason: "bad_refresh_signature" };
    case "expired":
      return { ok: false, reason: "refresh_expired" };
  }
}

async function failAudit(
  store: DistrictStore,
  tenantId: string,
  userId: string,
  reason: RefreshFailure,
  detail?: string,
): Promise<RefreshResult> {
  try {
    await store.appendAudit(tenantId, {
      actorUserId: userId,
      action: "district.session.refresh_failed",
      targetUserId: userId,
      detail: detail ? { reason, detail } : { reason },
    });
  } catch {
    /* swallow — audit failure shouldn't mask the original refusal */
  }
  return { ok: false, reason, detail };
}

// ── revokeSession ───────────────────────────────────────────────────────────

export interface RevokeArgs {
  store: DistrictStore;
  refreshTokenCookie: string | null | undefined;
}

export async function revokeSession(args: RevokeArgs): Promise<{
  ok: true;
  /** True if we actually revoked something (vs. an already-stale cookie). */
  revoked: boolean;
}> {
  if (!args.refreshTokenCookie) return { ok: true, revoked: false };
  const v = await verifyRefreshToken(args.refreshTokenCookie);
  if (!v.ok) return { ok: true, revoked: false };
  const changed = await args.store.revokeRefreshToken(
    v.payload.tenantId,
    v.payload.jti,
  );
  if (changed) {
    await args.store.appendAudit(v.payload.tenantId, {
      actorUserId: v.payload.userId,
      action: "district.session.revoked",
      targetUserId: v.payload.userId,
      detail: { jti: v.payload.jti },
    });
  }
  return { ok: true, revoked: changed };
}

// ── TTL surface for callers ─────────────────────────────────────────────────

export const SESSION_TTLS = {
  refreshTokenMs: REFRESH_TOKEN_TTL_MS,
  accessTokenMs: ACCESS_TOKEN_TTL_MS,
} as const;
