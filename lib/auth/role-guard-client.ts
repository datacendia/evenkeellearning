// ─────────────────────────────────────────────────────────────────────────────
// lib/auth/role-guard-client.ts
//
// v1.6.0 — audit H-1. Client-facing thin wrapper around the server auth
// API. The old `lib/auth/role-guard.ts` did everything in the browser
// (sessionStorage-based) and was a demo-grade gate — see the module
// header of `lib/auth/server-session.ts` for the threat-model writeup.
//
// This module keeps the public function names (`tryUnlock`, `isUnlocked`,
// `lock`) so existing call sites don't change, but each one now issues
// an `fetch` against `/api/auth/role-*` and trusts the server's verdict.
// ─────────────────────────────────────────────────────────────────────────────

export type ProtectedRole = "teacher" | "compliance" | "author";

const STATUS_ENDPOINT = "/api/auth/role-status";
const VERIFY_ENDPOINT = "/api/auth/role-verify";
const LOGOUT_ENDPOINT = "/api/auth/role-logout";

/**
 * Query the server for the currently signed-in roles. Returns a record
 * keyed by role. Safe to call on every mount.
 */
export async function fetchRoleStatus(): Promise<Record<ProtectedRole, boolean>> {
  try {
    const res = await fetch(STATUS_ENDPOINT, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const json = (await res.json()) as { roles?: Record<string, boolean> };
    return {
      teacher: !!json.roles?.teacher,
      compliance: !!json.roles?.compliance,
      author: !!json.roles?.author,
    };
  } catch {
    return { teacher: false, compliance: false, author: false };
  }
}

/** Convenience: is a single role currently unlocked? */
export async function isUnlocked(role: ProtectedRole): Promise<boolean> {
  const status = await fetchRoleStatus();
  return status[role];
}

/**
 * Attempt to unlock a role by posting a passphrase to the server.
 * The server sets an HttpOnly cookie on success; we just return the
 * boolean outcome. Deliberately opaque on failure — 401, 400, 500 all
 * surface as `false` so the caller can't distinguish wrong-passphrase
 * from missing-env-var, and neither can a network observer.
 */
export async function tryUnlock(role: ProtectedRole, passphrase: string): Promise<boolean> {
  try {
    const res = await fetch(VERIFY_ENDPOINT, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role, passphrase }),
      cache: "no-store",
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { ok?: boolean };
    return !!json.ok;
  } catch {
    return false;
  }
}

/** Lock the current tab's session for a role. Fire-and-forget on the client. */
export async function lock(role: ProtectedRole): Promise<void> {
  try {
    await fetch(LOGOUT_ENDPOINT, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role }),
      cache: "no-store",
    });
  } catch {
    /* best-effort — network errors are not actionable here */
  }
}
