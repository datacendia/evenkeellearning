// ─────────────────────────────────────────────────────────────────────────────
// app/api/auth/role-status/route.ts
//
// v1.6.0 — audit H-1. Read-only endpoint that reports which roles this
// client currently has a valid session for. Consumed by RoleGuard.tsx to
// render "already signed in" UI without re-prompting.
//
// GET /api/auth/role-status
//   → { roles: { teacher: boolean, compliance: boolean, author: boolean } }
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import {
  PROTECTED_ROLES,
  cookieNameFor,
  verifySession,
} from "@/lib/auth/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const roles: Record<string, boolean> = {};
  for (const role of PROTECTED_ROLES) {
    const token = req.cookies.get(cookieNameFor(role))?.value;
    const session = token ? await verifySession(token) : null;
    roles[role] = !!session && !("session" in session);
  }
  return NextResponse.json({ roles });
}
