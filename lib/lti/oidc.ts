// ─────────────────────────────────────────────────────────────────────────────
// lib/lti/oidc.ts
//
// v1.8.0 — Build the OIDC auth redirect URL for an LTI 1.3 launch.
//
// FLOW
// ────
// LMS hits our login initiation endpoint with:
//   • iss              — its issuer URL
//   • login_hint       — opaque LMS user identifier (we echo it back)
//   • target_link_uri  — where we should land the user
//   • lti_message_hint — optional opaque hint (we echo it back)
//   • client_id        — optional, used to disambiguate multi-tenant
//
// We respond with an HTTP 302 to the LMS's authorize endpoint with:
//   • client_id, redirect_uri, response_type=id_token,
//     scope=openid, response_mode=form_post, prompt=none,
//     login_hint, nonce, state, lti_message_hint
//
// This module builds the redirect URL deterministically so the route
// handler can be a thin shell.
// ─────────────────────────────────────────────────────────────────────────────

export interface BuildAuthRedirectArgs {
  /** The platform's auth endpoint (`authLoginUrl` from registration). */
  authLoginUrl: string;
  /** Even Keel's client_id on that platform. */
  clientId: string;
  /** Absolute URL of our launch endpoint (e.g. https://app/api/lti/launch). */
  redirectUri: string;
  /** Opaque LMS user identifier from the login initiation request. */
  loginHint: string;
  /** Optional opaque LMS hint, echoed verbatim. */
  ltiMessageHint?: string;
  /** Issued nonce for the launch. */
  nonce: string;
  /** Issued state binding (from `issueState`). */
  state: string;
}

/**
 * Construct the auth redirect URL for the LMS's authorize endpoint.
 * Returns the URL as a string. Caller decides how to send the 302.
 */
export function buildAuthRedirectUrl(args: BuildAuthRedirectArgs): string {
  const u = new URL(args.authLoginUrl);
  // Preserve any query the platform put in `authLoginUrl` itself.
  const params = u.searchParams;
  params.set("scope", "openid");
  params.set("response_type", "id_token");
  params.set("response_mode", "form_post");
  params.set("prompt", "none");
  params.set("client_id", args.clientId);
  params.set("redirect_uri", args.redirectUri);
  params.set("login_hint", args.loginHint);
  params.set("nonce", args.nonce);
  params.set("state", args.state);
  if (args.ltiMessageHint && args.ltiMessageHint.length > 0) {
    params.set("lti_message_hint", args.ltiMessageHint);
  }
  return u.toString();
}

/** Parse a login-initiation request — query string OR form-encoded body. */
export interface LoginInitiationParams {
  iss: string;
  loginHint: string;
  targetLinkUri: string;
  clientId?: string;
  ltiMessageHint?: string;
  ltiDeploymentId?: string;
}

/** Stable failure codes. */
export type LoginInitiationParseReason =
  | "missing_iss"
  | "missing_login_hint"
  | "missing_target_link_uri"
  | "invalid_target_link_uri";

export type LoginInitiationParseResult =
  | { ok: true; params: LoginInitiationParams }
  | { ok: false; reason: LoginInitiationParseReason };

/**
 * Normalise an LMS login initiation request. The LMS can send the
 * parameters via either GET query string or POST form body — we
 * accept both via a `URLSearchParams` argument.
 */
export function parseLoginInitiation(
  raw: URLSearchParams,
): LoginInitiationParseResult {
  const iss = raw.get("iss");
  if (!iss || iss.length === 0) {
    return { ok: false, reason: "missing_iss" };
  }
  const loginHint = raw.get("login_hint");
  if (!loginHint || loginHint.length === 0) {
    return { ok: false, reason: "missing_login_hint" };
  }
  const targetLinkUri = raw.get("target_link_uri");
  if (!targetLinkUri || targetLinkUri.length === 0) {
    return { ok: false, reason: "missing_target_link_uri" };
  }
  try {
    // Just check parseability; we don't enforce origin here — the
    // launch handler enforces the same-origin redirect rule against
    // the FINAL target_link_uri carried in the id_token, which is
    // the value that actually drives the redirect.
    void new URL(targetLinkUri);
  } catch {
    return { ok: false, reason: "invalid_target_link_uri" };
  }
  const clientId = raw.get("client_id") ?? undefined;
  const ltiMessageHint = raw.get("lti_message_hint") ?? undefined;
  const ltiDeploymentId = raw.get("lti_deployment_id") ?? undefined;
  return {
    ok: true,
    params: {
      iss,
      loginHint,
      targetLinkUri,
      clientId: clientId || undefined,
      ltiMessageHint: ltiMessageHint || undefined,
      ltiDeploymentId: ltiDeploymentId || undefined,
    },
  };
}
