// ─────────────────────────────────────────────────────────────────────────────
// app/api/district/auth/sso/oidc/callback/[tenantId]/[providerId]/route.ts
//
// v1.8.5 — OIDC authorization-code flow callback endpoint.
//
// GET /api/district/auth/sso/oidc/callback/:tenantId/:providerId?code&state
//
// Orchestrates the complete callback pipeline:
//   (1) state-cookie verify
//   (2) state/tenant/provider match
//   (3) code exchange at the IdP's /token endpoint
//   (4) id_token signature + OIDC claim validation
//   (5) tenant-user resolve/upsert
//   (6) sign + set the login-intent cookie
//   (7) 303 → /auth/bind-passkey?return_to=...
//
// All real logic lives in `lib/district/oidc/handlers.ts` so the flow
// is fully testable without a Next.js server.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import {
  handleOidcCallback,
  OIDC_STATE_COOKIE_NAME,
} from "@/lib/district/oidc";
import { getDistrictStore } from "@/lib/district";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteCtx {
  params: { tenantId: string; providerId: string };
}

export async function GET(
  req: NextRequest,
  ctx: RouteCtx,
): Promise<NextResponse> {
  const { http } = await handleOidcCallback({
    tenantId: ctx.params.tenantId,
    providerId: ctx.params.providerId,
    requestOrigin: toolOrigin(req),
    stateCookie: req.cookies.get(OIDC_STATE_COOKIE_NAME)?.value ?? null,
    query: req.nextUrl.searchParams,
    store: getDistrictStore(),
  });

  return new NextResponse(http.body, {
    status: http.status,
    headers: http.headers,
  });
}

function toolOrigin(req: NextRequest): string {
  const env = process.env.DISTRICT_ORIGIN;
  if (env && /^https?:\/\//.test(env)) return env.replace(/\/$/, "");
  return req.nextUrl.origin;
}
