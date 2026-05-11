// ─────────────────────────────────────────────────────────────────────────────
// app/api/auth/role-logout/route.ts
//
// v1.6.0 — audit H-1. Revoke + clear a role session cookie.
//
// POST /api/auth/role-logout
//   body: { role: "teacher" | "compliance" | "author" }
//
// Validates the current session cookie, adds its `jti` to the in-memory
// revocation set, and clears the cookie on the response. Returns 200
// whether or not the caller was actually signed in — idempotent.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import {
  PROTECTED_ROLES,
  buildClearCookieHeader,
  cookieNameFor,
  revokeSession,
  verifySession,
  type ProtectedRole,
} from "@/lib/auth/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  let role: ProtectedRole | null = null;
  try {
    const body = (await req.json()) as { role?: unknown };
    if (
      typeof body?.role === "string" &&
      PROTECTED_ROLES.includes(body.role as ProtectedRole)
    ) {
      role = body.role as ProtectedRole;
    }
  } catch {
    /* ignore — we'll fall through to 400 below */
  }

  if (!role) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // Revoke the current session if there is one, so a replay of a leaked
  // cookie can't re-authenticate.
  const token = req.cookies.get(cookieNameFor(role))?.value;
  if (token) {
    const session = await verifySession(token);
    if (session && !("session" in session)) {
      revokeSession(session.jti);
    }
  }

  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", buildClearCookieHeader(role));
  return res;
}
