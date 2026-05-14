// ─────────────────────────────────────────────────────────────────────────────
// app/api/lti/launch/route.ts
//
// v1.8.0 — LTI 1.3 launch callback endpoint.
//
// THE LMS POSTS HERE with `application/x-www-form-urlencoded` body:
//   • id_token  — the signed JWT
//   • state     — the state we issued during login initiation
//
// We:
//   1. Verify `state` (signature + expiry + version).
//   2. Decode the JWT header to extract `kid`, look up the platform.
//   3. Fetch the platform JWKS (cached) and verify the JWT signature
//      + standard time claims.
//   4. Validate LTI claims and check `id_token.nonce` matches state.
//   5. Issue a short-lived signed LTI session cookie and redirect to
//      the validated `target_link_uri` (clamped to our origin).
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { findPlatform, loadPlatforms } from "@/lib/lti/config";
import { fetchJwks } from "@/lib/lti/jwks-fetcher";
import { decodeJwtUnsafe, verifyJwt } from "@/lib/lti/jwt";
import {
  LTI_DEPLOYMENT_ID_CLAIM,
  validateLtiLaunch,
} from "@/lib/lti/launch";
import { verifyState } from "@/lib/lti/state";
import {
  buildLtiSessionCookie,
  issueLtiSession,
} from "@/lib/lti/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toolOrigin(req: NextRequest): string {
  const env = process.env.LTI_TOOL_ORIGIN;
  if (env && /^https?:\/\//.test(env)) return env.replace(/\/$/, "");
  return req.nextUrl.origin;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // LTI 1.3 requires response_mode=form_post; we accept that exclusively.
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/x-www-form-urlencoded")) {
    return reject("wrong_content_type");
  }

  const body = new URLSearchParams(await req.text());
  const idToken = body.get("id_token");
  const stateStr = body.get("state");
  if (!idToken) return reject("missing_id_token");
  if (!stateStr) return reject("missing_state");

  const state = await verifyState(stateStr);
  if (!state.ok) return reject(`state_${state.reason}`);

  // Inspect the JWT header to find the platform first.
  const decoded = decodeJwtUnsafe(idToken);
  if (!decoded) return reject("malformed_id_token");
  const iss = decoded.payload.iss;
  const deploymentId =
    typeof (decoded.payload as Record<string, unknown>)[LTI_DEPLOYMENT_ID_CLAIM] === "string"
      ? ((decoded.payload as Record<string, unknown>)[LTI_DEPLOYMENT_ID_CLAIM] as string)
      : null;

  if (!iss) return reject("id_token_missing_iss");
  if (!deploymentId) return reject("id_token_missing_deployment_id");

  const platforms = loadPlatforms();
  const platform = findPlatform(iss, platformClientIdFromAud(decoded.payload.aud), deploymentId, platforms);
  if (!platform) return reject("unknown_platform");

  // Cross-check: state was issued for THIS platform.
  if (state.payload.platformId !== platform.id) {
    return reject("state_platform_mismatch");
  }

  // Fetch + verify signature.
  const jwks = await fetchJwks(platform.jwksUrl);
  if (!jwks.ok) return reject(`jwks_${jwks.reason}`);
  const verified = await verifyJwt(idToken, jwks.jwks);
  if (!verified.ok) return reject(`jwt_${verified.reason}`);

  // Nonce binding: the token MUST echo the nonce we wrote into state.
  if (verified.payload.nonce !== state.payload.nonce) {
    return reject("nonce_mismatch");
  }

  const origin = toolOrigin(req);
  const claim = validateLtiLaunch({
    payload: verified.payload,
    expectedIssuer: platform.issuer,
    expectedClientId: platform.clientId,
    knownDeploymentIds: platform.deploymentIds,
    toolOrigin: origin,
    platformId: platform.id,
  });
  if (!claim.ok) return reject(`launch_${claim.reason}`);

  // Issue an LTI session and 302 to the validated target.
  const { token, session } = await issueLtiSession(claim.launch);
  const cookie = buildLtiSessionCookie(token);

  const res = NextResponse.redirect(claim.launch.targetLinkUri, 303);
  res.headers.set("Set-Cookie", cookie);
  // Echo session id for diagnostic logs (NOT sensitive).
  res.headers.set("x-evk-lti-session-jti", session.jti);
  return res;
}

function platformClientIdFromAud(aud: unknown): string {
  if (typeof aud === "string") return aud;
  if (Array.isArray(aud) && typeof aud[0] === "string") return aud[0];
  return "";
}

function reject(reason: string): NextResponse {
  // eslint-disable-next-line no-console
  console.warn(`[lti/launch] rejected: ${reason}`);
  return new NextResponse(`LTI launch rejected: ${reason}`, {
    status: 400,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
