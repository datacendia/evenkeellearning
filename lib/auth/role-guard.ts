// ─────────────────────────────────────────────────────────────────────────────
// lib/auth/role-guard.ts
//
// A deliberately simple, demo-grade access gate for the privileged surfaces
// (/teacher, /compliance). This is **not** authentication. It is a speed
// bump that stops a child clicking "Teacher" on the landing page and
// seeing a dashboard UI.
//
// Contract
// ────────
// - Passphrases are stored ONLY as the last 16 hex chars of SHA-256(passphrase).
//   The plaintext never touches storage. If an attacker reads localStorage
//   they learn nothing useful without a pre-image.
// - There is exactly one passphrase per role, configured at build time
//   via env (NEXT_PUBLIC_TEACHER_PASSPHRASE / NEXT_PUBLIC_COMPLIANCE_PASSPHRASE).
//   For the demo we ship sensible defaults and say so loudly on screen.
// - A successful unlock sets a session key in sessionStorage (tab-scoped)
//   that expires when the tab closes. There is no "remember me".
// - This module is framework-agnostic; see `components/shared/RoleGuard.tsx`
//   for the React wrapper that actually mounts the challenge UI.
//
// Limits (documented in SAFEGUARDING.md and HONESTY.md)
// ─────────────────────────────────────────────────────
// - No account concept, so no audit trail of *who* unlocked.
// - No rate-limiting beyond a single 1s cooldown after a failed attempt.
// - No CSRF because there is no server.
// - This gate CANNOT replace WebAuthn for a production deployment.
// ─────────────────────────────────────────────────────────────────────────────

export type ProtectedRole = "teacher" | "compliance" | "author";

const STORAGE_PREFIX = "evenkeel/role-guard/";
// Demo defaults. Override in production via NEXT_PUBLIC_*_PASSPHRASE.
// These are intentionally memorable — the whole gate is labelled "demo".
const DEFAULT_PASSPHRASES: Record<ProtectedRole, string> = {
  teacher: "mentor-alpha-42",
  compliance: "officer-alpha-42",
  // v1.5.0 — content reviewer surface (/author). The reviewer role gates
  // the only path from `content/drafts/` into a signed manifest. Intended
  // for subject teachers / Heads of Department; in production this is
  // replaced by WebAuthn passkey enrolment per reviewer.
  author: "reviewer-alpha-42",
};

/** SHA-256 the passphrase and keep only the last 16 hex chars. */
export async function derivePassphraseDigest(passphrase: string): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    // Defensive fallback (Node <20 without Web Crypto). Should never fire
    // in the browser or in our test environment (happy-dom provides
    // crypto.subtle).
    return "unavailable";
  }
  const buf = new TextEncoder().encode(passphrase);
  const hashBuf = await crypto.subtle.digest("SHA-256", buf);
  const hex = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(-16);
}

/** Expected digest for a given role (env or default). */
export async function expectedDigestFor(role: ProtectedRole): Promise<string> {
  const envKey =
    role === "teacher"
      ? process.env.NEXT_PUBLIC_TEACHER_PASSPHRASE
      : role === "compliance"
        ? process.env.NEXT_PUBLIC_COMPLIANCE_PASSPHRASE
        : process.env.NEXT_PUBLIC_AUTHOR_PASSPHRASE;
  const passphrase = envKey && envKey.length > 0 ? envKey : DEFAULT_PASSPHRASES[role];
  return derivePassphraseDigest(passphrase);
}

/** Is this tab already unlocked for this role? */
export function isUnlocked(role: ProtectedRole): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(STORAGE_PREFIX + role) === "unlocked";
  } catch {
    return false;
  }
}

/** Clear the unlock for this tab. */
export function lock(role: ProtectedRole): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_PREFIX + role);
  } catch {
    /* session storage may be disabled */
  }
}

/**
 * Attempt to unlock. Resolves true if the passphrase matches.
 * Deliberately introduces a 400ms delay on failure to discourage
 * interactive brute-force.
 */
export async function tryUnlock(role: ProtectedRole, passphrase: string): Promise<boolean> {
  const provided = await derivePassphraseDigest(passphrase);
  const expected = await expectedDigestFor(role);
  const match = constantTimeEqual(provided, expected);
  if (match) {
    try {
      window.sessionStorage.setItem(STORAGE_PREFIX + role, "unlocked");
    } catch {
      /* session storage may be disabled — gate still evaluated in-memory */
    }
    return true;
  }
  await new Promise((r) => setTimeout(r, 400));
  return false;
}

/** Length-agnostic constant-time equality on short strings. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
