// ─────────────────────────────────────────────────────────────────────────────
// lib/district/oidc/handlers.ts
//
// v1.8.5 — Pure-function handlers for the /start and /callback OIDC
// HTTP routes. Keeping these framework-free lets us test every code
// path end-to-end (including both success and failure branches)
// without spinning up a Next.js server.
//
// The app/api/.../route.ts files are thin wrappers that marshal a
// `NextRequest` into the `OidcStartInput` / `OidcCallbackInput`
// shapes, call these handlers, and translate the result back into
// a `NextResponse`.
// ─────────────────────────────────────────────────────────────────────────────

import type { DistrictStore } from "../store";
import {
  buildOidcStateCookie,
  buildClearOidcStateCookie,
  OIDC_STATE_TTL_MS,
  OidcStatePayload,
  randomUrlSafe,
  signOidcState,
} from "./state";
import { codeChallengeS256, generateCodeVerifier } from "./pkce";
import {
  buildAuthorizeUrl,
  type BuildAuthorizeUrlInput,
} from "./flow";
import {
  completeOidcCallback,
  resolveOidcIdentity,
  type CompleteOidcCallbackArgs,
  type OidcCallbackFailure,
} from "./callback";
import { findOidcProvider, loadOidcProviders } from "./config";
import {
  buildOidcLoginIntentCookie,
  OIDC_LOGIN_INTENT_TTL_MS,
  signOidcLoginIntent,
} from "./login-intent";
import {
  fetchOidcDiscovery,
  type OidcDiscoveryDocument,
} from "./discovery";
import type { OidcProviderConfig } from "./provider";

// ── Common shapes ───────────────────────────────────────────────────────────

export interface HttpResult {
  status: number;
  /** Always includes `content-type`. `Set-Cookie` MAY appear multiple times. */
  headers: Headers;
  body: string;
}

function plainTextResponse(status: number, body: string): HttpResult {
  const headers = new Headers();
  headers.set("content-type", "text/plain; charset=utf-8");
  return { status, headers, body };
}

function redirectResponse(
  status: 302 | 303,
  location: string,
  extraCookies: string[] = [],
): HttpResult {
  const headers = new Headers();
  headers.set("content-type", "text/plain; charset=utf-8");
  headers.set("location", location);
  for (const c of extraCookies) headers.append("set-cookie", c);
  return { status, headers, body: `Redirecting to ${location}` };
}

// ── /start handler ──────────────────────────────────────────────────────────

export interface OidcStartInput {
  tenantId: string;
  providerId: string;
  /** The request's own origin (protocol+host), used to build redirect_uri. */
  requestOrigin: string;
  /** Optional return destination after login. MUST be same-origin. */
  returnTo?: string | null;
  /** Whether to ask the IdP to force re-auth. */
  forceReauth?: boolean;
  /** Whether to ask the IdP to show its account chooser. */
  promptSelectAccount?: boolean;
  /** Injectable for tests. */
  fetcher?: typeof fetch;
  /** Injectable clock for tests (ms). */
  nowMs?: number;
  /** Optional pre-loaded provider registry. Defaults to `loadOidcProviders()`. */
  providers?: ReturnType<typeof loadOidcProviders>;
}

export async function handleOidcStart(
  input: OidcStartInput,
): Promise<HttpResult> {
  const provider = findOidcProvider(
    input.tenantId,
    input.providerId,
    input.providers ?? loadOidcProviders(),
  );
  if (!provider) {
    return plainTextResponse(404, "OIDC provider not found for this tenant.");
  }

  // Discovery (skipped if endpoints pinned).
  const discovery = await resolveDiscovery(provider, {
    fetcher: input.fetcher ?? fetch,
    nowMs: input.nowMs,
  });
  if (!discovery.ok) {
    return plainTextResponse(
      502,
      `OIDC discovery failed: ${discovery.reason}${
        discovery.detail ? " (" + discovery.detail + ")" : ""
      }`,
    );
  }

  // Clamp returnTo to our own origin.
  const returnTo = clampReturnTo(input.returnTo, input.requestOrigin);

  // Generate PKCE + state/nonce, seal into cookie.
  const state = randomUrlSafe(32);
  const nonce = randomUrlSafe(32);
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await codeChallengeS256(codeVerifier);
  const now = input.nowMs ?? Date.now();
  const payload: OidcStatePayload = {
    v: 1,
    state,
    nonce,
    codeVerifier,
    tenantId: input.tenantId,
    providerId: input.providerId,
    returnTo,
    iat: now,
    exp: now + OIDC_STATE_TTL_MS,
  };
  const signedCookieValue = await signOidcState(payload);

  const redirectUri = buildCallbackUrl(
    input.requestOrigin,
    input.tenantId,
    input.providerId,
  );

  const authorizeInput: BuildAuthorizeUrlInput = {
    discovery: discovery.doc,
    provider,
    redirectUri,
    state,
    nonce,
    codeChallenge,
    forceReauth: input.forceReauth,
    promptSelectAccount: input.promptSelectAccount,
  };
  const authorizeUrl = buildAuthorizeUrl(authorizeInput);

  return redirectResponse(302, authorizeUrl, [
    buildOidcStateCookie(signedCookieValue),
  ]);
}

