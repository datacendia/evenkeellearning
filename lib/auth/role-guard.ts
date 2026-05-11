// ─────────────────────────────────────────────────────────────────────────────
// lib/auth/role-guard.ts
//
// v1.6.0 — audit H-1. This module is now a **back-compat shim** around the
// real, server-verified session flow in `lib/auth/server-session.ts` and
// its browser counterpart in `lib/auth/role-guard-client.ts`.
//
// Public functions (`isUnlocked`, `tryUnlock`, `lock`) keep their names
// so existing call sites don't break, but every one of them now hits the
// server (`/api/auth/role-*`) and trusts the server's verdict. The
// sessionStorage flag that used to live here is GONE; a child opening
// devtools can no longer bypass the gate.
//
// The only piece retained for back-compat is `derivePassphraseDigest`,
// which is a pure utility used by a handful of client-side display paths
// and by the old unit tests. It is no longer the basis of the auth
// decision.
//
// Historical notes (pre-v1.6.0)
// ─────────────────────────────
// The old contract is preserved in git history. It was:
//   - sessionStorage-backed "unlocked" flag (tab-scoped)
//   - passphrase compared client-side against a truncated SHA-256 digest
//   - demo-labelled but still shipped the privileged page HTML on load
// That model failed the H-1 audit check because the role gate was
// enforceable only by the client. The v1.6.0 model enforces it in Next.js
// middleware + HttpOnly signed cookies — see the module header of
// `lib/auth/server-session.ts` for the threat-model writeup.
//
// ─────────────────────────────────────────────────────────────────────────────

export type ProtectedRole = "teacher" | "compliance" | "author";

// Re-export the server-backed client helpers under the old names so that
// existing callers (`components/shared/RoleGuard.tsx`, and any third-
// party code) don't have to change their import path.
export {
  fetchRoleStatus,
  isUnlocked,
  tryUnlock,
  lock,
} from "@/lib/auth/role-guard-client";

/**
 * Pure utility, retained only because a handful of display paths and the
 * existing unit tests still call it. Not a security primitive — the real
 * passphrase check now lives on the server in
 * `lib/auth/server-session.ts::checkPassphrase`.
 */
export async function derivePassphraseDigest(passphrase: string): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    return "unavailable";
  }
  const buf = new TextEncoder().encode(passphrase);
  const hashBuf = await crypto.subtle.digest("SHA-256", buf);
  const hex = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(-16);
}
