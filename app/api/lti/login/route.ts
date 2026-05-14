// ─────────────────────────────────────────────────────────────────────────────
// app/api/lti/login/route.ts
//
// v1.8.0 — LTI 1.3 OIDC login initiation endpoint.
//
// LMS hits this endpoint (either GET with query string or POST with
// form body) to start the launch flow. We:
//   1. Parse iss + login_hint + target_link_uri.
//   2. Resolve the platform registration.
//   3. Generate a nonce, bind it into a signed state.
//   4. 302 to the LMS authorize endpoint with the OIDC parameters.
//
// We DO NOT trust the LMS's `target_link_uri` to be safe yet — that's
// re-checked at launch time against the value embedded in the
// id_token claim, where the security boundary actually lives.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { findPlatformByIssuer } from "@/lib/lti/config";
import {
  buildAuthRedirectUrl,
  parseLoginInitiation,
} from "@/lib/lti/oidc";
import { generateNonce, issueState } from "@/lib/lti/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readSearchParams(req: NextRequest): Promise<URLSearchParams> {
  if (req.method === "POST") {
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/x-www-form-urlencoded")) {
      const text = await req.text();
      return new URLSearchParams(text);
    }
    // Tolerate JSON-bodied POSTs from test harnesses.
    if (ct.includes("application/json")) {
      const json = (await req.json().catch(() => null)) as
        | Record<string, string>
        | null;
      const sp = new URLSearchParams();
      if (json) {
        for (const [k, v] of Object.entries(json)) {
          if (typeof v === "string") sp.set(k, v);
        }
      }
      return sp;
    }
  }
  return req.nextUrl.searchParams;
}

function toolOrigin(req: NextRequest): string {
  const env = process.env.LTI_TOOL_ORIGIN;
  if (env && /^https?:\/\//.test(env)) return env.replace(/\/$/, "");
  // Derive from the request when env is unset (dev only).
  return req.nextUrl.origin;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}

async function handle(req: NextRequest): Promise<NextResponse> {
  const sp = await readSearchParams(req);
  const parsed = parseLoginInitiation(sp);
  if (!parsed.ok) {
    return badRequest(`lti_login_${parsed.reason}`);
  }

  // We need the client_id to resolve a platform. The LMS sends it in
  // the login_initiation request when the platform is multi-tenanted;
  // otherwise we infer it from the registry by issuer alone.
  const explicitClientId = parsed.params.clientId;
  const candidatePlatforms = explicitClientId
    ? [findPlatformByIssuer(parsed.params.iss, explicitClientId)].filter(
        Boolean,
      )
    : [];
  const platform = candidatePlatforms[0] ?? null;
  if (!platform) {
    return badRequest("unknown_platform");
  }

  const nonce = generateNonce();
  const state = await issueState({
    platformId: platform.id,
    nonce,
    targetLinkUri: parsed.params.targetLinkUri,
  });

  const origin = toolOrigin(req);
  const redirectUri = `${origin}/api/lti/launch`;

  const url = buildAuthRedirectUrl({
    authLoginUrl: platform.authLoginUrl,
    clientId: platform.clientId,
    redirectUri,
    loginHint: parsed.params.loginHint,
    ltiMessageHint: parsed.params.ltiMessageHint,
    nonce,
    state,
  });

  return NextResponse.redirect(url, 302);
}

function badRequest(reason: string): NextResponse {
  // The body is for our logs / dev console only. LMSes ignore it and
  // surface their own "tool launch failed" UI.
  return new NextResponse(`LTI login rejected: ${reason}`, {
    status: 400,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