// ── /callback handler ──────────────────────────────────────────────────────

export interface OidcCallbackInput {
  tenantId: string;
  providerId: string;
  requestOrigin: string;
  /** Value of the `OIDC_STATE_COOKIE_NAME` cookie, or null. */
  stateCookie: string | null;
  /** Query parameters received from the IdP. */
  query: URLSearchParams;
  store: DistrictStore;
  /** Injectables for tests. */
  fetcher?: typeof fetch;
  nowMs?: number;
  nowSeconds?: number;
  /** Where to redirect the browser once we've set the login-intent cookie. */
  bindPasskeyPath?: string;
  /** Optional pre-loaded provider registry. */
  providers?: ReturnType<typeof loadOidcProviders>;
}

/** Final, machine-readable result of a callback. Useful for tests. */
export type OidcCallbackOutcome =
  | {
      kind: "idp_error";
      error: string;
      description?: string;
    }
  | {
      kind: "failed";
      failure: OidcCallbackFailure;
    }
  | {
      kind: "resolve_failed";
      reason: "unknown_user" | "user_inactive";
    }
  | {
      kind: "provider_not_found";
    }
  | {
      kind: "success";
      userId: string;
      /** URL we're redirecting the browser to. */
      redirectTo: string;
      /** Whether the resolved user was newly created. */
      isNewUser: boolean;
      /** Whether that user has at least one active passkey already. */
      hasExistingPasskey: boolean;
    };

export interface OidcCallbackHandlerResult {
  http: HttpResult;
  outcome: OidcCallbackOutcome;
}

