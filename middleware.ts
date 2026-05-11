// ─────────────────────────────────────────────────────────────────────────────
// middleware.ts
//
// v1.6.0 — audit H-1. Next.js Edge middleware that gates the privileged
// routes `/teacher`, `/compliance` and `/author` at the HTTP layer.
//
// Why at the edge
// ───────────────
// Before v1.6.0 the gate was enforced by a client-side React component
// (`components/shared/RoleGuard.tsx`) that hid the page behind a challenge
// screen. The page HTML (including every Teacher-Dashboard component and
// every seed datum embedded in it) was still sent to the browser — a
// curious child who pressed "View Source" could read it. The middleware
// here short-circuits unauthenticated requests with a redirect BEFORE the
// protected page is rendered or sent.
//
// Runtime: Edge (default for middleware). Uses only Web Crypto via
// `lib/auth/server-session.ts`, no `node:crypto`.
//
// Bypass paths (explicitly allowed without a session)
// ───────────────────────────────────────────────────
// - `/` and any non-protected route
// - `/api/auth/*` — the login/logout/status endpoints themselves
// - Static files (_next/, images, fonts) — Next routes these around
//   middleware by default, so we don't need to list them.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import {
  cookieNameFor,
  verifySession,
  type ProtectedRole,
} from "@/lib/auth/server-session";

/** Route prefixes that require a role session. Keep in sync with PROTECTED_ROLES. */
const PROTECTED_PREFIXES: Array<{ prefix: string; role: ProtectedRole }> = [
  { prefix: "/teacher", role: "teacher" },
  { prefix: "/compliance", role: "compliance" },
  { prefix: "/author", role: "author" },
];

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const pathname = req.nextUrl.pathname;

  const match = PROTECTED_PREFIXES.find(
    (p) => pathname === p.prefix || pathname.startsWith(p.prefix + "/"),
  );
  if (!match) return NextResponse.next();

  const token = req.cookies.get(cookieNameFor(match.role))?.value;
  const session = token ? await verifySession(token) : null;
  if (session && !("session" in session)) {
    // Valid session — let the request proceed. The client-side RoleGuard
    // will still render a "Lock surface" button for good UX but will NOT
    // re-challenge.
    return NextResponse.next();
  }

  // No valid session. Redirect to the home page with a hint so the
  // client can open the challenge UI on mount.
  const url = req.nextUrl.clone();
  url.pathname = "/";
  url.searchParams.set("signin", match.role);
  url.searchParams.set("from", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/teacher/:path*", "/compliance/:path*", "/author/:path*"],
};
