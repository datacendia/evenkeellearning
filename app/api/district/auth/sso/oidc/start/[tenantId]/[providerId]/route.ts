// ─────────────────────────────────────────────────────────────────────────────
// app/api/district/auth/sso/oidc/start/[tenantId]/[providerId]/route.ts
//
// v1.8.5 — OIDC authorization-code flow initiation endpoint.
//
// GET /api/district/auth/sso/oidc/start/:tenantId/:providerId?return_to=/dashboard
//
// Sets the signed state cookie and 302-redirects the browser to the
// IdP's `authorization_endpoint`. All real logic lives in
// `lib/district/oidc/handlers.ts` so the flow is fully testable
// without Next.js.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { handleOidcStart } from "@/lib/district/oidc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteCtx {
  params: { tenantId: string; providerId: string };
}

export async function GET(
  req: NextRequest,
  ctx: RouteCtx,
): Promise<NextResponse> {
  const result = await handleOidcStart({
    tenantId: ctx.params.tenantId,
    providerId: ctx.params.providerId,
    requestOrigin: toolOrigin(req),
    returnTo: req.nextUrl.searchParams.get("return_to"),
    forceReauth: req.nextUrl.searchParams.get("force_reauth") === "1",
    promptSelectAccount:
      req.nextUrl.searchParams.get("prompt_select_account") === "1",
  });

  return toNextResponse(result);
}

function toolOrigin(req: NextRequest): string {
  const env = process.env.DISTRICT_ORIGIN;
  if (env && /^https?:\/\//.test(env)) return env.replace(/\/$/, "");
  return req.nextUrl.origin;
}

function toNextResponse(result: {
  status: number;
  headers: Headers;
  body: string;
}): NextResponse {
  const res = new NextResponse(result.body, {
    status: result.status,
    headers: result.headers,
  });
  return res;
}