export async function handleOidcCallback(
  input: OidcCallbackInput,
): Promise<OidcCallbackHandlerResult> {
  const bindPath = input.bindPasskeyPath ?? "/auth/bind-passkey";

  // (0) Provider must exist.
  const provider = findOidcProvider(
    input.tenantId,
    input.providerId,
    input.providers ?? loadOidcProviders(),
  );
  if (!provider) {
    return {
      http: plainTextResponse(
        404,
        "OIDC provider not found for this tenant.",
      ),
      outcome: { kind: "provider_not_found" },
    };
  }

  // (1) IdP may return error=...&error_description=... instead of code.
  const idpError = input.query.get("error");
  if (idpError) {
    const desc = input.query.get("error_description") ?? undefined;
    // Clear any stale state cookie so a retry is clean.
    const res = plainTextResponse(
      400,
      `OIDC provider returned error: ${idpError}${
        desc ? " (" + desc + ")" : ""
      }`,
    );
    res.headers.append("set-cookie", buildClearOidcStateCookie());
    await auditCallbackFailure(input, `idp_error:${idpError}`);
    return {
      http: res,
      outcome: { kind: "idp_error", error: idpError, description: desc },
    };
  }

  const redirectUri = buildCallbackUrl(
    input.requestOrigin,
    input.tenantId,
    input.providerId,
  );

  const cbArgs: CompleteOidcCallbackArgs = {
    stateCookie: input.stateCookie,
    stateQuery: input.query.get("state"),
    codeQuery: input.query.get("code"),
    expectedTenantId: input.tenantId,
    expectedProviderId: input.providerId,
    provider,
    redirectUri,
    fetcher: input.fetcher,
    nowMs: input.nowMs,
    nowSeconds: input.nowSeconds,
  };
  const cb = await completeOidcCallback(cbArgs);
  if (!cb.ok) {
    const res = plainTextResponse(
      400,
      `OIDC callback rejected: ${cb.failure.stage}/${
        "reason" in cb.failure ? String(cb.failure.reason) : ""
      }`,
    );
    res.headers.append("set-cookie", buildClearOidcStateCookie());
    await auditCallbackFailure(
      input,
      `${cb.failure.stage}:${"reason" in cb.failure ? String(cb.failure.reason) : "?"}`,
    );
    return { http: res, outcome: { kind: "failed", failure: cb.failure } };
  }

  // (2) Resolve or provision the tenant user.
  const resolved = await resolveOidcIdentity({
    store: input.store,
    tenantId: input.tenantId,
    providerId: input.providerId,
    identity: cb.identity,
  });
  if (!resolved.ok) {
    const res = plainTextResponse(
      403,
      `OIDC login refused: ${resolved.reason}`,
    );
    res.headers.append("set-cookie", buildClearOidcStateCookie());
    await auditCallbackFailure(input, `resolve:${resolved.reason}`);
    return {
      http: res,
      outcome: { kind: "resolve_failed", reason: resolved.reason },
    };
  }

  // (3) Build the login-intent cookie.
  const hasExistingPasskey =
    (await input.store.listPasskeyCredentialsForUser(
      input.tenantId,
      resolved.user.id,
    )).some((c) => !c.revokedAtIso);

  const now = input.nowMs ?? Date.now();
  const intentPayload = {
    v: 1 as const,
    tenantId: input.tenantId,
    userId: resolved.user.id,
    externalId: resolved.user.externalId,
    providerId: input.providerId,
    source: `sso.oidc.${input.providerId}`,
    newUser: resolved.isNewUser,
    hasExistingPasskey,
    iat: now,
    exp: now + OIDC_LOGIN_INTENT_TTL_MS,
  };
  const intentCookie = buildOidcLoginIntentCookie(
    await signOidcLoginIntent(intentPayload),
  );

  // (4) Audit event.
  await input.store.appendAudit(input.tenantId, {
    actorUserId: resolved.user.id,
    action: "district.sso.oidc.callback_succeeded",
    targetUserId: resolved.user.id,
    detail: {
      providerId: input.providerId,
      externalId: resolved.user.externalId,
      isNewUser: resolved.isNewUser,
      hasExistingPasskey,
    },
  });

  // (5) Redirect to the passkey-binding page with returnTo preserved.
  const redirectTo = buildBindPasskeyUrl(
    input.requestOrigin,
    bindPath,
    cb.state.returnTo,
  );
  const res: HttpResult = redirectResponse(303, redirectTo, [
    intentCookie,
    buildClearOidcStateCookie(), // state cookie has served its purpose
  ]);

  return {
    http: res,
    outcome: {
      kind: "success",
      userId: resolved.user.id,
      redirectTo,
      isNewUser: resolved.isNewUser,
      hasExistingPasskey,
    },
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Return a discovery document, honouring per-provider pinned endpoints. */
async function resolveDiscovery(
  provider: OidcProviderConfig,
  opts: { fetcher: typeof fetch; nowMs?: number },
): Promise<
  | { ok: true; doc: OidcDiscoveryDocument }
  | { ok: false; reason: string; detail?: string }
> {
  if (
    provider.authorizationEndpoint &&
    provider.tokenEndpoint &&
    provider.jwksUri
  ) {
    return {
      ok: true,
      doc: {
        issuer: provider.issuer,
        authorization_endpoint: provider.authorizationEndpoint,
        token_endpoint: provider.tokenEndpoint,
        jwks_uri: provider.jwksUri,
        end_session_endpoint: provider.endSessionEndpoint,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256", "ES256"],
        raw: {
          issuer: provider.issuer,
          authorization_endpoint: provider.authorizationEndpoint,
          token_endpoint: provider.tokenEndpoint,
          jwks_uri: provider.jwksUri,
          ...(provider.endSessionEndpoint
            ? { end_session_endpoint: provider.endSessionEndpoint }
            : {}),
        },
      },
    };
  }
  const r = await fetchOidcDiscovery(provider.issuer, {
    fetcher: opts.fetcher,
    nowMs: opts.nowMs,
  });
  if (!r.ok) return { ok: false, reason: r.reason, detail: r.detail };
  return { ok: true, doc: r.doc };
}

function buildCallbackUrl(
  origin: string,
  tenantId: string,
  providerId: string,
): string {
  return `${origin.replace(/\/$/, "")}/api/district/auth/sso/oidc/callback/${encodeURIComponent(tenantId)}/${encodeURIComponent(providerId)}`;
}

function buildBindPasskeyUrl(
  origin: string,
  bindPath: string,
  returnTo: string | undefined,
): string {
  const base = `${origin.replace(/\/$/, "")}${bindPath.startsWith("/") ? bindPath : "/" + bindPath}`;
  if (!returnTo) return base;
  const u = new URL(base);
  u.searchParams.set("return_to", returnTo);
  return u.toString();
}

/**
 * Clamp an optional returnTo to our own origin. An open-redirect risk
 * if we let the IdP's state payload nudge us to an attacker URL.
 * Same-origin + path + query only; everything else is dropped.
 */
function clampReturnTo(
  returnTo: string | null | undefined,
  origin: string,
): string | undefined {
  if (!returnTo) return undefined;
  let u: URL;
  try {
    u = new URL(returnTo, origin);
  } catch {
    return undefined;
  }
  const originUrl = new URL(origin);
  if (u.origin !== originUrl.origin) return undefined;
  // Keep pathname + search; discard fragment + credentials.
  return u.pathname + u.search;
}

async function auditCallbackFailure(
  input: OidcCallbackInput,
  reason: string,
): Promise<void> {
  try {
    await input.store.appendAudit(input.tenantId, {
      action: "district.sso.oidc.callback_failed",
      detail: { reason, providerId: input.providerId },
    });
  } catch {
    // Swallow: audit failure must not mask the callback rejection.
  }
}

export const _test_helpers_ = {
  buildCallbackUrl,
  buildBindPasskeyUrl,
  clampReturnTo,
};
