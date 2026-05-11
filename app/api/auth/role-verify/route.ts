// ─────────────────────────────────────────────────────────────────────────────
// app/api/auth/role-verify/route.ts
//
// v1.6.0 — audit H-1. Server-side passphrase verification endpoint.
//
// POST /api/auth/role-verify
//   body: { role: "teacher" | "compliance" | "author", passphrase: string }
//
// On success: sets an HttpOnly signed session cookie and returns 200.
// On failure: returns 401 after a small cooldown. Never leaks WHY it failed
// (wrong passphrase vs. unknown role vs. malformed body) — all three look
// the same to a network observer.
//
// Deliberately uses the Node.js runtime (not Edge) so the response header
// `Set-Cookie` can be set via NextResponse and so the in-memory revocation
// store in `lib/auth/server-session.ts` is consistent with the logout
// endpoint.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import {
  PROTECTED_ROLES,
  buildSetCookieHeader,
  checkPassphrase,
  issueSession,
  type ProtectedRole,
} from "@/lib/auth/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Uniform cooldown applied on every failure. Discourages interactive brute-force. */
const FAILURE_COOLDOWN_MS = 400;

function bad(status = 401): NextResponse {
  // All failure modes share the same body + timing.
  return NextResponse.json({ ok: false }, { status });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    await sleep(FAILURE_COOLDOWN_MS);
    return bad(400);
  }

  if (!body || typeof body !== "object") {
    await sleep(FAILURE_COOLDOWN_MS);
    return bad(400);
  }
  const { role, passphrase } = body as { role?: unknown; passphrase?: unknown };

  if (
    typeof role !== "string" ||
    typeof passphrase !== "string" ||
    !PROTECTED_ROLES.includes(role as ProtectedRole)
  ) {
    await sleep(FAILURE_COOLDOWN_MS);
    return bad(400);
  }

  const typedRole = role as ProtectedRole;

  let ok = false;
  try {
    ok = await checkPassphrase(typedRole, passphrase);
  } catch (e) {
    // A missing env var in production raises from `checkPassphrase`.
    // Don't leak the message to the client; log and 500.
    // eslint-disable-next-line no-console
    console.error("[auth/role-verify] passphrase check failed:", (e as Error).message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  if (!ok) {
    await sleep(FAILURE_COOLDOWN_MS);
    return bad(401);
  }

  const { token, session } = await issueSession(typedRole);
  const res = NextResponse.json({
    ok: true,
    role: session.role,
    expiresAt: new Date(session.exp).toISOString(),
  });
  res.headers.set("Set-Cookie", buildSetCookieHeader(typedRole, token));
  return res;
}
